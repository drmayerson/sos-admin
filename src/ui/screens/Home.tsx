import { APP_COLS, FLAG_COLS } from '../../core/types';
import { useApp } from '../ctx';

export function Home() {
  const { snap } = useApp();
  const active = snap.apps.filter((a) => a[APP_COLS.status] === 'active');
  const open = snap.flags.filter((f) => f[FLAG_COLS.status] === 'open');
  const openOf = (t: string) => open.filter((f) => f[FLAG_COLS.type] === t).length;
  const bySession = (k: string) => active.filter((a) => a[APP_COLS.session] === k).length;

  return (
    <div>
      <h1>Summer of Science — admin</h1>
      {!snap.cfg && (
        <p class="warn">
          No season is set up yet. Start with <a href="#/setup">Season setup</a>.
        </p>
      )}
      <div class="cards">
        <Card n={active.length} label="active applications" href="#/apps" />
        {snap.cfg?.sessions.map((s) => <Card n={bySession(s.key)} label={s.label} href="#/apps" />)}
        <Card n={active.filter((a) => a[APP_COLS.flStatus] === 'claimed').length} label="claim Flemish status (school check: phase 4)" />
        <Card n={open.length} label="open flags" href="#/flags" alert={open.length > 0} />
        <Card n={openOf('NEAR_DUPLICATE')} label="near-duplicates to review" href="#/merge" alert={openOf('NEAR_DUPLICATE') > 0} />
        <Card n={openOf('YOUNG')} label="young students to decide" href="#/young" alert={openOf('YOUNG') > 0} />
      </div>
      <h2>Assignment</h2>
      <div class="cards">
        <Card n={active.filter((a) => a[APP_COLS.assignedCourse]).length} label="assigned to a course" href="#/assign" />
        <Card n={active.filter((a) => !a[APP_COLS.assignedCourse]).length} label="without a course (waitlist)" href="#/waitlist" />
        <Card n={active.filter((a) => a[APP_COLS.dormWaiting] === 'TRUE').length} label="waiting for a dorm place" href="#/dorms" alert={active.some((a) => a[APP_COLS.dormWaiting] === 'TRUE')} />
        <Card n={active.filter((a) => a[APP_COLS.locked] === 'TRUE').length} label="locked" href="#/lock" />
        <Card n={active.filter((a) => a[APP_COLS.locked] === 'TRUE' && !a[APP_COLS.admittedAt]).length} label="locked, admission e-mail not sent" href="#/admit" alert={active.some((a) => a[APP_COLS.locked] === 'TRUE' && !a[APP_COLS.admittedAt])} />
        <Card n={active.filter((a) => a[APP_COLS.admittedAt]).length} label="admitted" href="#/admit" />
      </div>
      <h2>Next steps</h2>
      <ol>
        <li><a href="#/setup">Season setup</a>: sessions, courses, capacities, fees, thresholds, column mapping.</li>
        <li><a href="#/import">Import CSV</a>: upload the full application export (always all applications); only new rows are added.</li>
        <li>Review <a href="#/merge">near-duplicates</a>, <a href="#/young">young students</a> and other <a href="#/flags">flags</a>.</li>
        <li><a href="#/assign">Assign courses</a> (preview, then apply); handle the <a href="#/waitlist">waitlist</a> and <a href="#/dorms">dorm full</a> list.</li>
        <li><a href="#/lock">Lock</a> students, then send the <a href="#/admit">admission e-mails</a>.</li>
      </ol>
      <p class="muted">Payments follow in phase 3.</p>
    </div>
  );
}

function Card({ n, label, href, alert }: { n: number; label: string; href?: string; alert?: boolean }) {
  const inner = (
    <>
      <div class={`num ${alert ? 'alert' : ''}`}>{n}</div>
      <div class="label">{label}</div>
    </>
  );
  return href ? <a class="card" href={href}>{inner}</a> : <div class="card">{inner}</div>;
}
