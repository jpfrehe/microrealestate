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
// Gegenkonto (offsetting account): the bank/clearing account every booking
// below is posted against - illustrative SKR03 "Bank" placeholder, same
// caveat as the accounts above.
const DATEV_BANK_ACCOUNT = '1200';

function round2(amount) {
  return Math.round(amount * 100) / 100;
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
// expenses: [{ category, propertyId, amount, date, description, documentId, documentName }]
//   documentName is resolved by the caller (accountingmanager.js) from the
//   Document collection when documentId is set, so this stays DB-independent
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
      offsetAccount: DATEV_BANK_ACCOUNT,
      taxKey: '',
      costCenter,
      bookingDate: payment.date,
      bookingText: `Miete ${payment.tenantName}`,
      // no persisted Document for rent receipts (generated on demand by
      // pdfgenerator) - the bank transaction reference is the closest thing
      documentReference: payment.reference || '',
      documentId: payment.documentId || ''
    };

    if (!costCenter) {
      unclassified.push({
        ...record,
        reason:
          payment.propertyIds && payment.propertyIds.length > 1
            ? 'payment spans multiple properties - assign a cost center manually'
            : 'no property linked to this payment'
      });
    } else {
      bookings.push(record);
    }
  });

  (expenses || []).forEach((expense) => {
    const account = classifyExpenseAccount(expense.category);
    const costCenter = resolveCostCenter([expense.propertyId], properties);
    const record = {
      type: 'expense',
      amount: round2(Math.abs(expense.amount)),
      debitCredit: 'S',
      account: account || DATEV_UNCLASSIFIED_ACCOUNT,
      offsetAccount: DATEV_BANK_ACCOUNT,
      taxKey: '',
      costCenter,
      bookingDate: expense.date,
      bookingText: expense.description || expense.category,
      documentReference: expense.documentName || expense.documentId || '',
      documentId: expense.documentId || ''
    };

    if (!account || !costCenter) {
      unclassified.push({
        ...record,
        reason: !account
          ? `unknown expense category "${expense.category}"`
          : 'no property linked to this expense'
      });
    } else {
      bookings.push(record);
    }
  });

  return { bookings, unclassified };
}

// Best-effort "EXTF" header row DATEV's Buchungsstapel ASCII import format
// expects as the very first line of the file, ahead of the column-header
// and data rows - see DATEV's "Formatbeschreibung Buchungsstapel". This is
// NOT independently verified against a certified DATEV test import; the
// consultant/client numbers below are placeholders exactly like the account
// numbers above and must be replaced with the landlord's real Berater-/
// Mandantennummer before a file is actually handed to a Steuerberater.
export function buildExtfHeader({
  createdAt,
  periodStart,
  periodEnd,
  consultantNumber = 1001,
  clientNumber = 1
}) {
  const pad2 = (n) => String(n).padStart(2, '0');
  const timestamp = `${createdAt.getFullYear()}${pad2(createdAt.getMonth() + 1)}${pad2(createdAt.getDate())}${pad2(createdAt.getHours())}${pad2(createdAt.getMinutes())}${pad2(createdAt.getSeconds())}000`;
  const fiscalYearStart = `${periodStart.getFullYear()}0101`;
  const fromDate = `${periodStart.getFullYear()}${pad2(periodStart.getMonth() + 1)}${pad2(periodStart.getDate())}`;
  const toDate = `${periodEnd.getFullYear()}${pad2(periodEnd.getMonth() + 1)}${pad2(periodEnd.getDate())}`;

  const fields = [
    'EXTF',
    700, // format version
    21, // format category: Buchungsstapel
    'Buchungsstapel',
    13, // format version of "Buchungsstapel"
    timestamp,
    '', // imported at
    'RE', // origin: "Rechnungswesen"
    '', // exporting application info
    '',
    consultantNumber,
    clientNumber,
    fiscalYearStart,
    4, // account length (matches the illustrative 4-digit SKR03 accounts)
    fromDate,
    toDate,
    'MicroRealEstate Export',
    '', // Diktatkürzel
    1, // Buchungstyp: 1 = Finanzbuchführung
    0,
    0,
    'EUR'
  ];

  return fields.join(';');
}
