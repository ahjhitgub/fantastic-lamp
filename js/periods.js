/**
 * periods.js
 * Transfers are no longer scoped to one claim period — a transfer can be
 * split (partially cancelled) across two periods, or not allocated to any
 * period yet (not cancelled). This module holds the shared math: a period's
 * activity start date is the earliest date among the transfers allocated to
 * it; its activity end date is always the last day of its own month; and a
 * transfer's cancellation status is derived from how much of it has been
 * allocated so far, never stored as a separate flag.
 */
window.App = window.App || {};

App.Periods = (function () {
  /** Last calendar day of (year, month) as YYYY-MM-DD. month is 1-12. */
  function lastDayOfMonthISO(year, month) {
    const d = new Date(year, month, 0); // day 0 of next month = last day of this month
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  function getAllocationsForPeriod(claimPeriodId) {
    return App.DB.getAllByIndex('transferAllocations', 'claimPeriodId', claimPeriodId);
  }

  function getAllocationsForTransfer(transferId) {
    return App.DB.getAllByIndex('transferAllocations', 'transferId', transferId);
  }

  /** Earliest dateOfTransfer among transfers allocated (even partially) to this period, or null. */
  async function computeActivityStart(claimPeriodId) {
    const allocations = await getAllocationsForPeriod(claimPeriodId);
    if (allocations.length === 0) return null;
    const transfers = await Promise.all(
      [...new Set(allocations.map((a) => a.transferId))].map((id) => App.DB.get('transfers', id))
    );
    const dates = transfers.filter(Boolean).map((t) => t.dateOfTransfer).filter(Boolean);
    if (dates.length === 0) return null;
    return dates.reduce((min, d) => (d < min ? d : min));
  }

  /** Sum of units/weight actually allocated into this period — what counts toward its claim. */
  async function computeAllocatedTotals(claimPeriodId) {
    const allocations = await getAllocationsForPeriod(claimPeriodId);
    return allocations.reduce(
      (acc, a) => ({
        units: acc.units + (Number(a.units) || 0),
        weight: acc.weight + (Number(a.weight) || 0),
      }),
      { units: 0, weight: 0 }
    );
  }

  function totalUnits(transfer) {
    const a = transfer.amounts || {};
    return (a.crt?.units || 0) + (a.nonCrt?.units || 0) + (a.cbep?.units || 0);
  }
  function totalWeight(transfer) {
    const a = transfer.amounts || {};
    return (a.crt?.weight || 0) + (a.nonCrt?.weight || 0) + (a.cbep?.weight || 0);
  }

  /**
   * A transfer's cancellation status, derived from its allocations — never
   * stored, so it can't drift out of sync with the numbers.
   */
  async function computeTransferStatus(transfer) {
    const allocations = await getAllocationsForTransfer(transfer.id);
    const allocatedUnits = allocations.reduce((s, a) => s + (Number(a.units) || 0), 0);
    const allocatedWeight = allocations.reduce((s, a) => s + (Number(a.weight) || 0), 0);
    const tWeight = totalWeight(transfer);
    let status = 'Not yet cancelled';
    if (allocatedWeight > 0 && allocatedWeight < tWeight) status = 'Partially cancelled';
    else if (allocatedWeight > 0 && allocatedWeight >= tWeight) status = 'Fully cancelled';
    return {
      allocations,
      allocatedUnits,
      allocatedWeight,
      remainingUnits: Math.max(0, totalUnits(transfer) - allocatedUnits),
      remainingWeight: Math.max(0, tWeight - allocatedWeight),
      status,
    };
  }

  return {
    lastDayOfMonthISO,
    getAllocationsForPeriod,
    getAllocationsForTransfer,
    computeActivityStart,
    computeAllocatedTotals,
    computeTransferStatus,
    totalUnits,
    totalWeight,
  };
})();
