import {
  AggregatorAdapter,
  AggregatorBalance,
  AggregatorTransaction,
  BankNotSupportedError,
  ConnectionInitiation,
  ConnectionResult,
  ConsentDeniedError,
  RefreshedTokens,
  SupportedBank
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

  // Tracks which bank a connectionId belongs to, so completeConnection()
  // doesn't have to recover it by parsing the connectionId string (fragile:
  // a bank id containing '-' would silently break a split()-based lookup).
  private readonly pendingConnections = new Map<string, string>();

  async listSupportedBanks(): Promise<SupportedBank[]> {
    return Object.entries(SUPPORTED_BANKS).map(([bankId, bank]) => ({
      bankId,
      name: bank.name
    }));
  }

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

    const connectionId = `mock-conn-${Buffer.from(`${bankId}:${redirectUrl}`).toString('base64url')}`;
    this.pendingConnections.set(connectionId, bankId);

    // A real aggregator would send the landlord to their bank's own login
    // page. The mock instead points to a "mock-sca" route that the landlord
    // frontend renders next to its callback route, so the whole connect
    // flow is actually clickable end-to-end without a real bank.
    const mockScaUrl = redirectUrl.replace(/\/callback$/, '/mock-sca');
    const query = new URLSearchParams({ connectionId, returnUrl: redirectUrl });

    return {
      connectionId,
      redirectUrl: `${mockScaUrl}?${query.toString()}`
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

    const bankId = this.pendingConnections.get(connectionId);
    const bank = bankId && SUPPORTED_BANKS[bankId];
    if (!bank) {
      throw new BankNotSupportedError(bankId || connectionId);
    }
    // the connectionId is single-use, like a real SCA/consent flow
    this.pendingConnections.delete(connectionId);

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
      refreshToken?: string;
      onTokensRefreshed?: (tokens: RefreshedTokens) => void;
    }
  ): Promise<AggregatorTransaction[]> {
    // deterministic, empty by default: dev/demo callers seed transactions
    // directly in the database rather than relying on fabricated data here
    return [];
  }

  async getBalance(input: {
    accessToken: string;
    refreshToken?: string;
    aggregatorAccountId: string;
    onTokensRefreshed?: (tokens: RefreshedTokens) => void;
  }): Promise<AggregatorBalance> {
    // deterministic, fixed value: the mock has no real account ledger to
    // read from, so it returns a plausible balance for the given account
    return {
      aggregatorAccountId: input.aggregatorAccountId,
      currency: 'EUR',
      availableBalance: 1000,
      currentBalance: 1000,
      asOfDate: new Date()
    };
  }
}
