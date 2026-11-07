# Reminders — setting up a new season

Daniel asked to be reminded of these when the new forms are made. The app's "Start new season" wizard should show this checklist.

## Forms (KU Leuven website)

1. **Payment form — e-mail label:** change "E-mail address (student or parent)" to "E-mail address **used in the application** (student or parent)". Makes automatic payment matching work for almost everyone.
2. **Payment form — session:** add a radio button "This payment is for: Session I / Session II / both sessions". Without it, the two payments of a two-session student can't be told apart.
3. **Proof-of-payment images:** the payment CSV only contains the file *name*; the files arrive as attachments of the form notification e-mails in Outlook. Set up a way to save them to a folder automatically — e.g. a Power Automate flow "when a payment-form e-mail arrives → save attachment to a OneDrive/SharePoint folder" (first check that KU Leuven allows Power Automate). The app then takes that folder by drag-and-drop and matches files to payment rows by file name.
4. **Application form:** update course codes in both session dropdowns, session dates, the "2025-2026" / "July 2026" texts, the application deadline and the "(almost) full" course list.

## App / data

5. Start a new season in the app (new Sheet; enter courses, soft/hard capacities, dorm capacity, session start dates, fees, thresholds; check the column mapping against the first export).
6. Enter prerequisites (or tick "no prerequisites") for every course before the first assignment run.
7. Decide (with the DPO) what happens to last season's archived data.
