import { useState } from 'preact/hooks';
import { courseRosters, dormList, medicalDietaryList, noPhotoList, studentsAt, type Who } from '../../core/exports';
import { useApp } from '../ctx';
import { downloadWorkbook } from '../files';

export function Exports() {
  const { snap } = useApp();
  const [who, setWho] = useState<Who>('admitted');
  const [contacts, setContacts] = useState(false);
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const n = studentsAt(snap.apps, who).length;
  const day = new Date().toISOString().slice(0, 10);
  const med = medicalDietaryList(snap.apps, cfg, who);
  return (
    <div>
      <h1>Rosters &amp; lists</h1>
      <p>
        Excel files made in this browser from the current data. They contain personal data: share them only with the people who
        need them, and delete them afterwards.
      </p>
      <div class="row">
        <label>
          Students:{' '}
          <select value={who} onChange={(e) => setWho((e.target as HTMLSelectElement).value as Who)}>
            <option value="assigned">all with a course</option>
            <option value="locked">locked</option>
            <option value="admitted">admitted</option>
            <option value="paid">paid</option>
          </select>
        </label>
        <span class="muted">{n} student(s)</span>
      </div>
      <div class="panel">
        <h2>Course rosters</h2>
        <p>One sheet per course: name, age, gender, school, grade, accommodation, laptop, photo permission.</p>
        <label><input type="checkbox" checked={contacts} onChange={() => setContacts(!contacts)} /> include contact details (student e-mail/phone, parent name/phone)</label>
        <p><button class="primary" disabled={n === 0} onClick={() => downloadWorkbook(courseRosters(snap.apps, cfg, who, contacts), `SOS-rosters-${day}.xlsx`)}>Download rosters</button></p>
      </div>
      <div class="panel">
        <h2>Medical &amp; dietary list ({med.length})</h2>
        <p class="warn small">
          Special-category (health) data. Only students who filled something in, only the columns needed. Give it only to the
          people who must know (e.g. catering, dorm supervisors) and delete it after the summer school.
        </p>
        <button disabled={med.length === 0} onClick={() => downloadWorkbook([{ sheet: 'Medical & dietary', rows: med }], `SOS-medical-dietary-${day}.xlsx`)}>Download medical &amp; dietary list</button>
      </div>
      <div class="panel">
        <h2>Other lists</h2>
        <div class="row">
          <button disabled={n === 0} onClick={() => downloadWorkbook([{ sheet: 'No photo permission', rows: noPhotoList(snap.apps, cfg, who) }], `SOS-no-photo-${day}.xlsx`)}>No photo permission</button>
          <button disabled={n === 0} onClick={() => downloadWorkbook([{ sheet: 'Dorms', rows: dormList(snap.apps, cfg, who) }], `SOS-dorms-${day}.xlsx`)}>Dorm list (FULL students, hall requests)</button>
        </div>
      </div>
    </div>
  );
}
