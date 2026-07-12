import { flow, makeObservable, observable } from 'mobx';

import { apiFetcher } from '../utils/fetch';
import { updateItems } from './utils';

export default class Banking {
  constructor() {
    this.banks = [];
    this.accounts = [];
    this.transactions = [];

    makeObservable(this, {
      banks: observable,
      accounts: observable,
      transactions: observable,
      fetchBanks: flow,
      fetchAccounts: flow,
      initiateConnection: flow,
      completeConnection: flow,
      selectAccounts: flow,
      updateAccount: flow,
      disconnectAccount: flow,
      syncAccount: flow,
      fetchTransactions: flow,
      matchTransactions: flow,
      confirmMatch: flow,
      ignoreTransaction: flow
    });
  }

  *fetchBanks() {
    try {
      const response = yield apiFetcher().get('/banking/banks');
      this.banks = response.data;
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *fetchAccounts() {
    try {
      const response = yield apiFetcher().get('/banking/bankaccounts');
      this.accounts = response.data;
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  // Step 1 of UC1: ask the aggregator where to send the landlord for SCA.
  *initiateConnection(bankId) {
    try {
      const response = yield apiFetcher().post(
        '/banking/bankaccounts/connect',
        {
          bankId
        }
      );
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  // Step 2: exchange the SCA result for an opaque connectionToken and the
  // discovered accounts - called from the /banking/callback page.
  *completeConnection(connectionId, authorizationCode) {
    try {
      const response = yield apiFetcher().post(
        '/banking/bankaccounts/connect/complete',
        { connectionId, authorizationCode }
      );
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  // Step 3: persist the accounts the landlord picked, with their property assignment.
  *selectAccounts(connectionToken, selections) {
    try {
      const response = yield apiFetcher().post(
        '/banking/bankaccounts/connect/select',
        { connectionToken, selections }
      );
      this.accounts = [...this.accounts, ...response.data];
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *updateAccount(bankAccountId, propertyIds) {
    try {
      const response = yield apiFetcher().patch(
        `/banking/bankaccounts/${bankAccountId}`,
        { propertyIds }
      );
      this.accounts = updateItems(response.data, this.accounts);
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *disconnectAccount(bankAccountId) {
    try {
      const response = yield apiFetcher().post(
        `/banking/bankaccounts/${bankAccountId}/disconnect`
      );
      this.accounts = updateItems(response.data, this.accounts);
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *syncAccount(bankAccountId) {
    try {
      const response = yield apiFetcher().post(
        `/banking/bankaccounts/${bankAccountId}/sync`
      );
      this.accounts = updateItems(response.data, this.accounts);
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *fetchTransactions(status) {
    try {
      const response = yield apiFetcher().get('/banking/transactions', {
        params: status ? { status } : undefined
      });
      this.transactions = response.data;
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  // Manual "re-check now" - sync already triggers this automatically, this
  // is only exposed for the rare case a landlord wants to force a re-match
  // (e.g. after editing a tenant's rent) without waiting for the next sync.
  *matchTransactions() {
    try {
      yield apiFetcher().post('/banking/transactions/match');
      return { status: 200 };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *confirmMatch(transactionId, tenantId, term) {
    try {
      const response = yield apiFetcher().post(
        `/banking/transactions/${transactionId}/confirm`,
        { tenantId, term }
      );
      this.transactions = updateItems(response.data, this.transactions);
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *ignoreTransaction(transactionId) {
    try {
      const response = yield apiFetcher().post(
        `/banking/transactions/${transactionId}/ignore`
      );
      this.transactions = updateItems(response.data, this.transactions);
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }
}
