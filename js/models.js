/**
 * models.js
 * Shared constants/enums. No dependencies. Load before any page module.
 */
window.App = window.App || {};

App.Models = {
  CEW_TYPES: ['CRT', 'NonCRT', 'CBEP'],

  CEW_TYPE_LABELS: {
    CRT: 'CRT',
    NonCRT: 'Non-CRT',
    CBEP: 'CBEP (Battery-Embedded)',
  },

  // Which CalRecycle claim form each CEW type's monthly claim uses.
  CLAIM_FORM_BY_TYPE: {
    NonCRT: '196B',
    CBEP: '196C',
    CRT: null, // not covered by the uploaded forms yet
  },

  CLAIM_PERIOD_STATUSES: ['draft', 'submitted'],

  CANCELLATION_METHODS_BY_TYPE: {
    CBEP: ['Dismantling by Removing Battery', 'Approved Alternative Method'],
    NonCRT: ['Dismantling to a Bare Panel', 'Approved Alternative Method'],
    CRT: ['Approved Alternative Method'],
  },

  BATTERY_TYPES: [
    'Lithium-Ion',
    'Nickel-Metal Hydride',
    'Sealed Lead-Acid',
    'Nickel-Cadmium',
    'Other',
  ],

  SCREEN_TYPES: ['Bare Plasma Panels', 'LCD Lamps'],

  DEVICE_TYPE_HINTS: ['LED', 'LCD', 'Plasma', 'CRT Tube'],

  RESIDUAL_MATERIAL_HINTS: [
    'Steel', 'ABS Plastic', 'Power Boards', 'Circuit Boards', 'LCD Panels',
    'LCD Lamps', 'LCD Lamps Crushed', 'LCD Strips', 'Copper Metals (Wires)', 'Residual Waste',
  ],

  SHIPMENT_DESTINATION_HINTS: [
    'Atlas Iron & Metal', 'Alpert & Alpert Iron & Metal Inc', 'CR&R Inc',
    'Cal Micro Recycling', 'IQA Metals', 'Federal Metals', 'CleanEarth', 'FMC', 'Reboot Tech',
  ],

  ATTACHMENT_DOCUMENT_TYPES: [
    'Our Weight Certificate',
    'Customer Weight Certificate',
    '198 Collection Log',
    'Proof of Designation (184)',
    'Other',
  ],

  RESIDUAL_MATERIAL_CATEGORIES_BY_TYPE: {
    CBEP: [
      'Plastic',
      'Copper',
      'Non-Copper Metals',
      'All Battery Chemistries',
      'Circuit Boards',
      'Glass',
      'Fibers',
      'Other',
    ],
    NonCRT: [
      'Plastic',
      'Copper',
      'Non-Copper Metals',
      'LCD Bare Panels',
      'Circuit Boards',
      'Other',
    ],
  },

  MONTH_NAMES: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],

  /** Format a claim period as "CBEP · October 2026" */
  formatPeriodLabel(period) {
    if (!period) return '';
    const type = App.Models.CEW_TYPE_LABELS[period.cewType] || period.cewType;
    const month = App.Models.MONTH_NAMES[(period.month || 1) - 1] || '';
    return `${type} · ${month} ${period.year}`;
  },
};
