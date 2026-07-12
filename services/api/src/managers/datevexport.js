import { round2 } from './money.js';

// Pure DATEV export logic for UC4 (useCases.md). Kept free of Mongoose/
// Express so booking classification can be unit-tested with plain data;
// accountingmanager.js fetches from Mongo and calls into this.
//
// Account numbers below are illustrative SKR03-style placeholders, not a
// certified DATEV chart of accounts - a real deployment must let the
// landlord configure these per their own Steuerberater's Kontenrahmen.
const DATEV_RENT_INCOME_ACCOUNT = '8400'; // Erlöse aus Vermietung
const DATEV_UNCLASSIFIED_ACCOUNT = '9999';
const DATEV_EXPENSE_ACCOUNTS = {
  maintenance: '4805', // Reparatur/Instandhaltung
  insurance: '4360', // Versicherungen
  management_fees: '4395', // Verwaltungskosten
  property_tax: '4320', // Grundsteuer
  utilities: '4240', // Nebenkosten/Betriebskosten
  loan_interest: '2130', // Zinsaufwand
  other: '4900' // Sonstige betriebliche Aufwendungen
};

// Pushes a booking record into `bookings` when it is cleanly classified, or
// into `unclassified` (with the reason attached) otherwise - shared by the
// payment and expense loops in buildDatevBookings below.
function classify(record, unclassifiedReason, bookings, unclassified) {
  if (unclassifiedReason) {
    unclassified.push({ ...record, reason: unclassifiedReason });
  } else {
    bookings.push(record);
  }
}

export function classifyExpenseAccount(category) {
  return DATEV_EXPENSE_ACCOUNTS[category] || null;
}

// A booking can only be attributed to a cost center (Kostenstelle = Property)
// when exactly one property is involved - splitting one real bank
// transaction across several properties would misrepresent the actual money
// movement, so such cases are left for manual assignment instead (see UC4's
// "Objektbezug" requirement and its unclassified/ungeklärt alternate flow).
export function resolveCostCenter(propertyIds, properties) {
  if (!propertyIds || propertyIds.length !== 1) {
    return null;
  }
  const property = properties.find(
    (p) => String(p._id) === String(propertyIds[0])
  );
  return property ? property.name : null;
}

// payments: [{ tenantName, propertyIds, amount, date, reference, documentId }]
// expenses: [{ category, propertyId, amount, date, description, documentId }]
// properties: [{ _id, name }]
export function buildDatevBookings({ payments, expenses, properties }) {
  const bookings = [];
  const unclassified = [];

  (payments || []).forEach((payment) => {
    const costCenter = resolveCostCenter(payment.propertyIds, properties);
    const record = {
      type: 'income',
      amount: round2(Math.abs(payment.amount)),
      debitCredit: 'H',
      account: DATEV_RENT_INCOME_ACCOUNT,
      costCenter,
      bookingDate: payment.date,
      bookingText: `Miete ${payment.tenantName}`,
      documentReference: payment.reference || '',
      documentId: payment.documentId || ''
    };
    const reason = costCenter
      ? null
      : payment.propertyIds && payment.propertyIds.length > 1
        ? 'payment spans multiple properties - assign a cost center manually'
        : 'no property linked to this payment';

    classify(record, reason, bookings, unclassified);
  });

  (expenses || []).forEach((expense) => {
    const account = classifyExpenseAccount(expense.category);
    const costCenter = resolveCostCenter([expense.propertyId], properties);
    const record = {
      type: 'expense',
      amount: round2(Math.abs(expense.amount)),
      debitCredit: 'S',
      account: account || DATEV_UNCLASSIFIED_ACCOUNT,
      costCenter,
      bookingDate: expense.date,
      bookingText: expense.description || expense.category,
      documentReference: expense.documentId || '',
      documentId: expense.documentId || ''
    };
    const reason = !account
      ? `unknown expense category "${expense.category}"`
      : !costCenter
        ? 'no property linked to this expense'
        : null;

    classify(record, reason, bookings, unclassified);
  });

  return { bookings, unclassified };
}
