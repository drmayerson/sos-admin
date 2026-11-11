import { brusselsDate } from '../../core/dates';
import { useState } from 'preact/hooks';
import { courseRosters, dormList, medicalDietaryList, noPhotoList, studentsAt, type Who } from '../../core/exports';
import { courseCards, courseMailingCsv, sessionEmailList } from '../../core/rosters';
import { APP_COLS } from '../../core/types';
import { useApp } from '../ctx';
import { downloadWorkbook } from '../files';
import { downloadBlob, downloadText, rosterPdf } from '../pdf';
import { WhoSelect } from './Dashboard';

export function Exports() {
  const { snap } = useApp();
  const [who, setWho] = useState<Who>('paid');
  const [contacts, setContacts] = useState(false);
  const [busy, setBusy] = useState('');
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const list = studentsAt(snap.apps, who);
  const n = list.length;
  const day = brusselsDate();
  const med = medicalDietaryList(snap.apps, cfg, who);
  const pdf = async (course: string | null) => {
    setBusy('Making the PDF…');
    try {
      const cards = course ? courseCards(snap.apps, cfg, course, who) : cfg.courses.flatMap((c) => courseCards(snap.apps, cfg, c.code, who));
      downloadBlob(await rosterPdf(cards), `SOS-${course ?? 'all-courses'}-student-cards-${day}.pdf`);
    } finally {
      setBusy('');
    }
  };

  return (
    <div>
      <h1>Rosters &amp; lists</h1>
      <p>
        Files made in this browser from the current data. They contain personal data: share them only with the people who need
        them, and delete them afterwards. Normally only students who are <b>admitted and paid</b> (confirmed) are included.
      </p>
      <div class="row">
        <label>Students: <WhoSelect who={who} setWho={setWho} /></label>
        <span class="muted">{n} student(s)</span>
        {busy && <span class="muted">{busy}</span>}
      </div>

      <div class="panel">
        <h2>Per course</h2>
        <p class="small">
          <b>Student cards</b>: a PDF with one page per student (name, e-mail, birth date, gender, years left, nationality,
          laptop, photo permission, choices, medical conditions, motivation) — contains health data, for the course teachers
          only. <b>Mailing list</b>: CSV with "Student full name, Student e-mail address".
        </p>
        <table><tbody>
          <tr><th>Course</th><th>Students</th><th /><th /></tr>
          {cfg.courses.map((c) => {
            const k = list.filter((a) => a[APP_COLS.assignedCourse] === c.code).length;
            return (
              <tr>
                <td>{c.code} ({c.session})</td>
                <td>{k}</td>
                <td><button disabled={!k || !!busy} onClick={() => pdf(c.code)}>Student cards (PDF)</button></td>
                <td><button disabled={!k} onClick={() => downloadText(courseMailingCsv(snap.apps, cfg, c.code, who), `SOS-${c.code}-mailing-list-${day}.csv`, 'text/csv')}>Mailing list (CSV)</button></td>
              </tr>
            );
          })}
        </tbody></table>
        <button disabled={!n || !!busy} onClick={() => pdf(null)}>All courses' student cards in one PDF</button>
      </div>

      <div class="panel">
        <h2>Per session: e-mail list for the mailing-list server</h2>
        <p class="small">
          A text file with one <code>email name</code> per line: every student, plus the parent when "send all organizational
          e-mails ALSO to this parent e-mail address" was ticked (as "Name (parent of Student)"). Each address appears once.
        </p>
        <div class="row">
          {cfg.sessions.map((s) => (
            <button disabled={!list.some((a) => a[APP_COLS.session] === s.key)} onClick={() => downloadText(sessionEmailList(snap.apps, cfg, s.key, who), `SOS-${s.key}-email-list-${day}.txt`)}>
              {s.label.replace(/\s*\(.*$/, '')} e-mail list (TXT)
            </button>
          ))}
        </div>
      </div>

      <div class="panel">
        <h2>Excel lists</h2>
        <label><input type="checkbox" checked={contacts} onChange={() => setContacts(!contacts)} /> course rosters with contact details (student e-mail/phone, parent name/phone)</label>
        <div class="row">
          <button disabled={n === 0} onClick={() => downloadWorkbook(courseRosters(snap.apps, cfg, who, contacts), `SOS-rosters-${day}.xlsx`)}>Course rosters (one sheet per course)</button>
          <button disabled={med.length === 0} onClick={() => downloadWorkbook([{ sheet: 'Medical & dietary', rows: med }], `SOS-medical-dietary-${day}.xlsx`)}>Medical &amp; dietary ({med.length})</button>
          <button disabled={n === 0} onClick={() => downloadWorkbook([{ sheet: 'No photo permission', rows: noPhotoList(snap.apps, cfg, who) }], `SOS-no-photo-${day}.xlsx`)}>No photo permission</button>
          <button disabled={n === 0} onClick={() => downloadWorkbook([{ sheet: 'Dorms', rows: dormList(snap.apps, cfg, who) }], `SOS-dorms-${day}.xlsx`)}>Dorm list (hall requests)</button>
        </div>
        <p class="warn small">The medical &amp; dietary list holds health data: give it only to those who must know, delete it after the summer school.</p>
      </div>
    </div>
  );
}
