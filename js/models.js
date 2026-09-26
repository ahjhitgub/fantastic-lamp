/** models.js — shared constants. */
window.App = window.App || {};

App.Models = {
  CEW_TYPES: ['CRT', 'NonCRT', 'CBEP'],
  CEW_TYPE_LABELS: { CRT: 'CRT', NonCRT: 'Non-CRT', CBEP: 'CBEP (Battery-Embedded)' },
  CLAIM_FORM_BY_TYPE: { NonCRT: '196B', CBEP: '196C', CRT: null },
  MONTH_NAMES: ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'],

  COMPANY_ROLES: [
    { key: 'collector', label: 'Collector (CEWID)' },
    { key: 'handler', label: 'Handler' },
    { key: 'destination', label: 'Shipping destination' },
  ],

  // Built-in WC kinds. Users can add more WC types; those behave as "generic".
  BUILTIN_WC_TYPES: [
    { name: 'Transfer', kind: 'transfer' },
    { name: 'Residual Shipment', kind: 'shipment' },
    { name: 'Inventory Check', kind: 'inventory' },
  ],

  TRANSFER_TIMELINE: [
    ['wcAssigned', 'WC # assigned'],
    ['materialReceived', 'Material received'],
    ['irrMade', 'IRR made'],
    ['sourceLogsReceived', 'Source logs received'],
    ['customerAdjustments', 'Customer adjustments (if needed)'],
    ['wcSigned', 'WC form made & signed'],
    ['form197Signed', '197 form made & signed'],
    ['poSent', 'Purchase order made & sent to customer'],
  ],

  // Seeded from your Dec 2024 / Jan 2025 residual summaries; the 196B column
  // each rolls into was confirmed against both filed 196Bs.
  SEED_MATERIALS: [
    ['Steel', 'Non-Copper Metals'], ['ABS Plastic', 'Plastic'], ['Copper Metals (Wires)', 'Copper'],
    ['LCD Panels', 'LCD Bare Panels'], ['Circuit Boards', 'Circuit Boards'], ['Power Boards', 'Circuit Boards'],
    ['LCD Strips', 'Circuit Boards'], ['Residual Waste', 'Other'], ['LCD Lamps', 'LCD Lamps (§IV)'],
    ['LCD Lamps Crushed', 'LCD Lamps (§IV)'],
  ],

  // Master price list rows created on first run — names only; prices are yours to enter.
  SEED_PRICE_ITEMS: [
    ['cew:lcdled', 'CEW LCD/LED'], ['noncew:lcdled', 'Non-CEW LCD/LED'],
    ['cew:crt', 'CEW CRT'], ['noncew:crt', 'Non-CEW CRT'],
    ['cew:plasma', 'CEW Plasma'], ['noncew:plasma', 'Non-CEW Plasma'],
    ['cew:cbep', 'CEW CBEP'],
  ],

  CANCELLATION_METHODS_BY_TYPE: {
    CBEP: ['Dismantling by Removing Battery', 'Approved Alternative Method'],
    NonCRT: ['Dismantling to a Bare Panel', 'Approved Alternative Method'],
    CRT: ['Approved Alternative Method'],
  },
  BATTERY_TYPES: ['Lithium-Ion', 'Nickel-Metal Hydride', 'Sealed Lead-Acid', 'Nickel-Cadmium', 'Other'],
  SCREEN_TYPES: ['Bare Plasma Panels', 'LCD Lamps'],
  ATTACHMENT_DOCUMENT_TYPES: [
    'Our Weight Certificate', 'Customer Weight Certificate', 'Inbound Receiving Report (IRR)',
    '198 Collection Log / Source Logs', 'Signed 197', 'Purchase Invoice', 'Purchase Order', 'Proof of Designation (184)', 'Other',
  ],

  formatPeriodLabel(period) {
    if (!period) return '';
    const type = App.Models.CEW_TYPE_LABELS[period.cewType] || period.cewType;
    return `${type} · ${App.Models.MONTH_NAMES[(period.month || 1) - 1]} ${period.year}`;
  },
};
