import {
  BankNotSupportedError,
  ConsentDeniedError
} from '../aggregator/adapter.js';
import MockAggregatorAdapter from '../aggregator/mockadapter.js';

describe('MockAggregatorAdapter', () => {
  let adapter: MockAggregatorAdapter;

  beforeEach(() => {
    adapter = new MockAggregatorAdapter();
  });

  describe('listSupportedBanks', () => {
    it('returns the mock bank catalogue as bankId/name pairs', async () => {
      const banks = await adapter.listSupportedBanks();

      expect(banks).toEqual(
        expect.arrayContaining([
          { bankId: 'DE_MOCKBANK', name: 'Mockbank AG' },
          { bankId: 'DE_TESTSPARKASSE', name: 'Testsparkasse' }
        ])
      );
    });
  });

  describe('initiateConnection', () => {
    it('returns a redirect url embedding a connection id for a supported bank', async () => {
      const result = await adapter.initiateConnection({
        bankId: 'DE_MOCKBANK',
        redirectUrl: 'https://landlord.example.com/callback'
      });

      expect(result.connectionId).toBeTruthy();
      expect(result.redirectUrl).toContain(result.connectionId);
    });

    it('redirects to a mock-sca page next to the given callback, carrying the return url', async () => {
      const result = await adapter.initiateConnection({
        bankId: 'DE_MOCKBANK',
        redirectUrl: 'https://landlord.example.com/acme/banking/callback'
      });

      const url = new URL(result.redirectUrl);
      expect(url.origin + url.pathname).toBe(
        'https://landlord.example.com/acme/banking/mock-sca'
      );
      expect(url.searchParams.get('connectionId')).toBe(result.connectionId);
      expect(url.searchParams.get('returnUrl')).toBe(
        'https://landlord.example.com/acme/banking/callback'
      );
    });

    it('returns a distinct connection id per call, even for the same bank', async () => {
      const first = await adapter.initiateConnection({
        bankId: 'DE_MOCKBANK',
        redirectUrl: 'https://landlord.example.com/callback-a'
      });
      const second = await adapter.initiateConnection({
        bankId: 'DE_MOCKBANK',
        redirectUrl: 'https://landlord.example.com/callback-b'
      });

      expect(first.connectionId).not.toBe(second.connectionId);
    });

    it('rejects a bank the aggregator does not support', async () => {
      await expect(
        adapter.initiateConnection({
          bankId: 'UNKNOWN_BANK',
          redirectUrl: 'https://landlord.example.com/callback'
        })
      ).rejects.toBeInstanceOf(BankNotSupportedError);
    });
  });

  describe('completeConnection', () => {
    it('returns an access token, a ~90 day consent expiry and the discovered accounts', async () => {
      const { connectionId } = await adapter.initiateConnection({
        bankId: 'DE_MOCKBANK',
        redirectUrl: 'https://landlord.example.com/callback'
      });

      const before = new Date();
      const result = await adapter.completeConnection({
        connectionId,
        authorizationCode: 'AUTH-OK'
      });

      expect(result.accessToken).toBeTruthy();
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0].iban).toBe('DE89370400440532013000');

      const daysUntilExpiry =
        (result.consentExpiryDate.getTime() - before.getTime()) /
        (1000 * 60 * 60 * 24);
      // consentExpiryDate is computed via `new Date()` inside the adapter after
      // `before` is captured, so real wall-clock time elapses between the two
      // calls - use a small tolerance instead of an exact <=90 bound.
      expect(daysUntilExpiry).toBeGreaterThan(89.9);
      expect(daysUntilExpiry).toBeLessThan(90.1);
    });

    it('rejects when the account holder denies the SCA/TAN step', async () => {
      const { connectionId } = await adapter.initiateConnection({
        bankId: 'DE_MOCKBANK',
        redirectUrl: 'https://landlord.example.com/callback'
      });

      await expect(
        adapter.completeConnection({
          connectionId,
          authorizationCode: 'DENY'
        })
      ).rejects.toBeInstanceOf(ConsentDeniedError);
    });

    it('rejects a connectionId that was never initiated', async () => {
      await expect(
        adapter.completeConnection({
          connectionId: 'not-a-real-connection',
          authorizationCode: 'AUTH-OK'
        })
      ).rejects.toBeInstanceOf(BankNotSupportedError);
    });

    it('rejects reusing a connectionId that was already completed (single-use, like a real SCA flow)', async () => {
      const { connectionId } = await adapter.initiateConnection({
        bankId: 'DE_MOCKBANK',
        redirectUrl: 'https://landlord.example.com/callback'
      });

      await adapter.completeConnection({
        connectionId,
        authorizationCode: 'AUTH-OK'
      });

      await expect(
        adapter.completeConnection({
          connectionId,
          authorizationCode: 'AUTH-OK'
        })
      ).rejects.toBeInstanceOf(BankNotSupportedError);
    });
  });

  describe('listTransactions', () => {
    it('returns an empty array by default', async () => {
      const transactions = await adapter.listTransactions({
        accessToken: 'token',
        aggregatorAccountId: 'acc-1'
      });
      expect(transactions).toEqual([]);
    });
  });

  describe('getBalance', () => {
    it('returns a deterministic balance for the given account', async () => {
      const balance = await adapter.getBalance({
        accessToken: 'token',
        aggregatorAccountId: 'acc-1'
      });

      expect(balance.aggregatorAccountId).toBe('acc-1');
      expect(balance.currency).toBe('EUR');
      expect(typeof balance.availableBalance).toBe('number');
      expect(typeof balance.currentBalance).toBe('number');
      expect(balance.availableBalance).toBeGreaterThanOrEqual(0);
      expect(balance.currentBalance).toBeGreaterThanOrEqual(0);
      expect(balance.asOfDate).toBeInstanceOf(Date);
    });
  });
});
