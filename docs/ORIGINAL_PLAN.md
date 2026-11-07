# Original plan (Daniel, Nov 2026)

*Verbatim copy of Daniel's Plan.txt. Several points were refined later — `DESIGN.md` is authoritative where they differ.*

```text
GLOBAL PLAN: To automate as much as possible of the Summer of Science applicant workflow, BUT without giving AI (LLMs) access to personal data. Most automatic workflows should then be handled by automatic scripts/programming; when input from an LLM is needed, the automatic scripts should write only the necessary information to a file that the LLM would then be able to access and give localized decisions on.
Everything should be in the cloud, with all functionality completely wrapped in a user-friendly app.

STAGE 1: Application entering and first processing/checking
- Applications on the website are downloaded in full by the user from the application page. The csv can be uploaded to the app, which then processes all of the applications. (So this is already one clear "button" on the app "home page" - upload new applications)
Processing means putting them into a Google sheet (in essence, the different entries in the csv entry correspond to the different entries/columns in the Google sheet; and there are additional columns in the Google sheet as well for the following steps of processing the application).

Note:

--- The Google sheet should be considered  the ground truth. It is possible that (through email traffic etc) that an applicants data will be manually changed/updated. OR: this could be a functionality in the app? Search for applicant and change? And then the change could be explicitly logged for future reference -> perhaps this is better.

--- Each entry should be assigned a unique ID, which will then later be used to anonymously identify the applicant through LLM processing steps if applicable.

--- the csv can contain duplicates which should be automatically handled. If there are near-duplicates, this should be flagged for follow-up (to make sure the applicant did not just "correct themselves" by re-submitting with something small changed.

--- the csv will always contain ALL applications; the script should automatically recognize which applications are already present in the Google sheet (or it keeps its own track of how many/which records have been processed - note that Google sheet records can be altered, e.g. if the applicant submits corrections/additions).

--- The student's birth year should be checked, together with the "number of years left before graduating" - which is a choice 0, 1, 2, >2. Students that are too old for the program should be flagged (they may be college students). Students that are too young (either indicating >2 on the nr years before graduating, or very young, should be flagged for further HUMAN review.
-> This should be a functionality in the app - "review young students", where all such flagged young students are revealed. The human checker should be able to scroll through these young students, being displayed their information in a clear overview per student, so that decisions can be made. Some auxiliary (ie to help the human checker) checkboxes for these particular students should then be "sent email to course", "course OK? (for approval of teachers), "sent email to student", "student dorm OK" (for double-checking with students about age in dorms); then there should be the final decision "OK for course x/y/z" (where x,y,z can be either one of their three top choices or even a different course). There could also be multiple decisions, e.g. "OK for course x" and "OK for course y" - and then the assignment algorithm (See below) will decide the appropriate assignment.

--- Students need to indicate whether they are applying for Session I OR II, and then they also need to indicate 1st/2nd/3rd choice of courses to follow in the correct session. It should be checked that they matched sessions correctly, i.e. that if they indicated Session I, they only indicate choices from Session I courses (and did not indicate any Session II course choices). Students can apply for both sessions but then must submit two separate applications. (Such "almost-duplicate" applications should obviously not be flagged as possible duplicates!)

--- Besides the student age and session/course mismatch discussed above, there will be a number of "flags" that the script should check applications for. Each of these flags should trigger that the script creates a new file which is aimed to give to the LLM for further processing:
***** If the student indicates status as Flemish "FL", then a double-check of their school should happen: is the high school they list indeed a Flemish school? (For this, the LLM only needs access to a few fields: the student unique ID, the status, and the school name.
***** The student motivations should ALWAYS be double-checked by the LLM. The LLM should get instructions to flag any motivation that is very short (say <~50 words) without discernable reason, or that it seems the student is not a viable/suitable candidate (for example, the student is actually a college student, not high school; or the student is way too young, or...) or any other questionable motivations given. For this, the LLM only needs the unique ID and motivation. If there are any flags to be thrown, the LLM gives a succint sentence on why the flag. This information is then processed (by the automatic script) and appended to the Google sheet ground truth. The app then has a button "review flags" or such where these flags can be viewed and processed (e.g. approve anyway or overrule flag).


STAGE 2: Applicant assignment
- A separate "button" on the application "home" should be "(re)assign students". In this case, all students whose assignment has not been "locked" (see also later) yet, should be unassigned and the reassigned according to the algorithm, which is handled through basic principles:

--- Certain courses have relatively hard to hard prerequisites (e.g. student must be 16 years old at the time of the course start), which can disqualify a student automatically from that course. Such prerequisites should be entered in a separate screen (accessible from the app "home"). The prerequisites can be written in normal language, ie. an LLM step is necessary to translate these into the automatic script. A checkbox "no prerequisites" should be explicitly checked by the human (an error should be thrown if this is not checked (or a prerequisite entered) before applications are assigned! to ensure proper prerequisite entering and handling), and it should be possible to alter the prerequisites as well.

--- FL students have priority in being assigned dorm places and choices in courses

--- Other than this, assignment is essentially first-come-first-serve. Dorms and courses have a certain capacity which cannot be exceeded. A course can have a "soft" max and a "hard" max - if a soft max is reached, a flag should go up to the user to indicate this and to see if allowing additional students should be allowed at that time. (It is possible that the decision to go beyond the soft max will only be made if sufficient students are also present in other courses.)

--- Flagged students should not be penalized for being flagged; i.e. places should be reserved for flagged students (see above, e.g. young students) so that they don't "lose their place" while their flag is being processed.

--- Depending on the student status (FL or not) and if they are DAY/EVE/FULL students (FULL students sleeping the dorms, other not), their fees are determined.


- The assignment thus re-assigns already processed students. However, the app should throw a warning before processing everything, if there are students who have applied more than two weeks ago, and their assignment is not yet locked (see below).

- LOCKing assignments: the human user can decide to LOCK assignments. (This should be a functionality/button on the app.) This means that the applicant's assignment to course and dorm cannot be changed any longer (i.e. this will be communicated to the student). The user can decide to a) manually review (unlocked but assigned) applications to individually lock them, or b) batch lock all current FL applications up to a certain date, or c) batch lock ALL current applications up to a certain date.

- A separate functionality on the app should be to generate an email list for all locked students that have not been admitted yet. This should generate an appropriate excel to be used for mail merge in sending out the admission email to the students. When this excel is generated, these students should also be indicated as "admitted".

- The app should have another functionality "financial aid". In this, the human user can indicate to add a certain amount of financial aid for a particular student. So the human should be able to search for a student and "add/change financial aid contribution" to this student. This should immediately affect the students' fee of course. And the human should be able to see a list of all financial aid distributed together with a total of aid given. Note that this financial aid can even be allocated after the student has been admitted.

- It should be tracked in the google sheet on which date a student has been admitted.


STAGE 3: Final confirmation/payment
- Students are asked, in their admission email, to submit a "payment confirmation" with a screenshot or otherwise giving a proof of payment of their fees. This is a separate form, and so also here a csv can be periodically downloaded by the human user and uploaded into the app (-> another "button"):
--- In the best case, the name given on this payment form will exactly match the name of the applicant, in which case the payment can easily be attributed to the correct student. Note: it is possible that a student has to submit this form TWICE, i.e. if they are attending two sessions.
--- In another case, presumably a name matching by an LLM should occur. In this case, probably (??) the best idea is that the app provides the LLM with a list of student names + unique IDs, and a list of "unmatched" student names from the payment form, in order to find the relevant matches.
--- Also, the uploaded screen shot should be checked to be the CORRECT amount (ie the student's correct fees). How can we go about this check by the LLM in the safest way possible?

- The human should be able to keep track of the students who are admitted but who have not yet paid. In addition, a deadline can be given in for the payment (usually two weeks from admission), and if that date is passed a flag should be raised for the human. A reminder can also be sent (again, an excel for mail merge can be generated, or the user can just indicate individual emails sent). It is possible that multiple reminders can be sent. A reminder can also be indicated as "final", i.e. after the deadline date for this final reminder, the human should be flagged (so that they can make the decision to unassign a student).

OTHER:
Other functionalities will be added down the line as well. For example, an export of a student roster per course, and a list of student medical conditions, etc. These are relatively easily extractable from the google sheet.
There should also be a button or option to "unenroll" a student, which immediately removes them (at any stage in the above process) from the entire process. (e.g. from a cancellation or otherwise).
```
