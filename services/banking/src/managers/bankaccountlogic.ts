import { CollectionTypes } from '@microrealestate/types';
import { ConnectionResult } from '../aggregator/adapter.js';

// Pure, framework/DB-independent logic (mirrors the existing split between
// services/api/src/managers/contract.js and rentmanager.js) so it can be
// unit-tested without pulling in Express, Mongoose or Service.

export type BankAccountSelection = {
  aggregatorAccountId: string;
  iban: string;
  bankName: string;
  accountHolder: string;
  propertyIds: string[];
};

// Maps the accounts a landlord picked (out of the accounts returned by
// completeConnection) into persistable BankAccount records. `encrypt` and
// `now` are injected so this stays pure and deterministic in tests.
export function toBankAccountRecords(
  realmId: string,
  provider: string,
  connectionResult: Pick<ConnectionResult, 'accessToken' | 'consentExpiryDate'>,
  selections: BankAccountSelection[],
  encrypt: (text: string) => string,
  now: Date = new Date()
): Omit<CollectionTypes.BankAccount, '_id' | 'createdDate' | 'updatedDate'>[] {
  if (!selections.length) {
    throw new Error('at least one account must be selected');
  }

  return selections.map((selection) => ({
    realmId,
    propertyIds: selection.propertyIds || [],
    aggregatorProvider: provider,
    aggregatorAccountId: selection.aggregatorAccountId,
    iban: selection.iban,
    bankName: selection.bankName,
    accountHolder: selection.accountHolder,
    encryptedAccessToken: encrypt(connectionResult.accessToken),
    consentGivenDate: now,
    consentExpiryDate: connectionResult.consentExpiryDate,
    status: 'connected'
  }));
}

export function isConsentExpired(
  consentExpiryDate: Date,
  now: Date = new Date()
): boolean {
  return new Date(consentExpiryDate).getTime() <= now.getTime();
}

// Only ever toggles between the two statuses a sync attempt can observe;
// a landlord-initiated 'disconnected' account is left untouched, and a
// 'pending' account has no consent yet so it cannot expire.
export function nextStatusAfterSyncAttempt(
  currentStatus: CollectionTypes.BankAccount['status'],
  consentExpiryDate: Date,
  now: Date = new Date()
): CollectionTypes.BankAccount['status'] {
  if (currentStatus !== 'connected' && currentStatus !== 'reauth_required') {
    return currentStatus;
  }
  return isConsentExpired(consentExpiryDate, now)
    ? 'reauth_required'
    : 'connected';
}

export function toTransactionRecords(
  realmId: string,
  bankAccountId: string,
  aggregatorTransactions: {
    aggregatorTransactionId: string;
    amount: number;
    currency: string;
    valueDate: Date;
    bookingDate: Date;
    counterpartyName?: string;
    counterpartyIban?: string;
    remittanceInformation: string;
  }[]
): Omit<CollectionTypes.Transaction, '_id' | 'createdDate' | 'updatedDate'>[] {
  return aggregatorTransactions.map((t) => ({
    realmId,
    bankAccountId,
    aggregatorTransactionId: t.aggregatorTransactionId,
    amount: t.amount,
    currency: t.currency,
    valueDate: t.valueDate,
    bookingDate: t.bookingDate,
    counterpartyName: t.counterpartyName,
    counterpartyIban: t.counterpartyIban,
    remittanceInformation: t.remittanceInformation,
    matchStatus: 'unmatched',
    matchCandidates: []
  }));
}

export function stripSecrets(
  bankAccount: CollectionTypes.BankAccount
): Omit<CollectionTypes.BankAccount, 'encryptedAccessToken'> {
  const copy: Partial<CollectionTypes.BankAccount> = { ...bankAccount };
  delete copy.encryptedAccessToken;
  return copy as Omit<CollectionTypes.BankAccount, 'encryptedAccessToken'>;
}
