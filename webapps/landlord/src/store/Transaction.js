import { action, flow, makeObservable, observable } from 'mobx';

import { apiFetcher } from '../utils/fetch';

// UC2: booking proposals / accounting inbox, backed by
// services/banking/src/managers/matchingmanager.ts.
export default class Transaction {
  constructor() {
    this.items = [];
    this.statusFilter = 'suggested';

    makeObservable(this, {
      items: observable,
      statusFilter: observable,
      setStatusFilter: action,
      fetch: flow,
      runMatching: flow,
      confirm: flow,
      ignore: flow
    });
  }

  setStatusFilter = (statusFilter) => (this.statusFilter = statusFilter);

  *fetch() {
    try {
      const response = yield apiFetcher().get('/banking/transactions', {
        params: this.statusFilter ? { status: this.statusFilter } : {}
      });
      this.items = response.data;
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *runMatching() {
    try {
      yield apiFetcher().post('/banking/transactions/match');
      return { status: 200 };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *confirm(transactionId, tenantId, term) {
    try {
      const response = yield apiFetcher().post(
        `/banking/transactions/${transactionId}/confirm`,
        { tenantId, term }
      );
      this.items = this.items.filter((item) => item._id !== transactionId);
      return { status: 200, data: response.data };
    } catch (error) {
      return {
        status: error?.response?.status,
        message: error?.response?.data?.message
      };
    }
  }

  *ignore(transactionId) {
    try {
      const response = yield apiFetcher().post(
        `/banking/transactions/${transactionId}/ignore`
      );
      this.items = this.items.filter((item) => item._id !== transactionId);
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }
}
