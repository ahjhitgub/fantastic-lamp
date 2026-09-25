window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.cancellations = {
  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1>Cancellations</h1>
        <p>Daily cancellation totals — 196B/196C §VI — for the active claim period.</p>
      </div>
      <div class="coming-next">
        <strong>Next build pass.</strong> This page will let you:
        <ul>
          <li>Log daily pounds cancelled and cancellation method, and total the reporting month</li>
          <li>Compute the payment claim: total lbs × the standard statewide rate</li>
        </ul>
        <p class="mt-0" style="margin-top:12px;">
          The comprehensive per-unit cancelled/dismantled log (manufacturer, model #, serial #, one
          row per physical unit) is intentionally held for a later phase, at your request — the data
          model already reserves space for it so it slots in without reshaping anything.
        </p>
      </div>
    `;
  },
};
