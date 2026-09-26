window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.reports = {
  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1>Claim Forms &amp; Reports</h1>
        <p>Auto-filled output matching the CalRecycle 196B, 196C, 197, and 197S layouts, generated from everything entered elsewhere in the app.</p>
      </div>
      <div class="coming-next">
        <strong>Next build pass.</strong> Once Transfers, Cancellations, Residuals, and Disposition
        are wired up, this page will:
        <ul>
          <li>Compile a claim period's data into the 196B/196C section layout for review</li>
          <li>Roll transfers up into a 197S Transfer Summary by collector</li>
          <li>Export to PDF/print for submission, and to CSV for your own records</li>
          <li>Let you page back through past claim periods for year-over-year comparisons</li>
        </ul>
      </div>
    `;
  },
};
