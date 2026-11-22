// The admission workflow at a glance (Home screen diagram): how many students are in each stage, what moves them
// on and what holds them back, with the screen where each thing is handled. Pure function of the season's data.
import { isActive, lockBlockers, stageOf } from './assign';
import { awaitingPayment, isOverdue } from './deadlines';
import { idList } from './payments';
import { APP_COLS, FLAG_COLS, PAY_COLS, type Row, type SeasonConfig } from './types';

/**
 * - `todo`: something for you to do (amber, with an arrow);
 * - `ready`: students that can move on now, by your action (green);
 * - `wait`: waiting on someone else, e.g. the family paying before the deadline (grey).
 */
export type Kind = 'todo' | 'ready' | 'wait';

export interface Item {
  key: string;
  label: string;
  n: number;
  kind: Kind;
  href: string;
  /** What to do, for the "Next:" line and the tooltip. */
  action: string;
}

export interface Stage {
  key: 'applied' | 'assigned' | 'locked' | 'admitted' | 'paid';
  label: string;
  /** Students currently in this stage. */
  n: number;
  /** Students in this stage or further along (the volume that flowed through the line into it). */
  reached: number;
  href: string;
}

/** What lies between a stage and the next one: who can move on (`ready`) and the side branches that hold students back. */
export interface Gate {
  from: Stage['key'];
  ready: Item | null;
  branches: Item[];
}

export interface Workflow {
  stages: Stage[];
  gates: Gate[];
  /** Outside the main flow: withdrawn students, refunds to do. */
  side: Item[];
  /** Everything to do, in workflow order; the first is "next". */
  todo: Item[];
}

const ORDER: Stage['key'][] = ['applied', 'assigned', 'locked', 'admitted', 'paid'];

function stageKey(a: Row): Stage['key'] {
  const s = stageOf(a);
  if (s === 'paid' || s === 'admitted' || s === 'locked') return s;
  if (s.startsWith('assigned')) return 'assigned';
  return 'applied';
}

export function workflow(apps: Row[], flags: Row[], payments: Row[] | null, cfg: SeasonConfig, today: string): Workflow {
  const active = apps.filter(isActive);
  const openFlags = flags.filter((f) => f[FLAG_COLS.status] === 'open');
  const by = new Map<Stage['key'], Row[]>(ORDER.map((k) => [k, []]));
  for (const a of active) by.get(stageKey(a))!.push(a);
  const count = (k: Stage['key']) => by.get(k)!.length;
  const reached = (k: Stage['key']) => ORDER.slice(ORDER.indexOf(k)).reduce((s, x) => s + count(x), 0);
  const item = (key: string, label: string, n: number, kind: Kind, href: string, action: string): Item => ({ key, label, n, kind, href, action });

  const stages: Stage[] = [
    { key: 'applied', label: 'Applied', n: count('applied'), reached: reached('applied'), href: '#/apps' },
    { key: 'assigned', label: 'Assigned', n: count('assigned'), reached: reached('assigned'), href: '#/assign' },
    { key: 'locked', label: 'Locked', n: count('locked'), reached: reached('locked'), href: '#/lock' },
    { key: 'admitted', label: 'Admitted', n: count('admitted'), reached: reached('admitted'), href: '#/admit' },
    { key: 'paid', label: 'Paid', n: count('paid'), reached: reached('paid'), href: '#/unpaid' },
  ];

  // Applied → assigned.
  const applied = by.get('applied')!;
  const waitlisted = applied.filter((a) => (a[APP_COLS.assignNote] ?? '').startsWith('waitlist')).length;
  const notRun = applied.length - waitlisted;
  const gate1: Gate = {
    from: 'applied',
    ready: null,
    branches: [
      item('unassigned', 'not assigned yet', notRun, 'todo', '#/assign', `Run the course assignment (${notRun} new student(s))`),
      item('waitlist', 'waitlist', waitlisted, 'wait', '#/waitlist', `${waitlisted} student(s) on the waitlist: raise a limit or assign by hand`),
    ],
  };

  // Assigned → locked: a student can wait for several things at once (counted in each branch). Flags and the FL
  // school can (and should) be handled before assignment too, so those branches count every student not yet locked.
  const assigned = by.get('assigned')!;
  const notLocked = [...applied, ...assigned];
  const youngOpen = (id: string) => openFlags.some((f) => f[FLAG_COLS.appId] === id && f[FLAG_COLS.type] === 'YOUNG');
  const otherOpen = (id: string) => openFlags.some((f) => f[FLAG_COLS.appId] === id && f[FLAG_COLS.type] !== 'YOUNG');
  let ready = 0, young = 0, other = 0, fl = 0, dorm = 0;
  for (const a of assigned) {
    const why = lockBlockers(a, flags);
    if (why.length === 0) ready++;
    if (!youngOpen(a[APP_COLS.id]) && why.some((w) => w.startsWith('young-student OK'))) young++;
    if (a[APP_COLS.dormWaiting] === 'TRUE') dorm++;
  }
  for (const a of notLocked) {
    const id = a[APP_COLS.id];
    if (youngOpen(id)) young++;
    if (otherOpen(id)) other++;
    if (a[APP_COLS.flStatus] === 'claimed') fl++;
  }
  const gate2: Gate = {
    from: 'assigned',
    ready: item('lock', 'ready to lock', ready, 'ready', '#/lock', `Lock ${ready} student(s) who are ready`),
    branches: [
      item('young', 'young-student flag', young, 'todo', '#/young', `Decide ${young} young-student flag(s)`),
      item('flags', 'other flags', other, 'todo', '#/flags', `Decide the open flags of ${other} student(s)`),
      item('fl', 'FL school to confirm', fl, 'todo', '#/schools', `Confirm the Flemish school of ${fl} student(s)`),
      item('dorm', 'no dorm place', dorm, 'wait', '#/dorms', `${dorm} student(s) wait for a dorm place`),
    ],
  };

  // Locked → admitted.
  const locked = by.get('locked')!;
  const pending = new Set(cfg.pendingAdmission?.ids ?? []);
  const sent = locked.filter((a) => pending.has(a[APP_COLS.id])).length;
  const toSend = locked.length - sent;
  const gate3: Gate = {
    from: 'locked',
    ready: item('admit', 'admission e-mail to send', toSend, 'ready', '#/admit', `Send the admission e-mails (${toSend} student(s))`),
    branches: [item('sent', 'sent? confirm', sent, 'todo', '#/admit', `Confirm that the admission e-mails for ${sent} student(s) were sent`)],
  };

  // Admitted → paid.
  const admitted = by.get('admitted')!.filter(awaitingPayment);
  const toCheck = new Set<string>();
  let unmatched = 0;
  for (const p of payments ?? []) {
    if (p[PAY_COLS.status] === 'open') unmatched++;
    if (p[PAY_COLS.status] === 'matched' && !['approved', 'rejected'].includes(p[PAY_COLS.proofStatus])) for (const id of idList(p[PAY_COLS.matchedApps])) toCheck.add(id);
  }
  const checking = admitted.filter((a) => toCheck.has(a[APP_COLS.id])).length;
  const overdue = admitted.filter((a) => !toCheck.has(a[APP_COLS.id]) && isOverdue(a, today)).length;
  const waiting = admitted.length - checking - overdue;
  const gate4: Gate = {
    from: 'admitted',
    ready: item('proofs', 'proof to check', checking, 'ready', '#/proofs', `Check ${checking} proof(s) of payment`),
    branches: [
      ...(payments ? [item('unmatched', 'payments to match', unmatched, 'todo', '#/paymatch', `Match ${unmatched} payment(s) by hand`)] : []),
      item('overdue', 'deadline passed', overdue, 'todo', '#/unpaid', `Follow up ${overdue} overdue payment(s)`),
      item('awaiting', 'awaiting payment', waiting, 'wait', '#/unpaid', `${waiting} student(s) still have time to pay`),
    ],
  };

  const withdrawn = apps.filter((a) => a[APP_COLS.status] === 'withdrawn');
  const refunds = withdrawn.filter((a) => a[APP_COLS.reimbursement] === 'eligible' && !a[APP_COLS.reimbursedAt]).length + active.filter((a) => a[APP_COLS.refundDue]).length;
  const side = [
    item('refunds', 'refunds to pay', refunds, 'todo', '#/refunds', `Pay ${refunds} refund(s)`),
    item('withdrawn', 'withdrawn', withdrawn.length, 'wait', '#/apps', `${withdrawn.length} withdrawn`),
  ];

  const gates = [gate1, gate2, gate3, gate4];
  // What to do, in the order it's best done: flags first (young-student decisions and near-duplicates change the
  // assignment), then assign, confirm FL schools, lock, admit, follow up payments.
  const ORDER_TODO = ['young', 'flags', 'unassigned', 'fl', 'lock', 'sent', 'admit', 'unmatched', 'proofs', 'overdue', 'refunds'];
  const all = [...gates.flatMap((g) => [...g.branches, ...(g.ready ? [g.ready] : [])]), ...side];
  const todo = ORDER_TODO.map((k) => all.find((x) => x.key === k)!).filter((x) => x && x.n > 0);
  return { stages, gates, side, todo };
}
