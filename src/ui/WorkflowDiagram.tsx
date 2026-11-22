// The admission workflow as a flow diagram (Home screen). Stage boxes on one line; between two stages, a green chip
// for students ready to move on and amber/grey side branches for what holds students back, which rejoin the main
// line at the next stage. Line thickness = number of students. Everything links to the screen that handles it.
import { useEffect, useState } from 'preact/hooks';
import { brusselsDate } from '../core/dates';
import type { Row } from '../core/types';
import { workflow, type Item } from '../core/workflow';
import { useApp } from './ctx';

const W = 980;
const BW = 104; // stage box width
const BH = 58;
const BY = 50; // stage box top
const GAP = (W - 30 - 5 * BW) / 4;
const CW = 170; // chip / branch box width
const RH = 26; // branch box height
const ROW0 = 130;
const ROWS = 36;
const LINE_Y = BY + BH / 2;

const xOf = (i: number) => 10 + i * (BW + GAP);

/** Something you can act on now: needs you, or students ready to move on. Drawn bold with a thick border. */
const actionable = (it: Item) => it.n > 0 && it.kind !== 'wait';

function Chip({ it, x, y }: { it: Item; x: number; y: number }) {
  const zero = it.n === 0;
  return (
    <a href={it.href} class={`wf-chip wf-${it.kind}${zero ? ' wf-zero' : ''}${actionable(it) ? ' wf-act' : ''}`}>
      <title>{it.action}</title>
      <rect x={x} y={y} width={CW} height={RH} rx={5} />
      <text x={x + CW / 2} y={y + RH / 2} text-anchor="middle" dominant-baseline="central">
        {it.n} {it.label}{it.kind !== 'wait' && !zero ? ' →' : ''}
      </text>
    </a>
  );
}

export function WorkflowDiagram() {
  const { snap, repo } = useApp();
  const [payments, setPayments] = useState<Row[] | null>(null);
  useEffect(() => {
    repo.store.readAll('Payments').then(setPayments, () => setPayments(null));
  }, [snap]);
  if (!snap.cfg) return null;
  const wf = workflow(snap.apps, snap.flags, payments, snap.cfg, brusselsDate());
  const total = Math.max(1, wf.stages[0].reached);
  const thick = (n: number, max: number) => (n === 0 ? 1 : 2 + max * Math.sqrt(n / total));
  const maxRows = Math.max(...wf.gates.map((g) => g.branches.length));
  const H = ROW0 + maxRows * ROWS + 6;

  return (
    <div class="wf">
      <div class="wf-next-line">
        {wf.todo.length ? (
          <>
            <b>{wf.todo.length} place(s) where you can act now</b>{' '}
            <span class="muted small">(bold, with a thick border; hover for what to do, click to go there)</span>
          </>
        ) : (
          <span class="muted">Nothing to do right now.</span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} class="wf-svg" role="img" aria-label="Admission workflow">
        <defs>
          <marker id="wf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="20" markerHeight="20" orient="auto-start-reverse">
            <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </marker>
        </defs>

        {/* main line between stages, thickness = students that got (at least) as far as the next stage */}
        {wf.stages.slice(1).map((s, i) => (
          <line class="wf-main" x1={xOf(i) + BW + 2} y1={LINE_Y} x2={xOf(i + 1) - 4} y2={LINE_Y} stroke-width={thick(s.reached, 12)} marker-end="url(#wf-arrow)" />
        ))}

        {/* branches: down from the stage, through the branch box, back up into the next stage */}
        {wf.gates.map((g, i) => {
          const cx = xOf(i) + BW + GAP / 2;
          const left = cx - CW / 2;
          const right = cx + CW / 2;
          return g.branches.map((b, j) => {
            const y = ROW0 + j * ROWS;
            const yc = y + RH / 2;
            const down = xOf(i) + 68 - 5 * j;
            const up = xOf(i + 1) + 35 + 5 * j;
            const w = thick(b.n, 6);
            return (
              <g class={`wf-branch wf-${b.kind}${b.n === 0 ? ' wf-zero' : ''}`}>
                <path d={`M${down} ${BY + BH} V${yc} H${left - 1}`} fill="none" stroke-width={w} />
                <path d={`M${right + 1} ${yc} H${up} V${BY + BH + 5}`} fill="none" stroke-width={w} stroke-dasharray="5 4" marker-end="url(#wf-arrow)" />
              </g>
            );
          });
        })}

        {wf.stages.map((s, i) => (
          <a href={s.href} class="wf-stage">
            <title>{`${s.n} student(s) currently ${s.label.toLowerCase()}; ${s.reached} got this far`}</title>
            <rect x={xOf(i)} y={BY} width={BW} height={BH} rx={8} />
            <text x={xOf(i) + BW / 2} y={BY + 19} text-anchor="middle" dominant-baseline="central" class="wf-stage-label">{s.label}</text>
            <text x={xOf(i) + BW / 2} y={BY + 41} text-anchor="middle" dominant-baseline="central" class="wf-stage-n">{s.n}</text>
          </a>
        ))}

        {wf.gates.map((g, i) => {
          const cx = xOf(i) + BW + GAP / 2;
          return (
            <>
              {g.ready && <Chip it={g.ready} x={cx - CW / 2} y={10} />}
              {g.branches.map((b, j) => <Chip it={b} x={cx - CW / 2} y={ROW0 + j * ROWS} />)}
            </>
          );
        })}
      </svg>
      <div class="wf-legend small">
        <span class="wf-key wf-ready">ready to move on (your action)</span>
        <span class="wf-key wf-todo">needs you</span>
        <span class="wf-key wf-wait">waiting on others</span>
        <span class="muted">Line thickness = number of students. A student can wait for several things at once. Click anything to go there.</span>
        {wf.side.map((s) => (
          <a href={s.href} class={`wf-key wf-${s.kind}${s.n === 0 ? ' wf-zero' : ''}`} title={s.action}>
            {s.n} {s.label}
          </a>
        ))}
      </div>
    </div>
  );
}
