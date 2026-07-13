import { action, computed, flow, makeObservable, observable, toJS } from 'mobx';

import { apiFetcher } from '../utils/fetch';
import moment from 'moment';

export default class Dashboard {
  constructor() {
    this.data = {};
    this.cashflowPeriod = 'month';
    this.onlyArrears = false;

    makeObservable(this, {
      data: observable,
      cashflowPeriod: observable,
      onlyArrears: observable,
      fetch: flow,
      currentRevenues: computed,
      cashflow: computed,
      setCashflowPeriod: action,
      setOnlyArrears: action
    });
  }

  get currentRevenues() {
    const currentMonth = moment().format('MMYYYY');
    const revenues = toJS(
      this.data.revenues.find(({ month }) => currentMonth === month)
    ) || {
      month: currentMonth,
      paid: 0,
      notPaid: 0
    };

    revenues.notPaid = Math.abs(revenues.notPaid);
    return revenues;
  }

  // UC3: portfolio-wide + per-property cashflow for the selected period,
  // as returned by GET /dashboard?cashflowPeriod=... (services/api/src/
  // managers/dashboardmanager.js)
  get cashflow() {
    const cashflow = toJS(this.data.cashflow) || {
      period: 'month',
      hasExpenseData: false,
      hasBankAccount: false,
      properties: [],
      portfolio: {
        dueAmount: 0,
        income: 0,
        expenses: 0,
        cashflow: 0,
        arrears: 0
      },
      topArrears: []
    };

    const properties = this.onlyArrears
      ? cashflow.properties.filter((p) => p.arrears > 0)
      : cashflow.properties;

    return { ...cashflow, properties };
  }

  setCashflowPeriod = (period) => {
    this.cashflowPeriod = period;
  };

  setOnlyArrears = (onlyArrears) => {
    this.onlyArrears = onlyArrears;
  };

  *fetch() {
    try {
      const response = yield apiFetcher().get('/dashboard', {
        params: { cashflowPeriod: this.cashflowPeriod }
      });
      this.data = response.data;

      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }
}
