import { useState } from 'preact/hooks';
import { decodeUtf8, parseCsv } from '../../core/csv';
import type { ImportPlan } from '../../core/importer';
import { APP_COLS } from '../../core/types';
import { DEMO_FILES } from '../../store/demo';
import { fmtTime, fullName, useApp } from '../ctx';

export function Import() {
  const { repo, snap, run } = useApp();
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [done, setDone] = useState(false);

  async function load(name: string, bytes: Uint8Array) {
    setFileName(name);
    setPlan(null);
    setDone(false);
    setError('');
    const d = decodeUtf8(bytes);
    if (!d.ok) return setError(d.error!);
    try {
      setPlan(await repo.previewImport(parseCsv(d.text)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) await load(f.name, new Uint8Array(await f.arrayBuffer()));
    (e.target as HTMLInputElement).value = '';
  }

  async function confirm() {
    if (!plan) return;
    const ok = await run(() => repo.commitImport(plan), `Imported ${plan.newApps.length} new application(s).`);
    if (ok) setDone(true);
  }

  if (!snap.cfg) return <p class="warn">Set up the season first (<a href="#/setup">Season setup</a>).</p>;
  const cfg = snap.cfg;
  const flagCounts = plan ? Object.entries(plan.flags.reduce<Record<string, number>>((m, f) => ((m[f.type] = (m[f.type] ?? 0) + 1), m), {})) : [];

  return (
    <div>
      <h1>Import applications</h1>
      <p>
        Upload the <b>original</b> CSV export from the website (all applications so far). Don't open it in Excel first.
        Rows that were imported before are recognised and skipped. Nothing is written until you confirm the preview.
      </p>
      <input type="file" accept=".csv,text/csv" onChange={onFile} />
      {repo.store.isDemo && (
        <p class="muted">
          Demo:{' '}
          {DEMO_FILES.map((f) => (
            <button
              class="link"
              onClick={async () => load(f.name, new Uint8Array(await (await fetch(f.url)).arrayBuffer()))}
            >
              {f.label}
            </button>
          ))}
        </p>
      )}
      {fileName && <h2>{fileName}</h2>}
      {error && <div class="msg err">{error}</div>}
      {plan && (
        <div>
          {plan.errors.length > 0 && (
            <div class="msg err">
              <b>This file can't be imported:</b>
              <ul>{plan.errors.map((e) => <li>{e}</li>)}</ul>
            </div>
          )}
          {plan.warnings.map((w) => <div class="msg warn">{w}</div>)}
          {plan.errors.length === 0 && (
            <>
              <table class="kv"><tbody>
                <tr><td>Rows in file</td><td>{plan.totalRows}</td></tr>
                <tr><td>Blank rows skipped</td><td>{plan.blankRows}</td></tr>
                <tr><td>Already imported before</td><td>{plan.alreadyImported}</td></tr>
                <tr><td><b>New applications</b></td><td><b>{plan.newApps.length}</b></td></tr>
                <tr><td>Exact duplicates (ignored automatically)</td><td>{plan.exactDuplicates.length}</td></tr>
                <tr><td>Near-duplicates (to review)</td><td>{plan.nearDuplicates.length}</td></tr>
              </tbody></table>
              {flagCounts.length > 0 && (
                <p>Flags that will be raised: {flagCounts.map(([t, n]) => <span class="badge">{t} {n}</span>)}</p>
              )}
              {plan.exactDuplicates.length > 0 && (
                <details>
                  <summary>Exact duplicates ({plan.exactDuplicates.length})</summary>
                  <table><tbody>
                    <tr><th>CSV record</th><th>Name</th><th>Posted</th><th>Duplicate of</th></tr>
                    {plan.exactDuplicates.map((d) => <tr><td>{d.rowNo}</td><td>{d.name}</td><td>{d.posting}</td><td>{d.duplicateOf}</td></tr>)}
                  </tbody></table>
                </details>
              )}
              {plan.nearDuplicates.length > 0 && (
                <details open>
                  <summary>Near-duplicates ({plan.nearDuplicates.length}) — imported with their own ID; merge them afterwards</summary>
                  <table><tbody>
                    <tr><th>New ID</th><th>Possible resubmission of</th><th>Matched on</th><th>Differs in</th></tr>
                    {plan.nearDuplicates.map((d) => <tr><td>{d.appId}</td><td>{d.ofId}</td><td>{d.reason}</td><td>{d.differs.join(', ')}</td></tr>)}
                  </tbody></table>
                </details>
              )}
              {plan.newApps.length > 0 && (
                <details>
                  <summary>New applications ({plan.newApps.length})</summary>
                  <table><tbody>
                    <tr><th>ID</th><th>Name</th><th>Session</th><th>Posted</th></tr>
                    {plan.newApps.map((a) => (
                      <tr><td>{a[APP_COLS.id]}</td><td>{fullName(a, cfg)}</td><td>{a[APP_COLS.session]}</td><td>{fmtTime(a[APP_COLS.postingUTC])}</td></tr>
                    ))}
                  </tbody></table>
                </details>
              )}
              {!done && plan.newApps.length + plan.exactDuplicates.length > 0 && (
                <p><button class="primary" onClick={confirm}>Import {plan.newApps.length} application(s)</button></p>
              )}
              {!done && plan.newApps.length + plan.exactDuplicates.length === 0 && <p>Nothing new to import.</p>}
              {done && (
                <p class="msg ok">
                  Done. Next: <a href="#/merge">near-duplicates</a>, <a href="#/young">young students</a>, <a href="#/flags">flags</a>.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
