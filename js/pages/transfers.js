window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.transfers = {
  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1>Transfers</h1>
        <p>CalRecycle 197 receipts — one per collector transfer, scoped to the active claim period.</p>
      </div>
      <div class="coming-next">
        <strong>Next build pass.</strong> This page will let you:
        <ul>
          <li>Log a transfer receipt: date, collector, units/weight by CEW type, SA units</li>
          <li>Attach the scanned receipt, Collection Log (198/198SA), and Proof of Designation (184) as files</li>
          <li>Record collector-activity notes and any discrepancy tables</li>
          <li>Auto-generate the 197S Transfer Summary rollup by collector for the period</li>
        </ul>
      </div>
    `;
  },
};
