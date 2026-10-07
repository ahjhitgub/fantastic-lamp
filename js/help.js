/* Built-in help: what each page is for and the usual steps (the "?" next to each page's title). */
window.App = window.App || {};
App.Help = {
  _default: '<p>Pick a page from the top bar. Everyday work is on the bar; claim work is on the sunlit claim ribbon under it (pick a claim first); setup is under ⚙ Setup.</p>',
  dashboard: `<p>Your starting point. In <strong>All</strong> it lists what needs doing: payments due under the 3-day rule, backups, missing WC/IRR numbers, transfers waiting on 198s, and what's coming up. Pick a claim at the top to see that claim's progress instead.</p>
    <p><strong>End-of-day sheet</strong> prints today's arrivals, shipments, payments due and paperwork still missing.</p>`,
  transfers: `<p>Every transfer (a CalRecycle 197 receipt). <strong>New transfer</strong> takes the WC # (the lot #), the customer — or tick <strong>Dual Entity</strong> for our own — and starts like that customer's last transfer if you leave that ticked.</p>
    <ol><li>Open the transfer, fill in the IRR lines (units, gross, tare; what's claimable).</li><li>Enter or read in the 198 O (and the 198 A if adjustments were needed).</li>
    <li>Fill in the timeline — once all paperwork is in, you have <strong>3 calendar days</strong> to close and pay.</li><li>Allocate it to a claim (here or from the claim's Transfers tab).</li></ol>
    <p><strong>Show as Board</strong> shows every transfer by stage. The <strong>Payment</strong> filter finds what's overdue.</p>`,
  wcs: `<p>Every weight certificate, by number. Missing numbers are flagged — <strong>Mark as voided</strong> if the paper WC was voided. Tick WCs to set a status on several at once or print them together; <strong>Print</strong> on any row prints that WC.</p>`,
  wc: `<p>One WC. <strong>Print WC</strong> prints it; <strong>Change type</strong> fixes a WC entered as the wrong kind; <strong>Void WC</strong> voids it (the number is never reused). Save with the bar at the top — unsaved changes are shown there. <strong>History</strong> at the bottom lists what changed and when.</p>`,
  crtplasma: '<p>CRT and plasma units: what came in on transfers, what shipped out on CRT/plasma shipments, and the 198 UC entries that go with each shipment.</p>',
  annual: '<p>One calendar year: what came in, what shipped, claim payments requested and received, other sales, and the <strong>margin</strong> — expected claim payments (claim rates in Settings) against what you paid for material.</p>',
  claimTransfers: `<p>Inside a claim: what's on it, and every transfer of its program received by the month's end that isn't fully claimed. Tick the ones to add (lower the units for a partial claim — pounds follow), then <strong>Add</strong>; a confirmation shows the new totals before anything is saved.</p>`,
  cancellations: `<p>The claim's cancellation log. Paste or upload it (Excel/CSV); lines are checked against their WCs. Flags include likely bulk entries, weights far off a make/model's usual weight, and lines cancelled before their transfer came in. For CBEP claims, the daily cancellation summary is here too.</p>`,
  audit: '<p>Reconciles the cancellation log against the transfers on this claim — every error here needs fixing before the claim goes in.</p>',
  residuals: `<p>Residuals for the claim's month. <strong>CEW Non-CRT</strong>: the 196B figures, month-end inventory checks, and LCD lamp / plasma panel disposition. <strong>CBEP</strong>: the optional daily residual log, the month-end inventory check, the generation certificates and the 196C figures, with a reconcile table.</p>`,
  reports: `<p>Claim forms. Start with <strong>Close the month</strong> — every step in order, with a link to whatever isn't done. Then the 197S, each transfer's documents, the <strong>claim packet</strong> (one PDF of everything), the CBEP checklist, and the review after you submit.</p>`,
  companies: '<p>Customers (handlers and approved collectors) and vendors (who you ship to, approved recyclers) on separate tabs. Click a name for the details; <strong>Statement</strong> prints a customer\'s transfers and payments for a date range.</p>',
  prices: '<p>What you pay per pound or unit, drop off and pick up. Change rates, then <strong>Save changes</strong> once — new rates apply from the "effective from" date, and older transfers keep the rates of their own date.</p>',
  descriptions: '<p>Your vendors\' names for the materials you ship them, and what each counts as — shipment lines fill in from these.</p>',
  claimPeriods: '<p>Claim periods (one per program per month). Set a <strong>Submit by</strong> date to have it show under Coming up; the payment requested is worked out from the claim rate unless you type one.</p>',
  settings: '<p>Your facility details, claim rates, check thresholds, larger text, WC types and statuses, materials (CEW Non-CRT and CBEP lists), the recycle bin, usual weights by make/model, and backups — including a folder for automatic daily backups.</p>',
  doc: '<p>The documents for one WC: IRR, WC, purchase invoice, 197, 198s and the Merged File. Print or download from the bar at the top.</p>',
};
