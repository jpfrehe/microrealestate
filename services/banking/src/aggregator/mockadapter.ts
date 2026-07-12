import {
  AggregatorAdapter,
  AggregatorTransaction,
  BankNotSupportedError,
  ConnectionInitiation,
  ConnectionResult,
  ConsentDeniedError
} from './adapter.js';

// A deterministic, in-memory aggregator used until a real XS2A provider is
// selected and contracted (see system.md's provider comparison). It lets the
// rest of the banking service - and its tests - be built and exercised
// without live bank credentials.
const SUPPORTED_BANKS: Record<string, { name: string; iban: string }> = {
  DE_MOCKBANK: { name: 'Mockbank AG', iban: 'DE89370400440532013000' },
  DE_TESTSPARKASSE: {
    name: 'Testsparkasse',
    iban: 'DE02120300000000202051'
  }
};

// sentinel authorizationCode values a test/dev caller can use to force a
// given outcome of the SCA step, mirroring UC1's alternate flows
const DENIED_AUTHORIZATION_CODE = 'DENY';
const CONSENT_VALIDITY_DAYS = 90;

export default class MockAggregatorAdapter implements AggregatorAdapter {
  readonly provider = 'mock';

  async initiateConnection({
    bankId,
    redirectUrl
  }: {
    bankId: string;
    redirectUrl: string;
  }): Promise<ConnectionInitiation> {
    if (!SUPPORTED_BANKS[bankId]) {
      throw new BankNotSupportedError(bankId);
    }

    const connectionId = `mock-conn-${bankId}-${Buffer.from(redirectUrl).toString('base64url')}`;
    return {
      connectionId,
      redirectUrl: `https://mock-aggregator.invalid/sca?connectionId=${connectionId}`
    };
  }

  async completeConnection({
    connectionId,
    authorizationCode
  }: {
    connectionId: string;
    authorizationCode: string;
  }): Promise<ConnectionResult> {
    if (authorizationCode === DENIED_AUTHORIZATION_CODE) {
      throw new ConsentDeniedError();
    }

    const bankId = connectionId.split('-')[2];
    const bank = SUPPORTED_BANKS[bankId];
    if (!bank) {
      throw new BankNotSupportedError(bankId || connectionId);
    }

    const consentExpiryDate = new Date();
    consentExpiryDate.setDate(
      consentExpiryDate.getDate() + CONSENT_VALIDITY_DAYS
    );

    return {
      accessToken: `mock-token-${connectionId}`,
      consentExpiryDate,
      accounts: [
        {
          aggregatorAccountId: `${connectionId}-acc-1`,
          iban: bank.iban,
          bankName: bank.name,
          accountHolder: 'Demo Landlord',
          currency: 'EUR'
        }
      ]
    };
  }

  async listTransactions(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _input: {
      accessToken: string;
      aggregatorAccountId: string;
      since?: Date;
    }
  ): Promise<AggregatorTransaction[]> {
    // deterministic, empty by default: dev/demo callers seed transactions
    // directly in the database rather than relying on fabricated data here
    return [];
  }
}
