import { flow, makeObservable, observable } from 'mobx';

import { apiFetcher } from '../utils/fetch';
import { updateItems } from './utils';

export default class Cashflow {
  constructor() {
    this.data = {};
    this.loans = [];
    this.depreciations = [];

    makeObservable(this, {
      data: observable,
      loans: observable,
      depreciations: observable,
      fetch: flow,
      updateTransactionCategory: flow,
      fetchLoans: flow,
      createLoan: flow,
      updateLoan: flow,
      deleteLoan: flow,
      fetchDepreciations: flow,
      createDepreciation: flow,
      updateDepreciation: flow,
      deleteDepreciation: flow
    });
  }

  // The whole analysis (transactions, category totals, summary and the sankey
  // graph) is computed backend side - this store only keeps what it renders.
  *fetch(month, propertyId) {
    try {
      const response = yield apiFetcher().get('/banking/cashflow', {
        params: propertyId ? { month, propertyId } : { month }
      });
      this.data = response.data;
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  // category null removes the manual override and hands the transaction back
  // to the automatic categorization.
  *updateTransactionCategory(transactionId, category, loanId) {
    try {
      const response = yield apiFetcher().patch(
        `/banking/transactions/${transactionId}/category`,
        { category, loanId }
      );
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *fetchLoans(propertyId) {
    try {
      const response = yield apiFetcher().get('/banking/loans', {
        params: propertyId ? { propertyId } : undefined
      });
      this.loans = response.data;
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *createLoan(loan) {
    try {
      const response = yield apiFetcher().post('/banking/loans', loan);
      this.loans = updateItems(response.data, this.loans);
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *updateLoan(loan) {
    try {
      const response = yield apiFetcher().patch(
        `/banking/loans/${loan._id}`,
        loan
      );
      this.loans = updateItems(response.data, this.loans);
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *deleteLoan(loanId) {
    try {
      yield apiFetcher().delete(`/banking/loans/${loanId}`);
      this.loans = this.loans.filter((loan) => loan._id !== loanId);
      return { status: 200 };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *fetchDepreciations(propertyId) {
    try {
      const response = yield apiFetcher().get('/banking/depreciations', {
        params: propertyId ? { propertyId } : undefined
      });
      this.depreciations = response.data;
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *createDepreciation(depreciation) {
    try {
      const response = yield apiFetcher().post(
        '/banking/depreciations',
        depreciation
      );
      this.depreciations = updateItems(response.data, this.depreciations);
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *updateDepreciation(depreciation) {
    try {
      const response = yield apiFetcher().patch(
        `/banking/depreciations/${depreciation._id}`,
        depreciation
      );
      this.depreciations = updateItems(response.data, this.depreciations);
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *deleteDepreciation(depreciationId) {
    try {
      yield apiFetcher().delete(`/banking/depreciations/${depreciationId}`);
      this.depreciations = this.depreciations.filter(
        (depreciation) => depreciation._id !== depreciationId
      );
      return { status: 200 };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }
}
