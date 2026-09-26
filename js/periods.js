/** periods.js — claim-period dates and totals, always computed from allocations. */
window.App = window.App || {};

App.Periods = {
  lastDayOfMonthISO: (y, m) => App.Logic.lastDayISO(y, m),
  getAllocationsForPeriod: (id) => App.DB.getAllByIndex('transferAllocations', 'claimPeriodId', id),
  getAllocationsForWc: (id) => App.DB.getAllByIndex('transferAllocations', 'wcId', id),
  /** Earliest received date among WCs allocated to this period. */
  async computeActivityStart(periodId) {
    const allocs = await App.Periods.getAllocationsForPeriod(periodId);
    const wcs = await Promise.all([...new Set(allocs.map((a) => a.wcId))].map((id) => App.DB.get('wcs', id)));
    const dates = wcs.filter(Boolean).map((w) => w.date).filter(Boolean).sort();
    return dates[0] || null;
  },
  async computeAllocatedTotals(periodId) {
    return App.Logic.sumAllocs(await App.Periods.getAllocationsForPeriod(periodId));
  },
};
