import { useState } from 'preact/hooks';
import { APP_COLS, type Row } from '../core/types';
import { unenrollEffects } from '../core/unenroll';
import { fullName, useApp } from './ctx';

/** "Unenroll…" button that opens the confirmation dialog for this student. */
export function UnenrollButton({ app, label = 'Unenroll…' }: { app: Row; label?: string }) {
  const [open, setOpen] = useState(false);
  if ((app[APP_COLS.status] || 'active') !== 'active') return null;
  return (
    <>
      <button class="danger" onClick={() => setOpen(true)}>{label}</button>
      {open && <UnenrollDialog app={app} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Confirmation for a complete unenrolment, listing its effects. A student who already paid needs a note and a
 * yes/no on reimbursement, and then appears on the "Unenrolled after paid" list.
 */
export function UnenrollDialog({ app, onClose }: { app: Row; onClose: () => void }) {
  const { snap, repo, run } = useApp();
  const cfg = snap.cfg!;
  const id = app[APP_COLS.id];
  const paid = !!app[APP_COLS.paidAt];
  const [reason, setReason] = useState(paid ? '' : 'decided not to participate');
  const [note, setNote] = useState('');
  const [eligible, setEligible] = useState<'' | 'yes' | 'no'>('');
  const [sure, setSure] = useState(false);
  const ok = reason.trim() && sure && (!paid || (note.trim() && eligible));
  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Unenroll {id} {fullName(app, cfg)}?</h2>
        {paid && <div class="msg err"><b>This student has already paid.</b> Unenrolling after payment is exceptional.</div>}
        <p><b>What happens:</b></p>
        <ul>{unenrollEffects(app, cfg).map((e) => <li>{e}</li>)}</ul>
        <div class="fields">
          <label class="span2">Reason (logged)<input value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} /></label>
          {paid && (
            <>
              <label class="span2">Note for the reimbursement list (required)<textarea rows={2} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} /></label>
              <div class="span2">
                <b>Eligible for reimbursement?</b>{' '}
                <label><input type="radio" checked={eligible === 'yes'} onChange={() => setEligible('yes')} /> yes</label>{' '}
                <label><input type="radio" checked={eligible === 'no'} onChange={() => setEligible('no')} /> no</label>
              </div>
            </>
          )}
        </div>
        <p><label><input type="checkbox" checked={sure} onChange={() => setSure(!sure)} /> I'm sure: unenroll this student completely.</label></p>
        <div class="row">
          <button
            class="danger"
            disabled={!ok}
            onClick={async () => {
              const done = await run(
                () => repo.unenroll(id, reason, paid ? { eligible: eligible === 'yes', note } : undefined),
                `${id} unenrolled.${paid ? ' See "Unenrolled after paid".' : ''}`,
              );
              if (done) onClose();
            }}
          >
            Unenroll {id}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
