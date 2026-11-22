# Power Automate: save proof-of-payment files to one folder

The payment CSV only contains the *name* of each proof file; the file itself is an attachment of the form's
notification e-mail. This flow saves every attachment to one OneDrive folder as

    <payer e-mail>__<received date-time>__<original file name>

e.g. `jan@example.com__20261122-140827__payment.pdf`. The app pairs each file with its payment row by the e-mail
in the name and the original name at the end (see `pairProofFiles` in `src/core/proof.ts`); the date-time only
keeps two proofs with the same name from the same payer apart.

## What the notification e-mail looks like (checked on a test submission, 22 Nov 2026)

- From `summerofscience@kuleuven.be`, subject `Summer of Science - Payment confirmation`.
- HTML body: a list of `<dt>question</dt><dd>answer</dd>` pairs: *Student full name*, *E-mail address (student or
  parent)*, *This payment is for* (Session I / Session II / both), the terms checkbox.
- The proof is a normal attachment with its original name (e.g. `payment.pdf`, `application/pdf`).
- The Reply-To header is the e-mail address filled in on the form (not used by the flow; good to know).

## Before you start

1. **Use KU Leuven accounts only.** The notifications with real data must arrive in a KU Leuven mailbox (yours or a
   shared one), and the flow must run under your KU Leuven account and save to your KU Leuven OneDrive (or a
   SharePoint site). Not a personal mailbox or personal OneDrive.
2. The flow uses only standard connectors (Office 365 Outlook, OneDrive for Business): no premium licence. If
   make.powerautomate.com refuses or a data policy blocks the connectors, ask ICTS.
3. Create the folder first, e.g. `SOS/2027/Proofs` in your KU Leuven OneDrive.

## Build the flow

1. Go to **make.powerautomate.com**, sign in with your KU Leuven account. **Create → Automated cloud flow**. Name:
   `SOS – save proof files`.
2. **Trigger** — search "new email":
   - mail arrives in *your own* KU Leuven mailbox → **When a new email arrives (V3)** (Office 365 Outlook);
   - mail arrives in a *shared* mailbox (e.g. summerofscience@…) → **When a new email arrives in a shared mailbox (V2)**,
     with *Original Mailbox Address* = that mailbox.

   Click the trigger and set (under *Advanced parameters* / *Show all*):
   - Folder: `Inbox` (or the folder a mail rule moves these e-mails to)
   - From: `summerofscience@kuleuven.be`
   - Subject Filter: `Payment confirmation`
   - Include Attachments: **Yes**
   - Only with Attachments: **Yes**
3. **+ New step → Compose** (Data Operation). Rename it to `Payer email` (the name matters for step 4). Inputs → *fx*
   (expression), paste:

   ```
   toLower(trim(last(split(replace(first(split(last(split(triggerOutputs()?['body/body'], 'E-mail address')), '</dd>')), '</a>', ''), '>'))))
   ```

   It takes the answer after the question that contains "E-mail address" (still works if the label becomes
   "E-mail address used in the application …").
4. **+ New step → Apply to each**. *Select an output from previous steps*: dynamic content **Attachments** (of the
   trigger). Inside it:
   1. **Condition**: dynamic content **Attachments Is Inline** — *is equal to* — `false` (skips logos in signatures).
   2. In the **True** branch: **Create file** (OneDrive for Business):
      - Folder Path: pick `SOS/2027/Proofs`
      - File Name → *fx*:

        ```
        concat(outputs('Payer_email'), '__', formatDateTime(triggerOutputs()?['body/receivedDateTime'], 'yyyyMMdd-HHmmss'), '__', items('Apply_to_each')?['name'])
        ```

      - File Content: dynamic content **Attachments Content**.
   If the per-attachment fields (*Attachments Is Inline*, *Attachments Content*) don't show up in the dynamic
   content list (only *Has Attachment*), type them as expressions (*fx*) instead:
   - Apply to each input: `triggerOutputs()?['body/attachments']`
   - Condition left side: `items('Apply_to_each')?['isInline']`, right side (*fx*): `false`
   - File Content: `base64ToBinary(items('Apply_to_each')?['contentBytes'])`. Without `base64ToBinary`, or with the
     whole `items('Apply_to_each')`, the saved "PDF" is a text file starting with `{"@odata.type":…` and won't open
     (seen in the first test, 22 Nov 2026).

   (If the loop is called *For each*, write `items('For_each')`.) This is how the flow was set up on 22 Nov 2026.
5. **Save**. If the designer reports an error in an expression, check that the Compose step is called exactly
   `Payer email` (the expression refers to it as `Payer_email`) and the loop `Apply to each`.

## Test

1. In the flow: **Test → Manually**, then submit the payment form once with a test file.
2. The run should show green ticks; the folder should contain `<your e-mail>__<date-time>__<file name>`.
3. Open the saved file. If it doesn't open (corrupt): edit *Create file* → File Content → *fx*
   `base64ToBinary(items('Apply_to_each')?['contentBytes'])`, save, test again.
4. In the app (demo or real Sheet): **Payments → Proof of payment**, drag the files from the synced OneDrive folder
   onto the page: each file should pair with its payment.

## Notes

- The flow handles e-mails that arrive *after* it is switched on. Proofs that arrived earlier: save those by hand with
  the same naming, or forward them to the mailbox again once the flow runs.
- Power Automate keeps run history (incl. the e-mail fields) for 28 days inside the KU Leuven tenant; mention it in
  the DPO review.
- At the end of a season, archive or delete the proof folder together with the season's data (retention, §2 of
  `DESIGN.md`).
