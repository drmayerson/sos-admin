import { useEffect, useMemo, useState } from 'preact/hooks';
import { isActive, stageOf } from '../../core/assign';
import { decodeUtf8, parseCsv } from '../../core/csv';
import { addDays } from '../../core/admission';
import { awaitingPayment, effectiveDeadline, isOverdue, REMINDER_COLUMNS, reminderRows } from '../../core/deadlines';
import { parseAmount } from '../../core/fees';
import { field } from '../../core/flags';
import { idList, type PaymentPlan } from '../../core/payments';
import { analyzeProof, pairProofFiles, type Pairing } from '../../core/proof';
import { fold } from '../../core/text';
import { APP_COLS, PAY_COLS, type Row, type SeasonConfig } from '../../core/types';
import { DEMO_PAYMENTS, makeDemoProofs } from '../../store/demo';
import { fullName, useApp } from '../ctx';
import { extractText } from '../ocr';

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- import

export function PaymentImport() {
  const { repo, snap, run } = useApp();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<PaymentPlan | null>(null);
  const [done, setDone] = useState(false);
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;

  async function load(n: string, bytes: Uint8Array) {
    setName(n);
    setPlan(null);
    setDone(false);
    setError('');
    const d = decodeUtf8(bytes);
    if (!d.ok) return setError(d.error!);
    try {
      setPlan(await repo.previewPayments(parseCsv(d.text)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const count = (s: string) => plan?.newRows.filter((r) => r[PAY_COLS.status] === s).length ?? 0;

  return (
    <div>
      <h1>Import payments</h1>
      <p>
        Upload the payment-form CSV (always all submissions). Rows imported before are skipped. Each new payment is linked to an
        application by e-mail (student or parent), else by an exact student or parent name; the rest is left for you on the
        <a href="#/paymatch"> Match payments</a> screen.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) await load(f.name, new Uint8Array(await f.arrayBuffer()));
          (e.target as HTMLInputElement).value = '';
        }}
      />
      {repo.store.isDemo && (
        <p class="muted">
          Demo:{' '}
          <button class="link" onClick={async () => load(DEMO_PAYMENTS.name, new Uint8Array(await (await fetch(DEMO_PAYMENTS.url)).arrayBuffer()))}>
            Synthetic 2026 payment export
          </button>
        </p>
      )}
      {name && <h2>{name}</h2>}
      {error && <div class="msg err">{error}</div>}
      {plan && (
        <>
          {plan.errors.map((e) => <div class="msg err">{e}</div>)}
          {plan.warnings.length > 0 && (
            <div class="msg warn">
              <ul>{plan.warnings.map((w) => <li>{w}</li>)}</ul>
            </div>
          )}
          {plan.errors.length === 0 && (
            <>
              <table class="kv"><tbody>
                <tr><td>Rows in file</td><td>{plan.totalRows}</td></tr>
                <tr><td>Already imported before</td><td>{plan.alreadyImported}</td></tr>
                <tr><td><b>New payments</b></td><td><b>{plan.newRows.length}</b></td></tr>
                <tr><td>… linked automatically</td><td>{count('matched')}</td></tr>
                <tr><td>… to match by hand</td><td>{count('open')}</td></tr>
                <tr><td>… identical repeat submissions</td><td>{count('duplicate')}</td></tr>
              </tbody></table>
              {!done && plan.newRows.length > 0 && (
                <button class="primary" onClick={async () => { if (await run(() => repo.commitPayments(plan), `Imported ${plan.newRows.length} payment(s).`)) setDone(true); }}>
                  Import {plan.newRows.length} payment(s)
                </button>
              )}
              {plan.newRows.length === 0 && <p>Nothing new to import.</p>}
              {done && <p class="msg ok">Done. Next: <a href="#/paymatch">match the open ones</a>, then <a href="#/proofs">check the proofs</a>.</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- matching

export function PaymentMatch() {
  const { snap, repo } = useApp();
  const [pays, setPays] = useState<Row[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const load = async () => setPays(await repo.store.readAll('Payments'));
  useEffect(() => {
    load();
  }, [snap]);
  if (!snap.cfg || !pays) return <p>Loading…</p>;
  const list = pays.filter((p) => showAll || p[PAY_COLS.status] === 'open' || p[PAY_COLS.status] === 'duplicate');
  return (
    <div>
      <h1>Match payments</h1>
      <p>
        How payments are linked automatically: (1) the e-mail on the payment form equals the student's or the parent's
        e-mail of exactly one application; (2) otherwise the name equals one student's or parent's name (same words; accents,
        case and order ignored). Listed here are the rest: unknown e-mail and a name that differs or is shared (siblings,
        two-session students). Compare with "details", pick, and link. A transfer that pays for both sessions can be linked to
        both applications. Identical repeat submissions are listed so you can confirm them.
      </p>
      <label><input type="checkbox" checked={showAll} onChange={() => setShowAll(!showAll)} /> Show all payments ({pays.length})</label>
      {list.length === 0 && <p class="muted">Nothing to match.</p>}
      {list.map((p) => <MatchCard key={p[PAY_COLS.paymentId]} p={p} cfg={snap.cfg!} />)}
    </div>
  );
}

function MatchCard({ p, cfg }: { p: Row; cfg: SeasonConfig }) {
  const { snap, repo, run } = useApp();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>(idList(p[PAY_COLS.matchedApps]));
  const [note, setNote] = useState(p[PAY_COLS.note] ?? '');
  const id = p[PAY_COLS.paymentId];
  const app = (x: string) => snap.apps.find((a) => a[APP_COLS.id] === x);
  const label = (x: string) => {
    const a = app(x);
    return a ? `${x} ${fullName(a, cfg)} — ${a[APP_COLS.session]} ${a[APP_COLS.assignedCourse] || ''} · parent ${field(a, cfg, 'parentName')} · due ${a[APP_COLS.amountDue] || '?'}${a[APP_COLS.paidAt] ? ' · PAID' : ''}` : x;
  };
  const suggestions = (p[PAY_COLS.candidates] ?? '').split('; ').filter(Boolean).map((c) => ({ id: c.split(' ')[0], text: c }));
  const needle = fold(q);
  const found = needle.length >= 2
    ? snap.apps.filter((a) => isActive(a) && fold(`${a[APP_COLS.id]} ${fullName(a, cfg)} ${field(a, cfg, 'parentName')} ${field(a, cfg, 'email')} ${field(a, cfg, 'parentEmail')}`).includes(needle)).slice(0, 8)
    : [];
  const toggle = (x: string) => setPicked(picked.includes(x) ? picked.filter((y) => y !== x) : [...picked, x]);

  return (
    <div class="panel">
      <h2>
        {id}: {p[PAY_COLS.payerName]} <span class="muted small">{p[PAY_COLS.payerEmail]}</span> <span class="badge">{p[PAY_COLS.status]}</span>
      </h2>
      <p class="small muted">
        Proof file: {p[PAY_COLS.proofFile] || '—'} · {p[PAY_COLS.matchMethod]}
        {p[PAY_COLS.duplicateOf] && <> · identical to {p[PAY_COLS.duplicateOf]}</>}
        {p[PAY_COLS.sessionAnswer] && <> · payment for: {p[PAY_COLS.sessionAnswer]}</>}
      </p>
      {suggestions.length > 0 && (
        <div>
          <b>Suggestions:</b>
          {suggestions.map((s) => (
            <label class="cand">
              <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} /> {label(s.id)} <span class="muted small">({s.text.replace(/^\S+ \(|\)$/g, '')})</span>
              <AppDetails id={s.id} />
            </label>
          ))}
        </div>
      )}
      <div class="row">
        <input class="wide" placeholder="Search another application (name, parent, e-mail, ID)" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      </div>
      {found.map((a) => (
        <label class="cand">
          <input type="checkbox" checked={picked.includes(a[APP_COLS.id])} onChange={() => toggle(a[APP_COLS.id])} /> {label(a[APP_COLS.id])}
          <AppDetails id={a[APP_COLS.id]} />
        </label>
      ))}
      {picked.filter((x) => !suggestions.some((s) => s.id === x) && !found.some((a) => a[APP_COLS.id] === x)).map((x) => (
        <label class="cand"><input type="checkbox" checked onChange={() => toggle(x)} /> {label(x)}</label>
      ))}
      <div class="row">
        <input placeholder="Note" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
        <button class="primary" disabled={picked.length === 0} onClick={() => run(() => repo.matchPaymentTo(id, picked, note), `${id} linked to ${picked.join(', ')}.`)}>
          Link to {picked.length > 1 ? `${picked.length} applications` : picked[0] ?? '…'}
        </button>
        <button onClick={() => run(() => repo.ignorePayment(id, note || (p[PAY_COLS.status] === 'duplicate' ? 'repeat submission' : 'ignored')), `${id} set aside.`)}>
          {p[PAY_COLS.status] === 'duplicate' ? 'Confirm: repeat submission' : 'Ignore'}
        </button>
      </div>
    </div>
  );
}

/** Expandable student details next to a match suggestion (to compare with the payer's name and e-mail). */
function AppDetails({ id }: { id: string }) {
  const { snap } = useApp();
  const [open, setOpen] = useState(false);
  const a = snap.apps.find((x) => x[APP_COLS.id] === id);
  if (!a || !snap.cfg) return null;
  const cfg = snap.cfg;
  return (
    <span>
      {' '}
      <button class="link small" onClick={(e) => { e.preventDefault(); setOpen(!open); }}>{open ? 'hide details' : 'details'}</button>
      {open && (
        <table class="kv mini"><tbody>
          <tr><td>Student e-mail / phone</td><td>{field(a, cfg, 'email')} · {field(a, cfg, 'phone')}</td></tr>
          <tr><td>Parent</td><td>{field(a, cfg, 'parentName')} · {field(a, cfg, 'parentEmail')} · {field(a, cfg, 'parentPhone')}</td></tr>
          <tr><td>Address</td><td>{field(a, cfg, 'address')}</td></tr>
          <tr><td>Session / course</td><td>{a[APP_COLS.session]} · {a[APP_COLS.assignedCourse] || '—'} · {stageOf(a)}</td></tr>
          <tr><td>Amount due</td><td>{a[APP_COLS.amountDue] || '?'} EUR{a[APP_COLS.paidAt] ? ` · paid ${a[APP_COLS.paidAt]}` : ''}</td></tr>
          <tr><td>Other applications</td><td>{snap.apps.filter((x) => x[APP_COLS.personKey] === a[APP_COLS.personKey] && x[APP_COLS.id] !== id).map((x) => `${x[APP_COLS.id]} (${x[APP_COLS.session]}, ${x[APP_COLS.status]})`).join(', ') || '—'}</td></tr>
        </tbody></table>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- proof check

/** Proof files dropped in this session: kept in memory only (never stored, never uploaded). */
let proofFiles: File[] = [];

export function Proofs() {
  const { snap, repo, run } = useApp();
  const [pays, setPays] = useState<Row[] | null>(null);
  const [files, setFiles] = useState<File[]>(proofFiles);
  const [choice, setChoice] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState<'todo' | 'all'>('todo');
  useEffect(() => {
    repo.store.readAll('Payments').then(setPays);
  }, [snap]);
  const todo = (pays ?? []).filter((p) => p[PAY_COLS.status] === 'matched' && (filter === 'all' || !['approved', 'rejected'].includes(p[PAY_COLS.proofStatus])));
  const pairing = useMemo(() => pairProofFiles(todo.map((p) => ({ id: p[PAY_COLS.paymentId], proofFile: p[PAY_COLS.proofFile], email: p[PAY_COLS.payerEmail] })), files.map((f) => f.name)), [todo.length, files, pays]);
  if (!snap.cfg || !pays) return <p>Loading…</p>;
  const cfg = snap.cfg;

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    proofFiles = [...proofFiles, ...Array.from(list)];
    setFiles(proofFiles);
  };
  const fileFor = (id: string): File | null => {
    const pr = pairing.get(id);
    if (choice[id] !== undefined) return files[choice[id]] ?? null;
    return pr?.kind === 'paired' ? files[pr.file] : null;
  };
  const expected = (p: Row) => idList(p[PAY_COLS.matchedApps]).reduce((s, x) => s + parseAmount(snap.apps.find((a) => a[APP_COLS.id] === x)?.[APP_COLS.amountDue]), 0);

  const check = async (p: Row) => {
    const f = fileFor(p[PAY_COLS.paymentId]);
    if (!f) return;
    const { text, how } = await extractText(f);
    const a = analyzeProof(text, { amounts: [expected(p)], reference: cfg.paymentReference, iban: cfg.paymentIban });
    await repo.setProofCheck(p[PAY_COLS.paymentId], a.verdict, `${f.name} (${how}): ${a.detail}`);
  };
  const checkAll = async () => {
    const list = todo.filter((p) => fileFor(p[PAY_COLS.paymentId]) && !p[PAY_COLS.proofStatus]);
    let i = 0;
    for (const p of list) {
      setBusy(`Reading proof ${++i} of ${list.length}… (the first one loads the text-recognition engine)`);
      try {
        await check(p);
      } catch (e) {
        await repo.setProofCheck(p[PAY_COLS.paymentId], 'needs-review', `could not read: ${e instanceof Error ? e.message : e}`);
      }
    }
    setBusy('');
    await run(async () => {}, `Checked ${list.length} proof(s).`);
  };

  const likely = todo.filter((p) => p[PAY_COLS.proofStatus] === 'likely-ok');
  return (
    <div>
      <h1>Proof of payment</h1>
      <p>
        Drop the proof files saved from the payment-form e-mails (a whole folder works). They're read <b>in this browser only</b>{' '}
        and forgotten when you close the tab. The app looks for the expected amount, the structured reference
        ({cfg.paymentReference}) and the IBAN ({cfg.paymentIban}): "likely OK" when the amount and the reference or IBAN are
        found. You always make the final call.
      </p>
      <div
        class="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer?.files ?? null);
        }}
      >
        Drop files here, or <input type="file" multiple accept="image/*,.pdf" onChange={(e) => addFiles((e.target as HTMLInputElement).files)} />
        {' '}or a folder: <input type="file" {...({ webkitdirectory: '' } as object)} onChange={(e) => addFiles((e.target as HTMLInputElement).files)} />
        <div class="small muted">{files.length} file(s) loaded{files.length > 0 && <> · <button class="link" onClick={() => { proofFiles = []; setFiles([]); }}>forget them</button></>}</div>
        {repo.store.isDemo && (
          <div class="small">
            Demo: <button class="link" onClick={async () => addFiles(await makeDemoProofs(pays, snap.apps, cfg))}>generate synthetic proof images</button>
          </div>
        )}
      </div>
      <div class="row">
        <button class="primary" disabled={!!busy || files.length === 0} onClick={checkAll}>Check all paired proofs</button>
        {likely.length > 0 && (
          <button
            onClick={() =>
              confirm(`Approve all ${likely.length} "likely OK" payments (they are marked paid)?`) &&
              run(async () => {
                for (const p of likely) await repo.approvePayment(p[PAY_COLS.paymentId], 'approved (likely OK)');
              }, `Approved ${likely.length} payment(s).`)
            }
          >
            Approve all {likely.length} "likely OK"
          </button>
        )}
        <select value={filter} onChange={(e) => setFilter((e.target as HTMLSelectElement).value as 'todo' | 'all')}>
          <option value="todo">To decide</option>
          <option value="all">All linked payments</option>
        </select>
        {busy && <span class="muted">{busy}</span>}
      </div>
      {todo.length === 0 && <p class="muted">Nothing to check. Payments appear here once linked to an application.</p>}
      <table><tbody>
        <tr><th>Payment</th><th>For</th><th>Expected</th><th>Proof file</th><th>Check</th><th>Decision</th></tr>
        {todo.map((p) => (
          <ProofRow key={p[PAY_COLS.paymentId]} p={p} cfg={cfg} expected={expected(p)} pairing={pairing.get(p[PAY_COLS.paymentId])} files={files} file={fileFor(p[PAY_COLS.paymentId])}
            onChoose={(i) => setChoice({ ...choice, [p[PAY_COLS.paymentId]]: i })} onCheck={() => run(() => check(p), 'Checked.')} />
        ))}
      </tbody></table>
    </div>
  );
}

function ProofRow(props: { p: Row; cfg: SeasonConfig; expected: number; pairing?: Pairing; files: File[]; file: File | null; onChoose: (i: number) => void; onCheck: () => void }) {
  const { p, cfg, expected, pairing, files, file } = props;
  const { snap, repo, run } = useApp();
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState('');
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const id = p[PAY_COLS.paymentId];
  const status = p[PAY_COLS.proofStatus];
  const names = idList(p[PAY_COLS.matchedApps]).map((x) => {
    const a = snap.apps.find((y) => y[APP_COLS.id] === x);
    return a ? `${x} ${fullName(a, cfg)}${a[APP_COLS.paidAt] ? ' (paid)' : ''}` : x;
  });
  const options = pairing?.kind === 'ambiguous' ? pairing.files : [];
  return (
    <tr class={status === 'likely-ok' ? 'row-ok' : status === 'needs-review' ? 'row-warn' : ''}>
      <td>{id}<div class="small muted">{p[PAY_COLS.payerName]}</div></td>
      <td class="small">{names.join(', ')}</td>
      <td><b>{expected} EUR</b></td>
      <td class="small">
        {p[PAY_COLS.proofFile]}
        {pairing?.kind === 'missing' && files.length > 0 && <div class="err-text">no file with this name</div>}
        {options.length > 0 && (
          <div>
            <select value={file ? String(files.indexOf(file)) : ''} onChange={(e) => props.onChoose(Number((e.target as HTMLSelectElement).value))}>
              <option value="">{options.length} files share this name — pick…</option>
              {options.map((i) => <option value={String(i)}>{files[i].name} ({Math.round(files[i].size / 1024)} kB, #{i + 1})</option>)}
            </select>
          </div>
        )}
        {file && (
          <div>
            <button class="link" onClick={() => setPreview(preview ? '' : URL.createObjectURL(file))}>{preview ? 'hide' : 'view'}</button>
            <button class="link" onClick={props.onCheck}>check</button>
          </div>
        )}
        {preview && (file?.type === 'application/pdf' ? <a href={preview} target="_blank" rel="noopener">open PDF</a> : <img class="proof" src={preview} />)}
      </td>
      <td class="small">{status ? <b>{status}</b> : <span class="muted">not checked</span>}<div>{p[PAY_COLS.proofDetail]}</div></td>
      <td>
        {status === 'approved' || status === 'rejected' ? (
          <span><b>{status}</b> {p[PAY_COLS.note]}</span>
        ) : (
          <div class="row">
            <input placeholder="Note" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
            <button class="primary" onClick={() => run(() => repo.approvePayment(id, note), `${id} approved: marked paid.`)}>Approve</button>
            <button onClick={() => run(() => repo.rejectProof(id, note || 'proof not OK'), `${id}: proof rejected.`)}>Reject</button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------- awaiting payment, reminders

async function downloadXlsx(rows: object[], header: readonly string[], sheet: string, filename: string) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...header] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  XLSX.writeFile(wb, filename);
}

export function Unpaid() {
  const { snap, repo, run } = useApp();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [final, setFinal] = useState(false);
  const [deadline, setDeadline] = useState('');
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const t = today();
  const dl = deadline || addDays(t, cfg.reminderDays);
  const waiting = snap.apps.filter(awaitingPayment).sort((a, b) => (effectiveDeadline(a) < effectiveDeadline(b) ? -1 : 1));
  const overdue = waiting.filter((a) => isOverdue(a, t));
  const paid = snap.apps.filter((a) => isActive(a) && a[APP_COLS.paidAt]);
  const chosen = waiting.filter((a) => sel.has(a[APP_COLS.id]));
  return (
    <div>
      <h1>Awaiting payment</h1>
      <p>
        Admitted students who haven't paid yet, earliest deadline first. Select students to download a reminder mail merge, then
        confirm that you sent it. The new deadline defaults to today + {cfg.reminderDays} days and can be changed below. After a
        <b> final</b> reminder's deadline the student is flagged for a decision. Students who decide not to come: <b>Unenroll</b>.
      </p>
      <div class="row">
        <button onClick={() => run(async () => { const n = await repo.checkPaymentDeadlines(); return n; }, 'Deadline flags updated.')}>
          Raise flags for passed deadlines ({overdue.length} overdue)
        </button>
        <button onClick={() => setSel(new Set(overdue.map((a) => a[APP_COLS.id])))}>Select all overdue</button>
        <button onClick={() => setSel(new Set())}>Clear selection</button>
      </div>
      <div class="row">
        <label><input type="checkbox" checked={final} onChange={() => setFinal(!final)} /> final reminder</label>
        <label>new deadline <input type="date" min={t} value={dl} onInput={(e) => setDeadline((e.target as HTMLInputElement).value)} /></label>
        <button
          disabled={chosen.length === 0}
          onClick={() => {
            const { rows } = reminderRows(chosen, cfg, t, final, dl);
            downloadXlsx(rows, REMINDER_COLUMNS, 'Reminders', `SOS-${final ? 'final-' : ''}reminders-${t}.xlsx`);
          }}
        >
          Download reminder Excel ({chosen.length})
        </button>
        <button
          class="primary"
          disabled={chosen.length === 0}
          onClick={() =>
            confirm(`Record ${final ? 'a FINAL reminder' : 'a reminder'} for ${chosen.length} student(s), with new deadline ${dl}?`) &&
            run(async () => {
              await repo.recordReminders(chosen.map((a) => a[APP_COLS.id]), final, dl);
              setSel(new Set());
            }, `${final ? 'Final reminders' : 'Reminders'} recorded for ${chosen.length} student(s).`)
          }
        >
          I've sent {final ? 'final ' : ''}reminders to these {chosen.length}
        </button>
      </div>
      <p class="muted small">The reminder Excel contains personal data: delete it after the mail merge.</p>
      <table><tbody>
        <tr><th /><th>ID</th><th>Name</th><th>Course</th><th>Due</th><th>Admitted</th><th>Deadline</th><th>Reminders</th><th /></tr>
        {waiting.map((a) => {
          const id = a[APP_COLS.id];
          const reminders = (a[APP_COLS.reminders] ?? '').split('\n').filter(Boolean);
          return (
            <tr class={isOverdue(a, t) ? 'row-warn' : ''}>
              <td><input type="checkbox" checked={sel.has(id)} onChange={() => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s); }} /></td>
              <td><a href={`#/apps/${id}`}>{id}</a></td>
              <td>{fullName(a, cfg)}</td>
              <td>{a[APP_COLS.assignedCourse]}</td>
              <td>{a[APP_COLS.amountDue]}</td>
              <td>{a[APP_COLS.admittedAt]}</td>
              <td>{effectiveDeadline(a)}{isOverdue(a, t) && <span class="badge warnb">overdue</span>}{a[APP_COLS.finalReminder] === 'TRUE' && <span class="badge">final</span>}</td>
              <td class="small">{reminders.length ? reminders.join(' · ') : '—'}</td>
              <td>
                <button
                  onClick={() => {
                    const reason = prompt(`Unenroll ${id} ${fullName(a, cfg)}? Their course place is freed; the record is kept.\n\nReason:`, 'decided not to participate (did not pay)');
                    if (reason === null || !reason.trim()) return;
                    if (!confirm(`Are you sure you want to unenroll ${id} ${fullName(a, cfg)}?`)) return;
                    run(() => repo.withdraw(id, reason.trim()), `${id} unenrolled.`);
                  }}
                >
                  Unenroll…
                </button>
              </td>
            </tr>
          );
        })}
      </tbody></table>
      <details>
        <summary>Paid ({paid.length})</summary>
        <table><tbody>
          <tr><th>ID</th><th>Name</th><th>Paid on</th><th>Payment(s)</th></tr>
          {paid.map((a) => <tr><td><a href={`#/apps/${a[APP_COLS.id]}`}>{a[APP_COLS.id]}</a></td><td>{fullName(a, cfg)}</td><td>{a[APP_COLS.paidAt]}</td><td>{a[APP_COLS.paymentIds]}</td></tr>)}
        </tbody></table>
      </details>
    </div>
  );
}
