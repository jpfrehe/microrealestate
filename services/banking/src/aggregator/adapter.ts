// Abstraction over an XS2A/open-banking aggregator (e.g. finAPI, Enable
// Banking, Tink - see system.md's provider comparison). Keeping this as an
// interface lets the concrete provider be swapped without touching the
// connection/sync/matching logic, per the Phase 0 architecture decision.

export type AggregatorAccount = {
  aggregatorAccountId: string;
  iban: string;
  bankName: string;
  accountHolder: string;
  currency: string;
};

export type AggregatorTransaction = {
  aggregatorTransactionId: string;
  amount: number;
  currency: string;
  valueDate: Date;
  bookingDate: Date;
  counterpartyName?: string;
  counterpartyIban?: string;
  remittanceInformation: string;
};

export type ConnectionInitiation = {
  // where the landlord is redirected to authenticate with their bank (SCA/TAN)
  redirectUrl: string;
  // opaque handle used to resume the flow in completeConnection
  connectionId: string;
};

export type ConnectionResult = {
  // opaque credential handed back by the aggregator; the caller is
  // responsible for encrypting it before persisting it
  accessToken: string;
  // consent lifetime granted by the bank, typically 90 days under PSD2/XS2A
  consentExpiryDate: Date;
  accounts: AggregatorAccount[];
};

export class BankNotSupportedError extends Error {
  constructor(bankId: string) {
    super(`Bank "${bankId}" is not supported by this aggregator`);
    this.name = 'BankNotSupportedError';
  }
}

export class ConsentDeniedError extends Error {
  constructor(
    reason = 'The account holder denied or cancelled the SCA/TAN step'
  ) {
    super(reason);
    this.name = 'ConsentDeniedError';
  }
}

export interface AggregatorAdapter {
  readonly provider: string;

  initiateConnection(input: {
    bankId: string;
    redirectUrl: string;
  }): Promise<ConnectionInitiation>;

  completeConnection(input: {
    connectionId: string;
    authorizationCode: string;
  }): Promise<ConnectionResult>;

  listTransactions(input: {
    accessToken: string;
    aggregatorAccountId: string;
    since?: Date;
  }): Promise<AggregatorTransaction[]>;
}
