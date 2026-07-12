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
      amount: Math.round(share * 100) / 100
    }));
  }

  return properties.map((p) => ({
    propertyId: p.propertyId,
    amount: Math.round(((amount * (p.rent || 0)) / totalRent) * 100) / 100
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
        const dueAmount =
          Math.round(
            (rent.total.grandTotal - (rent.total.balance || 0)) * 100
          ) / 100;
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
    const income = Math.round((incomeByProperty.get(propertyId) || 0) * 100) / 100;
    const due = Math.round((dueByProperty.get(propertyId) || 0) * 100) / 100;
    const expensesTotal =
      Math.round((expensesByProperty.get(propertyId) || 0) * 100) / 100;

    return {
      propertyId,
      propertyName: property.name,
      dueAmount: due,
      income,
      expenses: expensesTotal,
      cashflow: Math.round((income - expensesTotal) * 100) / 100,
      arrears: Math.round((due - income) * 100) / 100
    };
  });

  const portfolio = propertyCashflows.reduce(
    (acc, p) => ({
      dueAmount: Math.round((acc.dueAmount + p.dueAmount) * 100) / 100,
      income: Math.round((acc.income + p.income) * 100) / 100,
      expenses: Math.round((acc.expenses + p.expenses) * 100) / 100,
      cashflow: Math.round((acc.cashflow + p.cashflow) * 100) / 100,
      arrears: Math.round((acc.arrears + p.arrears) * 100) / 100
    }),
    { dueAmount: 0, income: 0, expenses: 0, cashflow: 0, arrears: 0 }
  );

  const topArrears = propertyCashflows
    .filter((p) => p.arrears > 0)
    .sort((a, b) => b.arrears - a.arrears)
    .slice(0, 5);

  return { properties: propertyCashflows, portfolio, topArrears };
}
