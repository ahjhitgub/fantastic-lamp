window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.residuals = {
  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1>Residuals &amp; Inventory</h1>
        <p>Treatment residuals (196B/196C §V), the daily generation log, and month-end physical inventory counts.</p>
      </div>
      <div class="coming-next">
        <strong>Next build pass.</strong> This page will bring in the three tracking sheets you
        uploaded as working tools:
        <ul>
          <li>Daily generation log (scale tickets by material — gross/tare/net)</li>
          <li>Monthly rollup by material: previous stored → generated → shipped → stored, with running %</li>
          <li>Manual month-end physical inventory count, by category</li>
          <li>Shipment records for other treatment residuals (196B/196C §VIII)</li>
        </ul>
        Each claim period can reference the previous period of the same CEW type so "previous
        stored" carries forward automatically, the way your spreadsheet does today.
      </div>
    `;
  },
};
