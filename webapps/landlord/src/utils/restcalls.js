import { apiFetcher } from '../utils/fetch';
import moment from 'moment';

export const QueryKeys = {
  DASHBOARD: 'dashboard',
  ORGANIZATIONS: 'organizations',
  PROPERTIES: 'properties',
  TENANTS: 'tenants',
  RENTS: 'rents',
  LEASES: 'leases',
  BANKS: 'banks',
  BANK_ACCOUNTS: 'bankAccounts',
  TRANSACTIONS: 'transactions',
  EXPENSES: 'expenses',
  DATEV_PREVIEW: 'datevPreview'
};

export async function fetchDashboard(store) {
  const response = await store.dashboard.fetch();
  return response.data;
}

export async function fetchOrganizations(store) {
  const response = await store.organization.fetch();
  return response.data;
}

export async function createOrganization({ store, organization }) {
  const response = await store.organization.create(organization);
  return response.data;
}

export async function updateOrganization({ store, organization }) {
  const response = await store.organization.update(organization);
  return response.data;
}

export async function createAppCredentials({ organization, expiryDate }) {
  const response = await apiFetcher().post('/authenticator/landlord/appcredz', {
    expiry: expiryDate,
    organizationId: organization._id
  });
  return response.data;
}

export async function fetchProperties(store) {
  const response = await store.property.fetch();
  return response.data;
}

export async function fetchTenants(store) {
  const response = await store.tenant.fetch();
  return response.data;
}

export async function fetchRents(store, yearMonth) {
  let period;
  if (yearMonth) {
    period = moment(yearMonth, 'YYYY.MM', true);
  }

  if (!period || !period.isValid()) {
    period = moment();
  }

  store.rent.setPeriod(period);

  const response = await store.rent.fetch();
  return response.data;
}

export async function fetchLeases(store) {
  const response = await store.lease.fetch();
  return response.data;
}

export async function updateLease({ store, lease }) {
  const response = await store.lease.update(lease);
  return response.data;
}

export async function fetchBanks(store) {
  const response = await store.banking.fetchBanks();
  return response.data;
}

export async function fetchBankAccounts(store) {
  const response = await store.banking.fetchAccounts();
  return response.data;
}

export async function fetchTransactions(store, status) {
  const response = await store.banking.fetchTransactions(status);
  return response.data;
}

export async function fetchExpenses(store, propertyId) {
  const response = await store.expense.fetch(propertyId);
  return response.data;
}

export async function fetchDatevPreview(store, year, month) {
  const response = await apiFetcher().get(
    `/accounting/${year}/${month}/datev/preview`
  );
  return response.data;
}

export async function sendDatevExport(store, year, month) {
  const response = await apiFetcher().post(
    `/accounting/${year}/${month}/datev/send`
  );
  return response.data;
}
