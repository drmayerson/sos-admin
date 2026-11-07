import { checkMapping } from './headers';
import { postingToUTC } from './dates';
import { feeColumns } from './fees';
import { computeAutoFlags, derivedChoices, field } from './flags';
import type { ParsedCsv } from './csv';
import { fold, normEmail, tidy } from './text';
import { APP_COLS, FIELD_KEYS, type FieldKey, type NewFlag, type Row, type SeasonConfig } from './types';

export interface PlannedFlag extends NewFlag {
  appId: string;
}

export interface ImportPlan {
  /** Blocking problems: nothing may be imported. */
  errors: string[];
  /** Non-blocking remarks (shown in the preview). */
  warnings: string[];
  totalRows: number;
  blankRows: number;
  alreadyImported: number;
  /** Rows that could not be read (e.g. bad timestamp); not imported, so a later import retries them. */
  skipped: { rowNo: number; reason: string }[];
  /** New Applications rows, in posting order. */
  newApps: Row[];
  /** RawImports rows: every newly seen CSV row exactly as received (+ meta columns). */
  rawRows: Row[];
  exactDuplicates: { rowNo: number; name: string; posting: string; duplicateOf: string }[];
  nearDuplicates: { appId: string; ofId: string; reason: string; differs: string[] }[];
  flags: PlannedFlag[];
}

export interface ImportInput {
  csv: ParsedCsv;
  cfg: SeasonConfig;
  existingApps: Row[];
  existingRaw: Row[];
  importedAt: string;
}

/** Import key: original posting text + normalised student e-mail. Recognises rows already imported. */
export function importKeyOf(row: Row, cfg: SeasonConfig): string {
  return `${field(row, cfg, 'posting').trim()}|${normEmail(field(row, cfg, 'email'))}`;
}

const CONTENT_FIELDS = FIELD_KEYS.filter((k) => k !== 'posting');

/** Everything except the timestamp, whitespace- and case-insensitive. Equal keys = exact duplicate. */
export function contentKeyOf(row: Row, cfg: SeasonConfig): string {
  return CONTENT_FIELDS.map((k) => field(row, cfg, k).replace(/\s+/g, ' ').trim().toLowerCase()).join('\u0001');
}

/** Person keys used for near-duplicate detection and for linking one student's applications. */
export function personMatchKeys(row: Row, cfg: SeasonConfig): string[] {
  const keys: string[] = [];
  const e = normEmail(field(row, cfg, 'email'));
  if (e) keys.push(`e:${e}`);
  const n = fold(`${field(row, cfg, 'firstName')} ${field(row, cfg, 'surname')}`);
  const b = field(row, cfg, 'birthDate').trim();
  if (n && b) keys.push(`nb:${n}|${b}`);
  return keys;
}

export function formatId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

export function nextIdNumber(apps: Row[], prefix: string): number {
  let max = 0;
  for (const a of apps) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(a[APP_COLS.id] ?? '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

const LABELS: Partial<Record<FieldKey, string>> = {
  firstName: 'first name', surname: 'surname', email: 'e-mail', phone: 'phone', birthDate: 'birth date', address: 'address',
  s1c1: 'Session I 1st choice', s1c2: 'Session I 2nd choice', s1c3: 'Session I 3rd choice',
  s2c1: 'Session II 1st choice', s2c2: 'Session II 2nd choice', s2c3: 'Session II 3rd choice',
  remarks: 'remarks', motivation: 'motivation', school: 'school', accommodation: 'accommodation',
};

/** Form fields whose (loosely compared) values differ between two rows. Returns field keys. */
export function differingFields(a: Row, b: Row, cfg: SeasonConfig): FieldKey[] {
  return CONTENT_FIELDS.filter(
    (k) => field(a, cfg, k).replace(/\s+/g, ' ').trim().toLowerCase() !== field(b, cfg, k).replace(/\s+/g, ' ').trim().toLowerCase(),
  );
}

/** Build a new Applications row from a CSV row. */
export function newAppRow(values: Row, cfg: SeasonConfig, id: string, importKey: string, postingUTC: string, personKey: string): Row {
  const row: Row = {};
  for (const k of FIELD_KEYS) row[cfg.columnMap[k]] = tidy(values[cfg.columnMap[k]] ?? '');
  const { session, choices } = derivedChoices(row, cfg);
  Object.assign(row, {
    [APP_COLS.id]: id,
    [APP_COLS.importKey]: importKey,
    [APP_COLS.personKey]: personKey,
    [APP_COLS.postingUTC]: postingUTC,
    [APP_COLS.status]: 'active',
    [APP_COLS.mergedInto]: '',
    [APP_COLS.session]: session,
    [APP_COLS.choice1]: choices[0],
    [APP_COLS.choice2]: choices[1],
    [APP_COLS.choice3]: choices[2],
    [APP_COLS.flStatus]: field(row, cfg, 'status').trim() === cfg.flemishStatusValue ? 'claimed' : 'n.a.',
    [APP_COLS.openFlags]: '',
    [APP_COLS.emailSentCourse]: '',
    [APP_COLS.courseOK]: '',
    [APP_COLS.emailSentStudent]: '',
    [APP_COLS.dormOK]: '',
    [APP_COLS.okForCourses]: '',
    [APP_COLS.notOkForCourses]: '',
    [APP_COLS.assignedCourse]: '',
    [APP_COLS.youngApprovedWith]: '',
    [APP_COLS.assignNote]: '',
    [APP_COLS.pinnedCourse]: '',
    [APP_COLS.dormWaiting]: '',
    [APP_COLS.accommodationFinal]: '',
    [APP_COLS.locked]: '',
    [APP_COLS.lockedAt]: '',
    [APP_COLS.fee]: '',
    [APP_COLS.aid]: '',
    [APP_COLS.aidNote]: '',
    [APP_COLS.amountDue]: '',
    [APP_COLS.admittedAt]: '',
    [APP_COLS.paymentDeadline]: '',
    [APP_COLS.notes]: '',
    [APP_COLS.withdrawnReason]: '',
  });
  Object.assign(row, feeColumns(row, cfg));
  return row;
}

/**
 * Work out what an import would do, without changing anything. Pure: the caller shows the plan as a
 * preview and, after confirmation, writes it to the store.
 */
export function planImport({ csv, cfg, existingApps, existingRaw, importedAt }: ImportInput): ImportPlan {
  const plan: ImportPlan = {
    errors: [...csv.errors],
    warnings: [],
    totalRows: csv.rows.length + csv.blankRows,
    blankRows: csv.blankRows,
    alreadyImported: 0,
    skipped: [],
    newApps: [],
    rawRows: [],
    exactDuplicates: [],
    nearDuplicates: [],
    flags: [],
  };

  // 1. Headers must match the season's column map exactly.
  const mc = checkMapping(cfg.columnMap, csv.headers);
  for (const f of mc.missing) plan.errors.push(`Column for "${f}" not found in the file (expected header: "${cfg.columnMap[f]}").`);
  for (const [f, h] of Object.entries(mc.suggested))
    plan.errors.push(`Column for "${f}" has a different header ("${h}"). Confirm the mapping in Season setup first.`);
  if (mc.unknown.length) plan.warnings.push(`Unknown columns (kept in RawImports only): ${mc.unknown.join(' | ')}`);

  // 2. Excel re-save detection on birth dates.
  const bdHeader = cfg.columnMap.birthDate;
  const excelDates = csv.rows.filter((r) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test((r.values[bdHeader] ?? '').trim())).length;
  if (excelDates > 0)
    plan.errors.push(
      `${excelDates} birth date(s) look like dd/mm/yyyy instead of yyyy-mm-dd: the file was probably re-saved in Excel. Please upload the original download.`,
    );
  if (plan.errors.length) return plan;

  // 3. Rows already imported (by import key) are skipped silently.
  const seenKeys = new Set<string>([
    ...existingApps.map((a) => a[APP_COLS.importKey]),
    ...existingRaw.map((r) => r.ImportKey),
  ]);
  type Cand = { rowNo: number; values: Row; key: string; utc: string };
  const cands: Cand[] = [];
  for (const r of csv.rows) {
    const key = importKeyOf(r.values, cfg);
    if (seenKeys.has(key)) {
      plan.alreadyImported++;
      continue;
    }
    const utc = postingToUTC(field(r.values, cfg, 'posting'));
    if (!utc) {
      plan.skipped.push({ rowNo: r.rowNo, reason: `Unreadable Posting Date/Time "${field(r.values, cfg, 'posting')}"` });
      continue;
    }
    seenKeys.add(key); // identical rows within one file count once
    cands.push({ rowNo: r.rowNo, values: r.values, key, utc });
  }
  // Unreadable timestamps block the whole import: importing the other rows now and these later
  // would give them out-of-order IDs.
  if (plan.skipped.length) {
    plan.errors.push(
      `${plan.skipped.length} row(s) have an unreadable Posting Date/Time, e.g. "${plan.skipped[0].reason.replace(/^.*?"/, '').replace(/"$/, '')}". Nothing was imported; please report this format.`,
    );
    return plan;
  }
  cands.sort((a, b) => (a.utc < b.utc ? -1 : a.utc > b.utc ? 1 : a.rowNo - b.rowNo));

  // 4. Lookup tables from what is already stored.
  const contentToId = new Map<string, string>();
  for (const r of existingRaw) {
    const id = r.AppID || r.DuplicateOf;
    if (id && !contentToId.has(contentKeyOf(r, cfg))) contentToId.set(contentKeyOf(r, cfg), id);
  }
  const people: Row[] = [...existingApps];
  let n = nextIdNumber(existingApps, cfg.idPrefix);

  for (const c of cands) {
    const meta = { ImportedAt: importedAt, RowNo: String(c.rowNo), ImportKey: c.key, AppID: '', DuplicateOf: '' };
    const ck = contentKeyOf(c.values, cfg);
    const name = `${field(c.values, cfg, 'firstName')} ${field(c.values, cfg, 'surname')}`.replace(/\s+/g, ' ').trim();

    const dupOf = contentToId.get(ck);
    if (dupOf) {
      plan.exactDuplicates.push({ rowNo: c.rowNo, name, posting: field(c.values, cfg, 'posting'), duplicateOf: dupOf });
      plan.rawRows.push({ ...c.values, ...meta, DuplicateOf: dupOf });
      continue;
    }

    const id = formatId(cfg.idPrefix, n++);
    contentToId.set(ck, id);

    // Same person? (e-mail, or name + birth date)
    const myKeys = personMatchKeys(c.values, cfg);
    const samePerson = people.filter((p) => personMatchKeys(p, cfg).some((k) => myKeys.includes(k)));
    const personKey = samePerson.length ? samePerson[0][APP_COLS.personKey] || samePerson[0][APP_COLS.id] : id;

    const app = newAppRow(c.values, cfg, id, c.key, c.utc, personKey);
    plan.newApps.push(app);
    plan.rawRows.push({ ...c.values, ...meta, AppID: id });

    // Near-duplicate: same person AND same session (different sessions = two legitimate applications).
    // With 3+ submissions, every later one points at the EARLIEST application of the group, so the
    // group can be reviewed and merged together.
    const near = samePerson
      .filter((p) => p[APP_COLS.status] !== 'merged' && p[APP_COLS.session] === app[APP_COLS.session])
      .sort((a, b) => (a[APP_COLS.postingUTC] < b[APP_COLS.postingUTC] ? -1 : 1))[0];
    if (near) {
      const how = myKeys.find((k) => k.startsWith('e:') && personMatchKeys(near, cfg).includes(k)) ? 'same e-mail' : 'same name + birth date';
      const differs = differingFields(near, app, cfg).map((k) => LABELS[k] ?? cfg.columnMap[k]);
      plan.nearDuplicates.push({ appId: id, ofId: near[APP_COLS.id], reason: how, differs });
      plan.flags.push({
        appId: id,
        type: 'NEAR_DUPLICATE',
        detail: `Possible resubmission of ${near[APP_COLS.id]} (${how}). Differs in: ${differs.join(', ') || 'nothing'}.`,
      });
    }

    for (const f of computeAutoFlags(app, cfg)) plan.flags.push({ appId: id, ...f });
    people.push(app);
  }
  return plan;
}
