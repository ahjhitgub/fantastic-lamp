/** models.js — shared constants. */
window.App = window.App || {};

App.Models = {
  // Bump with every build; the matching notes are in CHANGELOG.md.
  VERSION: '4.0',
  VERSION_NAME: 'Streamlining',

  CEW_TYPES: ['CRT', 'NonCRT', 'CBEP'],
  CEW_TYPE_LABELS: { CRT: 'CRT', NonCRT: 'Non-CRT', CBEP: 'CBEP (Battery-Embedded)' },
  CLAIM_FORM_BY_TYPE: { NonCRT: '196B', CBEP: '196C', CRT: null },
  MONTH_NAMES: ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'],

  // A vendor buys what we ship (residuals). An approved CEW recycler is a vendor that also
  // takes our CRTs and plasmas — so 'recycler' always comes with 'destination' (vendor).
  COMPANY_ROLES: [
    { key: 'collector', label: 'Approved collector (CEWID)' },
    { key: 'handler', label: 'Handler' },
    { key: 'destination', label: 'Vendor (we ship to)' },
    { key: 'recycler', label: 'Approved CEW recycler — a vendor that takes CRTs & plasmas' },
  ],
  CUSTOMER_ROLES: ['collector', 'handler'],

  // Built-in WC kinds. Users can add more WC types; those behave as "generic".
  BUILTIN_WC_TYPES: [
    { name: 'Transfer', kind: 'transfer' },
    { name: 'Residual Shipment', kind: 'shipment' },
    { name: 'Inventory Check', kind: 'inventory' },
    { name: 'CBEP residual generated', kind: 'generation' },
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
    ['allPaperwork', 'All paperwork received'],
    ['paid', 'Customer paid'],
  ],

  // Seeded from your Dec 2024 / Jan 2025 residual summaries; the 196B column
  // each rolls into was confirmed against both filed 196Bs.
  SEED_MATERIALS: [
    ['Steel', 'Non-Copper Metals'], ['ABS Plastic', 'Plastic'], ['Copper Metals (Wires)', 'Copper'],
    ['LCD Panels', 'LCD Bare Panels'], ['Circuit Boards', 'Circuit Boards'], ['Power Boards', 'Circuit Boards'],
    ['LCD Strips', 'Circuit Boards'], ['Motherboards', 'Circuit Boards'], ['Residual Waste', 'Other'], ['LCD Lamps', 'LCD Lamps (§IV)'],
    ['LCD Lamps Crushed', 'LCD Lamps (§IV)'],
  ],

  // Master price list rows created on first run — names only; prices are yours to enter.
  // [appliesTo, name, direction] — we buy CEW units and charge for non-CEW ones
  SEED_PRICE_ITEMS: [
    ['cew:lcdled', 'CEW LCD/LED', 'pay'], ['cew:crt', 'CEW CRT', 'pay'], ['cew:plasma', 'CEW Plasma', 'pay'], ['cew:cbep', 'CBEP Computer Towers', 'pay'], ['cew:cbep', 'CBEP Printers', 'pay'],
    ['noncew:noncrt', 'Non-CEW Non-CRT', 'charge'], ['noncew:crt', 'Non-CEW CRT', 'charge'],
  ],

  // Non-CEW items as written on your IRRs — added to the price list (names only) so they
  // can be picked as descriptions on transfer lines.
  SEED_OTHER_ITEMS: [
    'CPU', 'PC Tower(s) - Complete', 'Mother Board(s) - Mixed', 'Laptop Scrap - Complete',
    'Tablet(s)', 'Cellphone(s) W/ Battery(ies)', 'Cable Box W/ HD',
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
    '198 Collection Log / Source Logs', 'Signed 197', 'Purchase Invoice', 'Purchase Order', 'Proof of Designation (184)',
    'Bill of Lading', 'Hazardous Waste Manifest', 'Receipt from Receiving Facility', 'Material Flow Description',
    'Explanation of Ultimate Disposition', 'Generation Weight Certificate', 'Other',
  ],

  formatPeriodLabel(period) {
    if (!period) return '';
    const type = App.Models.CEW_TYPE_LABELS[period.cewType] || period.cewType;
    return `${type} · ${App.Models.MONTH_NAMES[(period.month || 1) - 1]} ${period.year}`;
  },
};
