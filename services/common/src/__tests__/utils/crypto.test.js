import { jest } from '@jest/globals';

// crypto.ts only needs Service.getInstance().envConfig.getValues(); mocking the
// module (instead of importing the real Service singleton) keeps this a true
// unit test and avoids pulling in Service's unrelated transitive dependencies.
let currentEnvValues = {
  CIPHER_KEY: 'test-cipher-key',
  CIPHER_IV_KEY: 'test-cipher-iv-key'
};

jest.unstable_mockModule('../../utils/service.js', () => ({
  default: {
    getInstance: () => ({
      envConfig: { getValues: () => currentEnvValues }
    })
  }
}));

const Crypto = await import('../../utils/crypto.js');

describe('crypto', () => {
  afterEach(() => {
    currentEnvValues = {
      CIPHER_KEY: 'test-cipher-key',
      CIPHER_IV_KEY: 'test-cipher-iv-key'
    };
  });

  it('encrypts then decrypts back to the original text', () => {
    const plainText = 'super-secret-access-token';
    const encrypted = Crypto.encrypt(plainText);

    expect(encrypted).not.toEqual(plainText);
    expect(Crypto.decrypt(encrypted)).toEqual(plainText);
  });

  it('round-trips an empty string', () => {
    expect(Crypto.decrypt(Crypto.encrypt(''))).toEqual('');
  });

  it('round-trips Latin-1 characters such as German umlauts', () => {
    // NB: encrypt()/decrypt() currently use the 'binary' (Latin-1) encoding
    // internally, so characters outside U+0000-U+00FF (e.g. '€', '–') are not
    // round-trip safe yet - tracked separately, not part of this feature.
    const plainText = 'Bankverbindung Müller & Söhne: DE89370400440532013000';
    expect(Crypto.decrypt(Crypto.encrypt(plainText))).toEqual(plainText);
  });

  it('round-trips long values such as an XS2A refresh token', () => {
    const plainText = 'a'.repeat(2048);
    expect(Crypto.decrypt(Crypto.encrypt(plainText))).toEqual(plainText);
  });

  it('is deterministic for the same input (fixed IV derived from CIPHER_IV_KEY)', () => {
    const plainText = 'consistent-value';
    expect(Crypto.encrypt(plainText)).toEqual(Crypto.encrypt(plainText));
  });

  it('produces different ciphertext for different plaintexts', () => {
    expect(Crypto.encrypt('value-a')).not.toEqual(Crypto.encrypt('value-b'));
  });

  it('throws when CIPHER_KEY is not set', () => {
    currentEnvValues = {
      CIPHER_KEY: undefined,
      CIPHER_IV_KEY: 'test-cipher-iv-key'
    };

    expect(() => Crypto.encrypt('value')).toThrow('CIPHER_KEY is not set');
  });

  it('throws when CIPHER_IV_KEY is not set', () => {
    currentEnvValues = {
      CIPHER_KEY: 'test-cipher-key',
      CIPHER_IV_KEY: undefined
    };

    expect(() => Crypto.encrypt('value')).toThrow('CIPHER_IV_KEY is not set');
  });

  it('fails to decrypt data that was encrypted with a different CIPHER_KEY', () => {
    const encrypted = Crypto.encrypt('sensitive-value');

    currentEnvValues = {
      CIPHER_KEY: 'a-completely-different-key',
      CIPHER_IV_KEY: 'test-cipher-iv-key'
    };

    // AES-256-CBC PKCS7 padding validation fails for a wrong key on valid-length ciphertext
    expect(() => Crypto.decrypt(encrypted)).toThrow();
  });
});
