import { action, flow, makeObservable, observable } from 'mobx';

import { apiFetcher } from '../utils/fetch';
import { updateItems } from './utils';

// UC3: property-/portfolio-level expenses (distinct from the tenant-level
// Tenant.properties[].expenses[] used for rent-charge computation), backed
// by services/api/src/managers/expensemanager.js.
export const EXPENSE_CATEGORIES = [
  'maintenance',
  'insurance',
  'management_fees',
  'property_tax',
  'utilities',
  'loan_interest',
  'other'
];

export default class Expense {
  constructor() {
    this.items = [];
    this.propertyId = undefined;

    makeObservable(this, {
      items: observable,
      propertyId: observable,
      setPropertyId: action,
      fetch: flow,
      create: flow,
      update: flow,
      delete: flow
    });
  }

  setPropertyId = (propertyId) => (this.propertyId = propertyId);

  *fetch(propertyId) {
    try {
      this.propertyId = propertyId;
      const response = yield apiFetcher().get('/expenses', {
        params: propertyId ? { propertyId } : {}
      });
      this.items = response.data;
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *create(expense) {
    try {
      const response = yield apiFetcher().post('/expenses', expense);
      this.items = updateItems(response.data, this.items);
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *update(expense) {
    try {
      const response = yield apiFetcher().patch(
        `/expenses/${expense._id}`,
        expense
      );
      this.items = updateItems(response.data, this.items);
      return { status: 200, data: response.data };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }

  *delete(ids) {
    try {
      yield apiFetcher().delete(`/expenses/${ids.join(',')}`);
      this.items = this.items.filter((item) => !ids.includes(item._id));
      return { status: 200 };
    } catch (error) {
      return { status: error?.response?.status };
    }
  }
}
