window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.disposition = {
  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1>Battery / Panel Disposition</h1>
        <p>Post-cancellation disposition — batteries for CBEP periods (196C §IV/VII), bare panels &amp; LCD lamps for Non-CRT periods (196B §IV/VIII).</p>
      </div>
      <div class="coming-next">
        <strong>Next build pass.</strong> This page will let you:
        <ul>
          <li>Track weight generated / shipped / stored by battery type or screen type</li>
          <li>Log shipment detail: accumulation start date, date shipped, reference #, initial and ultimate destination</li>
        </ul>
        The form shown depends on the active period's CEW type — CBEP periods get the battery
        table, Non-CRT periods get the panel/lamp table.
      </div>
    `;
  },
};
