import { round2 } from './money.js';

// Pure cashflow aggregation for UC3 (useCases.md). Kept free of Mongoose/
// Express - like contract.js/businesslogic - so it can be unit-tested with
// plain data; dashboardmanager.js fetches from Mongo and calls into this.

// Splits a tenant's due/paid amount for one term across the properties they
// occupy, proportional to each property's own rent share. A tenant renting a
// single property gets the whole amount attributed to it, which covers the
// common case without needing per-property payment tracking.
function allocateAcrossProperties(properties, amount) {
  if (!properties || !properties.length) {
    return [];
  }

  const totalRent = properties.reduce((sum, p) => sum + (p.rent || 0), 0);
  if (totalRent <= 0) {
    // no rent shares to allocate by - split evenly rather than dropping the amount
    const share = amount / properties.length;
    return properties.map((p) => ({
      propertyId: p.propertyId,
      amount: round2(share)
    }));
  }

  return properties.map((p) => ({
    propertyId: p.propertyId,
    amount: round2((amount * (p.rent || 0)) / totalRent)
  }));
}

function isTermInRange(term, startTerm, endTerm) {
  return term >= startTerm && term <= endTerm;
}

// tenants: plain objects with { properties: [{propertyId, rent}], rents: [{term, total: {grandTotal, balance, payment}}] }
// expenses: plain objects with { propertyId, amount, date } - date already resolved to a term-comparable value by the caller
// properties: plain objects with { _id, name }
export function computeCashflow({
  properties,
  tenants,
  expenses,
  startTerm,
  endTerm
}) {
  const incomeByProperty = new Map();
  const dueByProperty = new Map();
  const expensesByProperty = new Map();

  const addTo = (map, propertyId, amount) => {
    map.set(propertyId, (map.get(propertyId) || 0) + amount);
  };

  tenants.forEach((tenant) => {
    (tenant.rents || [])
      .filter((rent) => isTermInRange(rent.term, startTerm, endTerm))
      .forEach((rent) => {
        const dueAmount = round2(
          rent.total.grandTotal - (rent.total.balance || 0)
        );
        const paidAmount = rent.total.payment || 0;

        allocateAcrossProperties(tenant.properties, dueAmount).forEach(
          ({ propertyId, amount }) => addTo(dueByProperty, propertyId, amount)
        );
        allocateAcrossProperties(tenant.properties, paidAmount).forEach(
          ({ propertyId, amount }) =>
            addTo(incomeByProperty, propertyId, amount)
        );
      });
  });

  expenses.forEach((expense) => {
    addTo(expensesByProperty, expense.propertyId, expense.amount);
  });

  const propertyCashflows = properties.map((property) => {
    const propertyId = String(property._id);
    const income = round2(incomeByProperty.get(propertyId) || 0);
    const due = round2(dueByProperty.get(propertyId) || 0);
    const expensesTotal = round2(expensesByProperty.get(propertyId) || 0);

    return {
      propertyId,
      propertyName: property.name,
      dueAmount: due,
      income,
      expenses: expensesTotal,
      cashflow: round2(income - expensesTotal),
      arrears: round2(due - income)
    };
  });

  const portfolio = propertyCashflows.reduce(
    (acc, p) => ({
      dueAmount: round2(acc.dueAmount + p.dueAmount),
      income: round2(acc.income + p.income),
      expenses: round2(acc.expenses + p.expenses),
      cashflow: round2(acc.cashflow + p.cashflow),
      arrears: round2(acc.arrears + p.arrears)
    }),
    { dueAmount: 0, income: 0, expenses: 0, cashflow: 0, arrears: 0 }
  );

  const topArrears = propertyCashflows
    .filter((p) => p.arrears > 0)
    .sort((a, b) => b.arrears - a.arrears)
    .slice(0, 5);

  return { properties: propertyCashflows, portfolio, topArrears };
}
