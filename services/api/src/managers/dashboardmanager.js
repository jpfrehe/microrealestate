import { Collections } from '@microrealestate/common';
import { computeCashflow } from './cashflow.js';
import moment from 'moment';

// UC3: the cashflow breakdown accepts an independent period selector
// (month/quarter/year, optionally anchored on a given reference date) while
// every other dashboard bucket below keeps its own fixed month/year window.
const CASHFLOW_PERIODS = ['month', 'quarter', 'year'];

function cashflowPeriodBounds(req, now) {
  const period = CASHFLOW_PERIODS.includes(req.query.cashflowPeriod)
    ? req.query.cashflowPeriod
    : 'month';
  const anchor =
    req.query.cashflowDate && moment(req.query.cashflowDate).isValid()
      ? moment(req.query.cashflowDate)
      : moment(now);

  return {
    period,
    start: moment(anchor).startOf(period),
    end: moment(anchor).endOf(period)
  };
}

export async function all(req, res) {
  const now = moment();
  const beginOfTheMonth = moment(now).startOf('month');
  const endOfTheMonth = moment(now).endOf('month');
  const beginOfTheYear = moment(now).startOf('year');
  const endOfTheYear = moment(now).endOf('year');

  // count active tenants
  const allTenants = await Collections.Tenant.find({
    realmId: req.headers.organizationid
  });
  const activeTenants = allTenants.reduce((acc, tenant) => {
    const terminationMoment = tenant.terminationDate
      ? moment(tenant.terminationDate)
      : moment(tenant.endDate);

    if (terminationMoment.isSameOrAfter(now, 'day')) {
      acc.push(tenant);
    }

    return acc;
  }, []);
  const tenantCount = activeTenants.length;

  // fetch properties (also used below for the cashflow breakdown)
  const allProperties = await Collections.Property.find({
    realmId: req.headers.organizationid
  }).lean();
  const propertyCount = allProperties.length;

  // compute occupancyRate
  let occupancyRate;
  if (propertyCount > 0) {
    const countPropertyRented = activeTenants.reduce(
      (acc, { properties = [] }) => {
        properties.forEach(({ propertyId }) => acc.add(propertyId));
        return acc;
      },
      new Set()
    ).size;
    occupancyRate = countPropertyRented / propertyCount;
  }

  // sum all rent payments of the current year
  let totalYearRevenues = 0;

  if (allTenants.length > 0) {
    totalYearRevenues = allTenants.reduce((total, { rents }) => {
      let sumPayments = 0;
      rents.forEach((rent) => {
        rent.payments.forEach((payment) => {
          if (!payment.date || payment.amount === 0) {
            return;
          }

          const paymentMoment = moment(payment.date, 'DD/MM/YYYY');
          if (
            paymentMoment.isBetween(beginOfTheYear, endOfTheYear, 'day', '[]')
          ) {
            sumPayments = sumPayments + payment.amount;
          }
        });
      });

      return total + sumPayments;
    }, 0);
  }

  // build overview bucket
  const overview =
    tenantCount || propertyCount
      ? {
          tenantCount,
          propertyCount,
          occupancyRate,
          totalYearRevenues
        }
      : null;

  // compute top 5 tenants who have not paid their rents
  const topUnpaid =
    tenantCount || propertyCount
      ? activeTenants
          .reduce((acc, tenant) => {
            const currentRent = tenant.rents.find((rent) => {
              const termMoment = rent.term && moment(rent.term, 'YYYYMMDDHH');
              return (
                termMoment &&
                termMoment.isBetween(
                  beginOfTheMonth,
                  endOfTheMonth,
                  'day',
                  '[]'
                )
              );
            });
            if (currentRent) {
              acc.push({
                tenant: tenant.toObject(),
                balance:
                  currentRent.total.payment - currentRent.total.grandTotal,
                rent: currentRent
              });
            }
            return acc;
          }, [])
          .sort((t1, t2) => t1.balance - t2.balance)
          .filter((t) => t.balance < 0)
          .slice(0, 5) // Top 5
      : [];

  // compute rents of year splitted by month
  const emptyRevenues = moment.months().reduce((acc, month, index) => {
    const key = moment(`${index + 1}/${now.year()}`, 'MM/YYYYY').format(
      'MMYYYY'
    );
    acc[key] = {
      month: key,
      paid: 0,
      notPaid: 0
    };
    return acc;
  }, {});
  const revenues = Object.entries(
    allTenants.reduce((acc, { rents }) => {
      rents.forEach((rent) => {
        const termMoment = moment(rent.term, 'YYYYMMDDHH');
        if (!termMoment.isBetween(beginOfTheYear, endOfTheYear, 'day', '[]')) {
          return;
        }
        const key = termMoment.format('MMYYYY');
        const revenue = {
          month: key,
          paid: rent.total.payment,
          notPaid:
            rent.total.payment - rent.total.grandTotal < 0
              ? rent.total.payment - rent.total.grandTotal
              : 0
        };
        if (acc[key]) {
          acc[key].paid += revenue.paid;
          acc[key].notPaid += revenue.notPaid;
        } else {
          acc[key] = revenue;
        }
      });
      return acc;
    }, emptyRevenues)
  )
    .map(([, value]) => ({
      ...value,
      paid: value.paid > 0 ? Math.round(value.paid * 100) / 100 : value.paid,
      notPaid:
        value.notPaid < 0
          ? Math.round(value.notPaid * 100) / 100
          : value.notPaid
    }))
    .sort((r1, r2) =>
      moment(r1.month, 'MMYYYY').isBefore(moment(r2.month, 'MMYYYY')) ? -1 : 1
    );

  // cashflow of the selected period (default: current month), per property
  // and for the whole portfolio (UC3 - falls back to Soll/Ist rent data
  // alone when no expense was recorded yet and no bank account is
  // connected, see useCases.md UC3)
  const cashflowBounds = cashflowPeriodBounds(req, now);
  const [allExpenses, connectedBankAccountCount] = await Promise.all([
    Collections.Expense.find({
      realmId: req.headers.organizationid,
      date: {
        $gte: cashflowBounds.start.toDate(),
        $lte: cashflowBounds.end.toDate()
      }
    }).lean(),
    Collections.BankAccount.countDocuments({
      realmId: req.headers.organizationid,
      status: { $ne: 'disconnected' }
    })
  ]);
  const cashflow = {
    period: cashflowBounds.period,
    startDate: cashflowBounds.start.toISOString(),
    endDate: cashflowBounds.end.toISOString(),
    hasExpenseData: allExpenses.length > 0,
    hasBankAccount: connectedBankAccountCount > 0,
    ...computeCashflow({
      properties: allProperties,
      tenants: allTenants,
      expenses: allExpenses,
      startTerm: Number(cashflowBounds.start.format('YYYYMMDDHH')),
      endTerm: Number(cashflowBounds.end.format('YYYYMMDDHH'))
    })
  };

  res.json({
    overview,
    topUnpaid,
    revenues,
    cashflow
  });
}
