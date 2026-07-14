import {
  isConsentExpired,
  needsConsentReminder,
  nextStatusAfterSyncAttempt,
  parseConnectionToken,
  serializeConnectionToken,
  stripSecrets,
  toBankAccountRecords,
  toTransactionRecords
} from '../managers/bankaccountlogic.js';

describe('toBankAccountRecords', () => {
  const connectionResult = {
    accessToken: 'raw-access-token',
    consentExpiryDate: new Date('2026-10-10T00:00:00Z')
  };
  const now = new Date('2026-07-12T00:00:00Z');
  const encrypt = (text: string) => `ENCRYPTED(${text})`;

  it('maps a single selected account into a persistable, encrypted record', () => {
    const records = toBankAccountRecords(
      'realm-1',
      'mock',
      connectionResult,
      [
        {
          aggregatorAccountId: 'acc-1',
          iban: 'DE89370400440532013000',
          bankName: 'Mockbank AG',
          accountHolder: 'Demo Landlord',
          propertyIds: ['prop-1', 'prop-2']
        }
      ],
      encrypt,
      now
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      realmId: 'realm-1',
      propertyIds: ['prop-1', 'prop-2'],
      aggregatorProvider: 'mock',
      aggregatorAccountId: 'acc-1',
      iban: 'DE89370400440532013000',
      status: 'connected',
      consentGivenDate: now,
      consentExpiryDate: connectionResult.consentExpiryDate
    });
    // the raw token must never be persisted, only the encrypted form
    expect(records[0].encryptedAccessToken).toBe('ENCRYPTED(raw-access-token)');
    // no refresh token was present on the connection result (e.g. the mock
    // adapter), so nothing should be persisted for it either
    expect(records[0].encryptedRefreshToken).toBeUndefined();
  });

  it('encrypts and persists the refresh token when the connection result carries one (e.g. TrueLayer)', () => {
    const records = toBankAccountRecords(
      'realm-1',
      'truelayer',
      { ...connectionResult, refreshToken: 'raw-refresh-token' },
      [
        {
          aggregatorAccountId: 'acc-1',
          iban: 'DE89370400440532013000',
          bankName: 'Mockbank AG',
          accountHolder: 'Demo Landlord',
          propertyIds: ['prop-1']
        }
      ],
      encrypt,
      now
    );

    expect(records[0].encryptedAccessToken).toBe('ENCRYPTED(raw-access-token)');
    expect(records[0].encryptedRefreshToken).toBe(
      'ENCRYPTED(raw-refresh-token)'
    );
  });

  it('maps several selected accounts from the same connection', () => {
    const records = toBankAccountRecords(
      'realm-1',
      'mock',
      connectionResult,
      [
        {
          aggregatorAccountId: 'acc-1',
          iban: 'DE89370400440532013000',
          bankName: 'Mockbank AG',
          accountHolder: 'Demo Landlord',
          propertyIds: []
        },
        {
          aggregatorAccountId: 'acc-2',
          iban: 'DE02120300000000202051',
          bankName: 'Testsparkasse',
          accountHolder: 'Demo Landlord',
          propertyIds: ['prop-3']
        }
      ],
      encrypt,
      now
    );

    expect(records).toHaveLength(2);
    expect(records.map((r) => r.aggregatorAccountId)).toEqual([
      'acc-1',
      'acc-2'
    ]);
  });

  it('defaults propertyIds to an empty array when none were assigned (whole-realm account)', () => {
    const records = toBankAccountRecords(
      'realm-1',
      'mock',
      connectionResult,
      [
        {
          aggregatorAccountId: 'acc-1',
          iban: 'DE89370400440532013000',
          bankName: 'Mockbank AG',
          accountHolder: 'Demo Landlord',
          propertyIds: undefined as unknown as string[]
        }
      ],
      encrypt,
      now
    );

    expect(records[0].propertyIds).toEqual([]);
  });

  it('throws when no account was selected', () => {
    expect(() =>
      toBankAccountRecords(
        'realm-1',
        'mock',
        connectionResult,
        [],
        encrypt,
        now
      )
    ).toThrow('at least one account must be selected');
  });
});

describe('isConsentExpired', () => {
  it('is false while the consent is still valid', () => {
    expect(
      isConsentExpired(
        new Date('2026-10-10T00:00:00Z'),
        new Date('2026-07-12T00:00:00Z')
      )
    ).toBe(false);
  });

  it('is true once the consent expiry date is in the past', () => {
    expect(
      isConsentExpired(
        new Date('2026-01-01T00:00:00Z'),
        new Date('2026-07-12T00:00:00Z')
      )
    ).toBe(true);
  });

  it('is true exactly at the expiry instant (boundary)', () => {
    const expiry = new Date('2026-07-12T00:00:00Z');
    expect(isConsentExpired(expiry, expiry)).toBe(true);
  });
});

describe('nextStatusAfterSyncAttempt', () => {
  const validExpiry = new Date('2026-10-10T00:00:00Z');
  const expiredExpiry = new Date('2026-01-01T00:00:00Z');
  const now = new Date('2026-07-12T00:00:00Z');

  it('keeps a connected account connected while the consent is valid', () => {
    expect(nextStatusAfterSyncAttempt('connected', validExpiry, now)).toBe(
      'connected'
    );
  });

  it('flips a connected account to reauth_required once the consent expired', () => {
    expect(nextStatusAfterSyncAttempt('connected', expiredExpiry, now)).toBe(
      'reauth_required'
    );
  });

  it('keeps reauth_required as reauth_required while still expired', () => {
    expect(
      nextStatusAfterSyncAttempt('reauth_required', expiredExpiry, now)
    ).toBe('reauth_required');
  });

  it('recovers reauth_required back to connected after a fresh consent was granted', () => {
    // e.g. the landlord re-authorized and the stored consentExpiryDate was updated
    expect(
      nextStatusAfterSyncAttempt('reauth_required', validExpiry, now)
    ).toBe('connected');
  });

  it('never overrides a landlord-initiated disconnected status', () => {
    expect(nextStatusAfterSyncAttempt('disconnected', expiredExpiry, now)).toBe(
      'disconnected'
    );
  });

  it('leaves a pending account untouched (no consent to expire yet)', () => {
    expect(nextStatusAfterSyncAttempt('pending', expiredExpiry, now)).toBe(
      'pending'
    );
  });
});

describe('toTransactionRecords', () => {
  it('maps aggregator transactions into unmatched, persistable records', () => {
    const records = toTransactionRecords('realm-1', 'bank-account-1', [
      {
        aggregatorTransactionId: 'tx-1',
        amount: 950,
        currency: 'EUR',
        valueDate: new Date('2026-07-01T00:00:00Z'),
        bookingDate: new Date('2026-07-02T00:00:00Z'),
        counterpartyName: 'Max Mustermann',
        counterpartyIban: 'DE12500105170648489890',
        remittanceInformation: 'Miete Juli Musterstrasse 12 App 3B'
      }
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      realmId: 'realm-1',
      bankAccountId: 'bank-account-1',
      aggregatorTransactionId: 'tx-1',
      amount: 950,
      matchStatus: 'unmatched',
      matchCandidates: []
    });
  });

  it('maps an empty aggregator transaction list to an empty array', () => {
    expect(toTransactionRecords('realm-1', 'bank-account-1', [])).toEqual([]);
  });

  it('tolerates missing optional counterparty fields', () => {
    const records = toTransactionRecords('realm-1', 'bank-account-1', [
      {
        aggregatorTransactionId: 'tx-2',
        amount: -45.5,
        currency: 'EUR',
        valueDate: new Date('2026-07-05T00:00:00Z'),
        bookingDate: new Date('2026-07-05T00:00:00Z'),
        remittanceInformation: 'Gebuehr'
      }
    ]);

    expect(records[0].counterpartyName).toBeUndefined();
    expect(records[0].counterpartyIban).toBeUndefined();
    expect(records[0].amount).toBe(-45.5);
  });
});

describe('stripSecrets', () => {
  const bankAccount = {
    _id: 'bank-account-1',
    realmId: 'realm-1',
    propertyIds: [],
    aggregatorProvider: 'mock',
    aggregatorAccountId: 'acc-1',
    iban: 'DE89370400440532013000',
    bankName: 'Mockbank AG',
    accountHolder: 'Demo Landlord',
    encryptedAccessToken: 'super-secret-encrypted-token',
    encryptedRefreshToken: 'super-secret-encrypted-refresh-token',
    consentGivenDate: new Date('2026-07-12T00:00:00Z'),
    consentExpiryDate: new Date('2026-10-10T00:00:00Z'),
    status: 'connected' as const,
    createdDate: new Date('2026-07-12T00:00:00Z'),
    updatedDate: new Date('2026-07-12T00:00:00Z')
  };

  it('removes the encrypted access token from the returned object', () => {
    const stripped = stripSecrets(bankAccount);

    expect(stripped).not.toHaveProperty('encryptedAccessToken');
    expect(Object.keys(stripped)).not.toContain('encryptedAccessToken');
  });

  it('removes the encrypted refresh token from the returned object when present', () => {
    const stripped = stripSecrets(bankAccount);

    expect(stripped).not.toHaveProperty('encryptedRefreshToken');
    expect(Object.keys(stripped)).not.toContain('encryptedRefreshToken');
  });

  it('keeps every other field untouched', () => {
    const stripped = stripSecrets(bankAccount);

    expect(stripped).toMatchObject({
      _id: 'bank-account-1',
      realmId: 'realm-1',
      iban: 'DE89370400440532013000',
      bankName: 'Mockbank AG',
      status: 'connected'
    });
  });

  it('does not mutate the original object', () => {
    stripSecrets(bankAccount);
    expect(bankAccount.encryptedAccessToken).toBe(
      'super-secret-encrypted-token'
    );
  });
});

describe('serializeConnectionToken / parseConnectionToken', () => {
  // a fake, reversible "encryption" so the round trip can be checked without
  // needing the real Service/CIPHER_KEY setup - the functions under test
  // don't care which encrypt/decrypt implementation they're given
  const encrypt = (text: string) => Buffer.from(text).toString('base64url');
  const decrypt = (text: string) => Buffer.from(text, 'base64url').toString();

  it('round-trips the connection payload through encrypt/decrypt', () => {
    const payload = {
      provider: 'mock',
      accessToken: 'raw-access-token',
      consentExpiryDate: new Date('2026-10-10T00:00:00Z')
    };

    const token = serializeConnectionToken(payload, encrypt);
    expect(token).not.toContain('raw-access-token');

    const parsed = parseConnectionToken(token, decrypt);
    expect(parsed).toEqual(payload);
  });

  it('round-trips a connection payload that includes a refresh token (e.g. TrueLayer)', () => {
    const payload = {
      provider: 'truelayer',
      accessToken: 'raw-access-token',
      refreshToken: 'raw-refresh-token',
      consentExpiryDate: new Date('2026-10-10T00:00:00Z')
    };

    const token = serializeConnectionToken(payload, encrypt);
    expect(token).not.toContain('raw-access-token');
    expect(token).not.toContain('raw-refresh-token');

    const parsed = parseConnectionToken(token, decrypt);
    expect(parsed).toEqual(payload);
  });

  it('throws when the token was encrypted with a different key (tampered/expired)', () => {
    const token = serializeConnectionToken(
      { provider: 'mock', accessToken: 'x', consentExpiryDate: new Date() },
      encrypt
    );
    const wrongDecrypt = () => {
      throw new Error('bad decrypt');
    };

    expect(() => parseConnectionToken(token, wrongDecrypt)).toThrow();
  });

  it('throws on a token that is not valid JSON once decrypted', () => {
    expect(() =>
      parseConnectionToken('not-a-real-token', (text) => text)
    ).toThrow();
  });
});

describe('needsConsentReminder', () => {
  const now = new Date('2026-07-12T00:00:00Z');

  it('is false for a connected account whose consent is not close to expiry', () => {
    expect(
      needsConsentReminder(
        {
          status: 'connected',
          consentExpiryDate: new Date('2026-10-10T00:00:00Z')
        },
        now
      )
    ).toBe(false);
  });

  it('is true for a connected account whose consent expires within the reminder window', () => {
    expect(
      needsConsentReminder(
        {
          status: 'connected',
          consentExpiryDate: new Date('2026-07-15T00:00:00Z')
        },
        now
      )
    ).toBe(true);
  });

  it('respects a custom reminder window', () => {
    const consentExpiryDate = new Date('2026-07-20T00:00:00Z'); // 8 days out
    expect(
      needsConsentReminder({ status: 'connected', consentExpiryDate }, now, 7)
    ).toBe(false);
    expect(
      needsConsentReminder({ status: 'connected', consentExpiryDate }, now, 10)
    ).toBe(true);
  });

  it('is true once the account already flipped to reauth_required', () => {
    expect(
      needsConsentReminder(
        {
          status: 'reauth_required',
          consentExpiryDate: new Date('2026-01-01T00:00:00Z')
        },
        now
      )
    ).toBe(true);
  });

  it('is false once a reminder was already sent, even if still expiring/expired', () => {
    expect(
      needsConsentReminder(
        {
          status: 'reauth_required',
          consentExpiryDate: new Date('2026-01-01T00:00:00Z'),
          reauthReminderSentDate: new Date('2026-07-01T00:00:00Z')
        },
        now
      )
    ).toBe(false);
  });

  it('is false for pending/disconnected accounts', () => {
    expect(
      needsConsentReminder(
        {
          status: 'pending',
          consentExpiryDate: new Date('2026-07-13T00:00:00Z')
        },
        now
      )
    ).toBe(false);
    expect(
      needsConsentReminder(
        {
          status: 'disconnected',
          consentExpiryDate: new Date('2026-07-13T00:00:00Z')
        },
        now
      )
    ).toBe(false);
  });
});
