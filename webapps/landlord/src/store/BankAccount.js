import { action, flow, makeObservable, observable } from 'mobx';

import { apiFetcher } from '../utils/fetch';

// UC1: bank account connection (XS2A/open banking), backed by
// services/banking/src/managers/bankaccountmanager.ts. Only a mock
// aggregator exists so far (see services/banking/src/aggregator/
// mockadapter.ts) - the "supported banks" list below mirrors that mock's
// SUPPORTED_BANKS, which the aggregator does not expose over the API.
export const MOCK_SUPPORTED_BANKS = [
  { id: 'DE_MOCKBANK', name: 'Mockbank AG' },
  { id: 'DE_TESTSPARKASSE', name: 'Testsparkasse' }
];

export default class BankAccount {
  constructor() {
    this.items = [];

    makeObservable(this, {
      items: observable,
      setItems: action,
      fetch: flow,
      initiateConnection: flow,
      completeConnection: flow,
      selectAccounts: flow,
      sync: flow
    });
  }

  setItems = (items) => (this.items = items);

  *fetch() {
    try {
      const response = yield apiFetcher().get('/banking/bankaccounts');
      this.items = response.data;
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *initiateConnection(bankId) {
    try {
      const response = yield apiFetcher().post(
        '/banking/bankaccounts/connect',
        { bankId }
      );
      return { status: 200, data: response.data };
    } catch (error) {
      return {
        status: error?.response?.status,
        message: error?.response?.data?.message
      };
    }
  }

  *completeConnection(connectionId, authorizationCode) {
    try {
      const response = yield apiFetcher().post(
        '/banking/bankaccounts/connect/complete',
        { connectionId, authorizationCode }
      );
      return { status: 200, data: response.data };
    } catch (error) {
      return {
        status: error?.response?.status,
        message: error?.response?.data?.message
      };
    }
  }

  *selectAccounts(connectionId, authorizationCode, selections) {
    try {
      const response = yield apiFetcher().post(
        '/banking/bankaccounts/connect/select',
        { connectionId, authorizationCode, selections }
      );
      this.items = [...this.items, ...response.data];
      return { status: 200, data: response.data };
    } catch (error) {
      return {
        status: error?.response?.status,
        message: error?.response?.data?.message
      };
    }
  }

  *sync(bankAccountId) {
    try {
      const response = yield apiFetcher().post(
        `/banking/bankaccounts/${bankAccountId}/sync`
      );
      this.items = this.items.map((item) =>
        item._id === bankAccountId ? response.data : item
      );
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }
}
