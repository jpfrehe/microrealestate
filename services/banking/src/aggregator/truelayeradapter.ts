import {
  AggregatorAccount,
  AggregatorAdapter,
  AggregatorBalance,
  AggregatorTransaction,
  ConnectionInitiation,
  ConnectionResult,
  ConsentDeniedError,
  RefreshedTokens,
  SupportedBank
} from './adapter.js';
import axios from 'axios';
import { randomUUID } from 'crypto';

// TrueLayer (https://docs.truelayer.com) implementation of the
// provider-agnostic AggregatorAdapter interface - see system.md's provider
// comparison. Field names below are TrueLayer's documented/best-confidence
// response shapes; every mapper is deliberately strict (throws on a missing
// required field) rather than silently producing undefined/NaN, since a
// wrong field name should fail loudly instead of corrupting financial data.

const ENVIRONMENT_URLS: Record<
  'sandbox' | 'live',
  { authBaseUrl: string; apiBaseUrl: string }
> = {
  sandbox: {
    authBaseUrl: 'https://auth.truelayer-sandbox.com',
    apiBaseUrl: 'https://api.truelayer-sandbox.com'
  },
  live: {
    authBaseUrl: 'https://auth.truelayer.com',
    apiBaseUrl: 'https://api.truelayer.com'
  }
};

const SCOPES = 'info accounts balance transactions offline_access';
// TrueLayer's token response carries no explicit consent-expiry field;
// approximate with the PSD2/XS2A ceiling, same as MockAggregatorAdapter.
const CONSENT_VALIDITY_DAYS = 90;
const CONNECTION_ID_PREFIX = 'tl-conn-';
const DEBIT = 'DEBIT';
const CREDIT = 'CREDIT';

// Only the fields this adapter actually reads, per docs.truelayer.com. The
// getaccountbalance/getaccounttransactions reference pages are interactive
// and don't scrape cleanly (verified via WebFetch), so these two shapes are
// the best-confidence ones from the task brief - hence the strict parsing.
type RawProvider = {
  provider_id?: string;
  display_name?: string;
};

type RawAccount = {
  account_id?: string;
  account_number?: { iban?: string };
  currency?: string;
  provider?: { display_name?: string };
};

type RawIdentityResult = {
  full_name?: string;
};

type RawBalance = {
  currency?: string;
  available?: number;
  current?: number;
  update_timestamp?: string;
};

type RawTransactionMeta = {
  provider_counter_party_iban?: string;
  counter_party_iban?: string;
  provider_counter_party_name?: string;
  counter_party_preferred_name?: string;
};

type RawTransaction = {
  transaction_id?: string;
  timestamp?: string;
  description?: string;
  amount?: number;
  currency?: string;
  transaction_type?: string;
  meta?: RawTransactionMeta;
};

type RawTokenResponse = {
  access_token?: string;
  refresh_token?: string;
};

type RawErrorResponse = {
  error?: string;
  error_description?: string;
};

// Structural subset of the axios default export this adapter needs, so a
// test can inject a fake `{ get: jest.fn(), post: jest.fn() }` instead of
// hitting the network - same DI convention as bankaccountlogic.ts's
// encrypt/decrypt. Never call axios.create(): see httpinterceptors.ts for
// why the Service bootstrap's logging interceptors only attach to the
// default axios singleton. Exported so tests can type their fake without
// resorting to `any`.
export type TrueLayerHttpClient = Pick<typeof axios, 'get' | 'post'>;

export type TrueLayerAdapterOptions = {
  clientId: string;
  clientSecret: string;
  environment: 'sandbox' | 'live';
  httpClient?: TrueLayerHttpClient;
};

function getErrorResponseData(error: unknown): RawErrorResponse | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = (error as { response?: { data?: RawErrorResponse } })
    .response;
  return response?.data;
}

function isUnauthorized(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return false;
  }
  const response = (error as { response?: { status?: number } }).response;
  return response?.status === 401;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// connectionId decode/encode: completeConnection() only receives
// {connectionId, authorizationCode} (no redirectUrl), but the token exchange
// needs the exact same redirect_uri again later. Rather than keep in-memory
// state (single-instance, not multi-replica-safe - see
// MockAggregatorAdapter's pendingConnections), what's needed is encoded
// directly into the opaque connectionId itself.
function encodeConnectionId(bankId: string, redirectUrl: string): string {
  return `${CONNECTION_ID_PREFIX}${Buffer.from(
    JSON.stringify({ bankId, redirectUrl })
  ).toString('base64url')}`;
}

function decodeConnectionId(connectionId: string): {
  bankId: string;
  redirectUrl: string;
} {
  if (!connectionId.startsWith(CONNECTION_ID_PREFIX)) {
    throw new Error(`Not a TrueLayer connectionId: "${connectionId}"`);
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(
        connectionId.slice(CONNECTION_ID_PREFIX.length),
        'base64url'
      ).toString('utf8')
    ) as { bankId?: string; redirectUrl?: string };
    if (!decoded.bankId || !decoded.redirectUrl) {
      throw new Error('missing bankId/redirectUrl');
    }
    return { bankId: decoded.bankId, redirectUrl: decoded.redirectUrl };
  } catch {
    throw new Error(`Malformed TrueLayer connectionId: "${connectionId}"`);
  }
}

export function parseProvider(raw: RawProvider): SupportedBank {
  if (!raw.provider_id) {
    throw new Error('TrueLayer provider is missing "provider_id"');
  }
  if (!raw.display_name) {
    throw new Error(
      `TrueLayer provider "${raw.provider_id}" is missing "display_name"`
    );
  }
  return { bankId: raw.provider_id, name: raw.display_name };
}

export function parseAccount(
  raw: RawAccount,
  accountHolder: string
): AggregatorAccount {
  if (!raw.account_id) {
    throw new Error('TrueLayer account is missing "account_id"');
  }
  const iban = raw.account_number?.iban;
  if (!iban) {
    throw new Error(
      `TrueLayer account "${raw.account_id}" is missing "account_number.iban"`
    );
  }
  if (!raw.currency) {
    throw new Error(
      `TrueLayer account "${raw.account_id}" is missing "currency"`
    );
  }
  if (!raw.provider?.display_name) {
    throw new Error(
      `TrueLayer account "${raw.account_id}" is missing "provider.display_name"`
    );
  }

  return {
    aggregatorAccountId: raw.account_id,
    iban,
    bankName: raw.provider.display_name,
    accountHolder,
    currency: raw.currency
  };
}

export function parseTransaction(raw: RawTransaction): AggregatorTransaction {
  if (!raw.transaction_id) {
    throw new Error('TrueLayer transaction is missing "transaction_id"');
  }
  if (typeof raw.amount !== 'number') {
    throw new Error(
      `TrueLayer transaction "${raw.transaction_id}" is missing a numeric "amount"`
    );
  }
  if (raw.transaction_type !== DEBIT && raw.transaction_type !== CREDIT) {
    throw new Error(
      `TrueLayer transaction "${raw.transaction_id}" has an unrecognised "transaction_type": ${raw.transaction_type}`
    );
  }
  if (!raw.timestamp) {
    throw new Error(
      `TrueLayer transaction "${raw.transaction_id}" is missing "timestamp"`
    );
  }
  if (!raw.currency) {
    throw new Error(
      `TrueLayer transaction "${raw.transaction_id}" is missing "currency"`
    );
  }

  // TrueLayer's raw amount sign isn't reliably documented across providers;
  // derive it ourselves from transaction_type rather than trust it, so a
  // wrong assumption can't silently flip a payment's direction.
  const amount =
    raw.transaction_type === DEBIT
      ? -Math.abs(raw.amount)
      : Math.abs(raw.amount);
  // TrueLayer's harmonized transaction schema exposes only one timestamp (no
  // separate booking/value date), so both fields map to it.
  const date = new Date(raw.timestamp);

  return {
    aggregatorTransactionId: raw.transaction_id,
    amount,
    currency: raw.currency,
    valueDate: date,
    bookingDate: date,
    // Best-effort only: TrueLayer doesn't reliably expose a counterparty
    // IBAN/name, some providers surface it under these provider-specific
    // meta keys.
    counterpartyName:
      raw.meta?.provider_counter_party_name ||
      raw.meta?.counter_party_preferred_name ||
      undefined,
    counterpartyIban:
      raw.meta?.provider_counter_party_iban ||
      raw.meta?.counter_party_iban ||
      undefined,
    remittanceInformation: raw.description ?? ''
  };
}

export function parseBalance(
  raw: RawBalance,
  aggregatorAccountId: string
): AggregatorBalance {
  if (!raw.currency) {
    throw new Error('TrueLayer balance is missing "currency"');
  }
  if (typeof raw.available !== 'number') {
    throw new Error('TrueLayer balance is missing a numeric "available"');
  }
  if (typeof raw.current !== 'number') {
    throw new Error('TrueLayer balance is missing a numeric "current"');
  }
  if (!raw.update_timestamp) {
    throw new Error('TrueLayer balance is missing "update_timestamp"');
  }

  return {
    aggregatorAccountId,
    currency: raw.currency,
    availableBalance: raw.available,
    currentBalance: raw.current,
    asOfDate: new Date(raw.update_timestamp)
  };
}

export default class TrueLayerAdapter implements AggregatorAdapter {
  readonly provider = 'truelayer';

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly authBaseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly httpClient: TrueLayerHttpClient;

  constructor({
    clientId,
    clientSecret,
    environment,
    httpClient = axios
  }: TrueLayerAdapterOptions) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.authBaseUrl = ENVIRONMENT_URLS[environment].authBaseUrl;
    this.apiBaseUrl = ENVIRONMENT_URLS[environment].apiBaseUrl;
    this.httpClient = httpClient;
  }

  async listSupportedBanks(): Promise<SupportedBank[]> {
    const query = new URLSearchParams({ clientId: this.clientId });
    const response = await this.httpClient.get<{ results?: RawProvider[] }>(
      `${this.authBaseUrl}/api/providers?${query.toString()}`
    );
    return (response.data?.results ?? []).map(parseProvider);
  }

  async initiateConnection({
    bankId,
    redirectUrl
  }: {
    bankId: string;
    redirectUrl: string;
  }): Promise<ConnectionInitiation> {
    const connectionId = encodeConnectionId(bankId, redirectUrl);

    // Per TrueLayer's docs: when the bank is already known, pass both
    // provider_id (skips their bank-picker UI) and providers (must still
    // list the intended provider).
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUrl,
      scope: SCOPES,
      providers: bankId,
      provider_id: bankId,
      state: randomUUID()
    });

    return {
      connectionId,
      redirectUrl: `${this.authBaseUrl}/?${query.toString()}`
    };
  }

  async completeConnection({
    connectionId,
    authorizationCode
  }: {
    connectionId: string;
    authorizationCode: string;
  }): Promise<ConnectionResult> {
    const { redirectUrl } = decodeConnectionId(connectionId);

    const { accessToken, refreshToken } = await this.exchangeToken({
      grant_type: 'authorization_code',
      redirect_uri: redirectUrl,
      code: authorizationCode
    });

    // TrueLayer's Identity API returns the account holder once per token,
    // not per account, so it's fetched a single time here and reused for
    // every discovered account.
    const [accountsResponse, identityResponse] = await Promise.all([
      this.httpClient.get<{ results?: RawAccount[] }>(
        `${this.apiBaseUrl}/data/v1/accounts`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      ),
      this.httpClient.get<{ results?: RawIdentityResult[] }>(
        `${this.apiBaseUrl}/data/v1/info`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
    ]);

    const accountHolder = identityResponse.data?.results?.[0]?.full_name;
    if (!accountHolder) {
      throw new Error(
        'TrueLayer identity response is missing "results[0].full_name"'
      );
    }

    const accounts = (accountsResponse.data?.results ?? []).map((raw) =>
      parseAccount(raw, accountHolder)
    );

    const consentExpiryDate = new Date();
    consentExpiryDate.setDate(
      consentExpiryDate.getDate() + CONSENT_VALIDITY_DAYS
    );

    return { accessToken, refreshToken, consentExpiryDate, accounts };
  }

  async listTransactions({
    accessToken,
    refreshToken,
    aggregatorAccountId,
    since,
    onTokensRefreshed
  }: {
    accessToken: string;
    refreshToken?: string;
    aggregatorAccountId: string;
    since?: Date;
    onTokensRefreshed?: (tokens: RefreshedTokens) => void;
  }): Promise<AggregatorTransaction[]> {
    const query = since
      ? `?${new URLSearchParams({ from: toDateOnly(since) }).toString()}`
      : '';

    const data = await this.requestWithRefresh<{
      results?: RawTransaction[];
    }>({
      url: `${this.apiBaseUrl}/data/v1/accounts/${aggregatorAccountId}/transactions${query}`,
      accessToken,
      refreshToken,
      onTokensRefreshed
    });

    return (data.results ?? []).map(parseTransaction);
  }

  async getBalance({
    accessToken,
    refreshToken,
    aggregatorAccountId,
    onTokensRefreshed
  }: {
    accessToken: string;
    refreshToken?: string;
    aggregatorAccountId: string;
    onTokensRefreshed?: (tokens: RefreshedTokens) => void;
  }): Promise<AggregatorBalance> {
    const data = await this.requestWithRefresh<{ results?: RawBalance[] }>({
      url: `${this.apiBaseUrl}/data/v1/accounts/${aggregatorAccountId}/balance`,
      accessToken,
      refreshToken,
      onTokensRefreshed
    });

    const raw = data.results?.[0];
    if (!raw) {
      throw new Error(
        `TrueLayer balance response for account "${aggregatorAccountId}" contained no results`
      );
    }
    return parseBalance(raw, aggregatorAccountId);
  }

  // Shared GET-with-refresh flow for listTransactions/getBalance: on a 401,
  // does one refresh-grant call, invokes onTokensRefreshed synchronously
  // with the new tokens, then retries the GET exactly once. A second 401 (or
  // a failure of the refresh call itself, e.g. invalid_grant) means the
  // refresh token is no longer valid rather than a transient issue, so it's
  // surfaced as ConsentDeniedError instead of retried again.
  private async requestWithRefresh<T>({
    url,
    accessToken,
    refreshToken,
    onTokensRefreshed
  }: {
    url: string;
    accessToken: string;
    refreshToken?: string;
    onTokensRefreshed?: (tokens: RefreshedTokens) => void;
  }): Promise<T> {
    try {
      const response = await this.httpClient.get<T>(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return response.data;
    } catch (error) {
      if (!isUnauthorized(error) || !refreshToken) {
        throw error;
      }
    }

    let refreshed: RefreshedTokens;
    try {
      refreshed = await this.refreshTokens(refreshToken);
    } catch {
      throw new ConsentDeniedError();
    }
    onTokensRefreshed?.(refreshed);

    try {
      const response = await this.httpClient.get<T>(url, {
        headers: { Authorization: `Bearer ${refreshed.accessToken}` }
      });
      return response.data;
    } catch (retryError) {
      if (isUnauthorized(retryError)) {
        throw new ConsentDeniedError();
      }
      throw retryError;
    }
  }

  private async refreshTokens(refreshToken: string): Promise<RefreshedTokens> {
    const refreshed = await this.exchangeToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });
    return {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? refreshToken
    };
  }

  private async exchangeToken(
    body: Record<string, string>
  ): Promise<RefreshedTokens> {
    try {
      const response = await this.httpClient.post<RawTokenResponse>(
        `${this.authBaseUrl}/connect/token`,
        new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          ...body
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      if (!response.data?.access_token) {
        throw new Error('TrueLayer token response is missing "access_token"');
      }
      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token
      };
    } catch (error) {
      const errorData = getErrorResponseData(error);
      if (errorData?.error === 'access_denied') {
        throw new ConsentDeniedError(errorData.error_description);
      }
      throw error;
    }
  }
}
