import TrueLayerAdapter, {
  TrueLayerHttpClient
} from '../aggregator/truelayeradapter.js';
import { ConsentDeniedError } from '../aggregator/adapter.js';
import { jest } from '@jest/globals';

type FakeGet = (
  url: string,
  config?: Record<string, unknown>
) => Promise<{ data: unknown }>;
type FakePost = (
  url: string,
  body?: unknown,
  config?: Record<string, unknown>
) => Promise<{ data: unknown }>;

type FakeHttpClient = {
  get: jest.Mock<FakeGet>;
  post: jest.Mock<FakePost>;
};

// Fake matching the { get, post } subset of axios TrueLayerAdapter depends
// on, injected instead of hitting the network - see truelayeradapter.ts's
// TrueLayerHttpClient type and bankaccountlogic.ts's encrypt/decrypt DI
// convention.
function createHttpClient(): FakeHttpClient {
  return {
    get: jest.fn<FakeGet>(),
    post: jest.fn<FakePost>()
  };
}

function createAdapter(httpClient: FakeHttpClient): TrueLayerAdapter {
  return new TrueLayerAdapter({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    environment: 'sandbox',
    httpClient: httpClient as unknown as TrueLayerHttpClient
  });
}

describe('TrueLayerAdapter', () => {
  describe('listSupportedBanks', () => {
    it('maps the providers response to bankId/name pairs', async () => {
      const httpClient = createHttpClient();
      httpClient.get.mockResolvedValueOnce({
        data: {
          results: [
            { provider_id: 'ob-mockbank', display_name: 'Mock Bank' },
            { provider_id: 'ob-testbank', display_name: 'Test Bank' }
          ]
        }
      });
      const adapter = createAdapter(httpClient);

      const banks = await adapter.listSupportedBanks();

      expect(banks).toEqual([
        { bankId: 'ob-mockbank', name: 'Mock Bank' },
        { bankId: 'ob-testbank', name: 'Test Bank' }
      ]);
      expect(httpClient.get).toHaveBeenCalledWith(
        expect.stringContaining(
          'https://auth.truelayer-sandbox.com/api/providers?clientId=client-id'
        )
      );
    });
  });

  describe('completeConnection', () => {
    async function initiate(httpClient: ReturnType<typeof createHttpClient>) {
      const adapter = createAdapter(httpClient);
      const { connectionId } = await adapter.initiateConnection({
        bankId: 'ob-mockbank',
        redirectUrl: 'https://landlord.example.com/callback'
      });
      return { adapter, connectionId };
    }

    it('exchanges the code, fetches accounts + identity and maps a ConnectionResult', async () => {
      const httpClient = createHttpClient();
      const { adapter, connectionId } = await initiate(httpClient);

      httpClient.post.mockResolvedValueOnce({
        data: {
          access_token: 'access-token-1',
          refresh_token: 'refresh-token-1'
        }
      });
      httpClient.get.mockImplementation((url: string) => {
        if (url.endsWith('/data/v1/accounts')) {
          return Promise.resolve({
            data: {
              results: [
                {
                  account_id: 'acc-1',
                  account_number: { iban: 'GB29NWBK60161331926819' },
                  currency: 'GBP',
                  provider: { display_name: 'Mock Bank' }
                }
              ]
            }
          });
        }
        if (url.endsWith('/data/v1/info')) {
          return Promise.resolve({
            data: { results: [{ full_name: 'Jane Landlord' }] }
          });
        }
        throw new Error(`unexpected GET ${url}`);
      });

      const before = new Date();
      const result = await adapter.completeConnection({
        connectionId,
        authorizationCode: 'AUTH-CODE'
      });

      expect(result.accessToken).toBe('access-token-1');
      expect(result.refreshToken).toBe('refresh-token-1');
      expect(result.accounts).toEqual([
        {
          aggregatorAccountId: 'acc-1',
          iban: 'GB29NWBK60161331926819',
          bankName: 'Mock Bank',
          accountHolder: 'Jane Landlord',
          currency: 'GBP'
        }
      ]);

      const daysUntilExpiry =
        (result.consentExpiryDate.getTime() - before.getTime()) /
        (1000 * 60 * 60 * 24);
      expect(daysUntilExpiry).toBeGreaterThan(89);
      expect(daysUntilExpiry).toBeLessThanOrEqual(90);

      // token exchange must reuse the exact redirect_uri passed to
      // initiateConnection, recovered from the opaque connectionId
      const [, body] = httpClient.post.mock.calls[0];
      const params = new URLSearchParams(body as string);
      expect(params.get('grant_type')).toBe('authorization_code');
      expect(params.get('code')).toBe('AUTH-CODE');
      expect(params.get('redirect_uri')).toBe(
        'https://landlord.example.com/callback'
      );
    });

    it('maps an access_denied token error to ConsentDeniedError', async () => {
      const httpClient = createHttpClient();
      const { adapter, connectionId } = await initiate(httpClient);

      httpClient.post.mockRejectedValueOnce({
        response: {
          status: 400,
          data: {
            error: 'access_denied',
            error_description: 'user denied consent'
          }
        }
      });

      await expect(
        adapter.completeConnection({
          connectionId,
          authorizationCode: 'AUTH-CODE'
        })
      ).rejects.toBeInstanceOf(ConsentDeniedError);
    });
  });

  describe('listTransactions', () => {
    it('maps transactions and derives the amount sign from transaction_type', async () => {
      const httpClient = createHttpClient();
      httpClient.get.mockResolvedValueOnce({
        data: {
          results: [
            {
              transaction_id: 'txn-1',
              timestamp: '2026-01-15T10:00:00Z',
              description: 'Rent payment',
              amount: 950,
              currency: 'GBP',
              transaction_type: 'CREDIT',
              meta: {
                provider_counter_party_name: 'John Tenant',
                provider_counter_party_iban: 'GB00TENANT00000000000000'
              }
            },
            {
              transaction_id: 'txn-2',
              timestamp: '2026-01-16T10:00:00Z',
              description: 'Bank fee',
              amount: 5,
              currency: 'GBP',
              transaction_type: 'DEBIT'
            }
          ]
        }
      });
      const adapter = createAdapter(httpClient);

      const transactions = await adapter.listTransactions({
        accessToken: 'access-token',
        aggregatorAccountId: 'acc-1',
        since: new Date('2026-01-01T00:00:00Z')
      });

      expect(transactions).toEqual([
        {
          aggregatorTransactionId: 'txn-1',
          amount: 950,
          currency: 'GBP',
          valueDate: new Date('2026-01-15T10:00:00Z'),
          bookingDate: new Date('2026-01-15T10:00:00Z'),
          counterpartyName: 'John Tenant',
          counterpartyIban: 'GB00TENANT00000000000000',
          remittanceInformation: 'Rent payment'
        },
        {
          aggregatorTransactionId: 'txn-2',
          amount: -5,
          currency: 'GBP',
          valueDate: new Date('2026-01-16T10:00:00Z'),
          bookingDate: new Date('2026-01-16T10:00:00Z'),
          counterpartyName: undefined,
          counterpartyIban: undefined,
          remittanceInformation: 'Bank fee'
        }
      ]);

      const [url] = httpClient.get.mock.calls[0];
      expect(url).toContain('/data/v1/accounts/acc-1/transactions?');
      expect(url).toContain('from=2026-01-01');
    });

    it('throws on a transaction fixture missing a required field', async () => {
      const httpClient = createHttpClient();
      httpClient.get.mockResolvedValueOnce({
        data: {
          results: [
            {
              // transaction_id intentionally omitted
              timestamp: '2026-01-15T10:00:00Z',
              amount: 950,
              currency: 'GBP',
              transaction_type: 'CREDIT'
            }
          ]
        }
      });
      const adapter = createAdapter(httpClient);

      await expect(
        adapter.listTransactions({
          accessToken: 'access-token',
          aggregatorAccountId: 'acc-1'
        })
      ).rejects.toThrow(/transaction_id/);
    });
  });

  describe('getBalance', () => {
    it('maps the balance response', async () => {
      const httpClient = createHttpClient();
      httpClient.get.mockResolvedValueOnce({
        data: {
          results: [
            {
              currency: 'GBP',
              available: 1234.56,
              current: 1200.0,
              update_timestamp: '2026-01-20T08:00:00Z'
            }
          ]
        }
      });
      const adapter = createAdapter(httpClient);

      const balance = await adapter.getBalance({
        accessToken: 'access-token',
        aggregatorAccountId: 'acc-1'
      });

      expect(balance).toEqual({
        aggregatorAccountId: 'acc-1',
        currency: 'GBP',
        availableBalance: 1234.56,
        currentBalance: 1200.0,
        asOfDate: new Date('2026-01-20T08:00:00Z')
      });
    });

    it('throws when the balance fixture is missing a required field', async () => {
      const httpClient = createHttpClient();
      httpClient.get.mockResolvedValueOnce({
        data: {
          results: [
            {
              // currency intentionally omitted
              available: 1234.56,
              current: 1200.0,
              update_timestamp: '2026-01-20T08:00:00Z'
            }
          ]
        }
      });
      const adapter = createAdapter(httpClient);

      await expect(
        adapter.getBalance({
          accessToken: 'access-token',
          aggregatorAccountId: 'acc-1'
        })
      ).rejects.toThrow(/currency/);
    });
  });

  describe('401 -> refresh -> retry-once flow', () => {
    it('refreshes the access token once and retries the request, notifying onTokensRefreshed', async () => {
      const httpClient = createHttpClient();
      httpClient.get
        .mockRejectedValueOnce({ response: { status: 401 } })
        .mockResolvedValueOnce({
          data: {
            results: [
              {
                currency: 'GBP',
                available: 100,
                current: 100,
                update_timestamp: '2026-01-20T08:00:00Z'
              }
            ]
          }
        });
      httpClient.post.mockResolvedValueOnce({
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token'
        }
      });
      const adapter = createAdapter(httpClient);
      const onTokensRefreshed = jest.fn();

      const balance = await adapter.getBalance({
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token',
        aggregatorAccountId: 'acc-1',
        onTokensRefreshed
      });

      expect(balance.availableBalance).toBe(100);
      expect(httpClient.post).toHaveBeenCalledTimes(1);
      expect(httpClient.get).toHaveBeenCalledTimes(2);
      expect(onTokensRefreshed).toHaveBeenCalledWith({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token'
      });

      const authorizationHeader = (config?: Record<string, unknown>) =>
        (config?.headers as { Authorization?: string } | undefined)
          ?.Authorization;

      expect(authorizationHeader(httpClient.get.mock.calls[0][1])).toBe(
        'Bearer expired-access-token'
      );
      expect(authorizationHeader(httpClient.get.mock.calls[1][1])).toBe(
        'Bearer new-access-token'
      );
    });

    it('throws ConsentDeniedError when the retried request also 401s', async () => {
      const httpClient = createHttpClient();
      httpClient.get
        .mockRejectedValueOnce({ response: { status: 401 } })
        .mockRejectedValueOnce({ response: { status: 401 } });
      httpClient.post.mockResolvedValueOnce({
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token'
        }
      });
      const adapter = createAdapter(httpClient);

      await expect(
        adapter.getBalance({
          accessToken: 'expired-access-token',
          refreshToken: 'refresh-token',
          aggregatorAccountId: 'acc-1'
        })
      ).rejects.toBeInstanceOf(ConsentDeniedError);

      expect(httpClient.post).toHaveBeenCalledTimes(1);
      expect(httpClient.get).toHaveBeenCalledTimes(2);
    });

    it('throws ConsentDeniedError when the refresh call itself fails', async () => {
      const httpClient = createHttpClient();
      httpClient.get.mockRejectedValueOnce({ response: { status: 401 } });
      httpClient.post.mockRejectedValueOnce({
        response: { status: 400, data: { error: 'invalid_grant' } }
      });
      const adapter = createAdapter(httpClient);

      await expect(
        adapter.getBalance({
          accessToken: 'expired-access-token',
          refreshToken: 'stale-refresh-token',
          aggregatorAccountId: 'acc-1'
        })
      ).rejects.toBeInstanceOf(ConsentDeniedError);

      expect(httpClient.post).toHaveBeenCalledTimes(1);
      expect(httpClient.get).toHaveBeenCalledTimes(1);
    });

    it('does not attempt a refresh when no refreshToken is available', async () => {
      const httpClient = createHttpClient();
      httpClient.get.mockRejectedValueOnce({ response: { status: 401 } });
      const adapter = createAdapter(httpClient);

      await expect(
        adapter.getBalance({
          accessToken: 'expired-access-token',
          aggregatorAccountId: 'acc-1'
        })
      ).rejects.toEqual({ response: { status: 401 } });

      expect(httpClient.post).not.toHaveBeenCalled();
      expect(httpClient.get).toHaveBeenCalledTimes(1);
    });
  });
});
