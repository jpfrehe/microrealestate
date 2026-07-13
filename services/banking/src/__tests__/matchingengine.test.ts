import {
  buildOpenRentClaims,
  determineMatchStatus,
  findMatchCandidates,
  OpenRentClaim
} from '../managers/matchingengine.js';

describe('findMatchCandidates', () => {
  const musterstrasseClaim: OpenRentClaim = {
    tenantId: 'tenant-1',
    tenantName: 'Musterstrasse 12 App 3B',
    term: 2026070100,
    openAmount: 950,
    searchTerms: ['Musterstrasse 12 App 3B', 'Musterstrasse 12']
  };
  const beispielwegClaim: OpenRentClaim = {
    tenantId: 'tenant-2',
    tenantName: 'Beispielweg 4',
    term: 2026070100,
    openAmount: 950,
    searchTerms: ['Beispielweg 4', 'Beispielweg']
  };

  it('finds a unique, exact match when amount and reference both match (standard case)', () => {
    const candidates = findMatchCandidates(
      {
        amount: 950,
        remittanceInformation: 'Miete Juli Musterstrasse 12 App 3B'
      },
      [musterstrasseClaim, beispielwegClaim]
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].tenantId).toBe('tenant-1');
    expect(candidates[0].confidence).toBe(1);
    expect(candidates[0].reason).toMatch(/exactly/);
  });

  it('is case-insensitive and ignores diacritics in the remittance text', () => {
    const candidates = findMatchCandidates(
      { amount: 950, remittanceInformation: 'MIETE JULI MÜLLER GMBH' },
      [
        {
          tenantId: 'tenant-3',
          tenantName: 'Müller GmbH',
          term: 2026070100,
          openAmount: 950,
          searchTerms: ['Müller GmbH']
        }
      ]
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].tenantId).toBe('tenant-3');
  });

  it('matches on a property name even if the tenant name itself is not mentioned', () => {
    const candidates = findMatchCandidates(
      { amount: 950, remittanceInformation: 'Dauerauftrag Musterstrasse 12' },
      [musterstrasseClaim, beispielwegClaim]
    );

    expect(candidates.map((c) => c.tenantId)).toEqual(['tenant-1']);
  });

  it('returns no candidates when the remittance text references nobody (unmatched)', () => {
    const candidates = findMatchCandidates(
      { amount: 950, remittanceInformation: 'Dauerauftrag 07/2026' },
      [musterstrasseClaim, beispielwegClaim]
    );

    expect(candidates).toEqual([]);
  });

  it('still returns a candidate for a partial payment, with reduced confidence', () => {
    const candidates = findMatchCandidates(
      { amount: 400, remittanceInformation: 'Teilzahlung Musterstrasse 12' },
      [musterstrasseClaim]
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].confidence).toBeLessThan(1);
    expect(candidates[0].confidence).toBeGreaterThan(0);
    expect(candidates[0].reason).toMatch(/only covers part/);
    // the claim's openAmount is reported as-is so the caller can compute the remaining balance
    expect(candidates[0].openAmount).toBe(950);
  });

  it('still returns a candidate for an overpayment, flagged as such', () => {
    const candidates = findMatchCandidates(
      { amount: 1200, remittanceInformation: 'Miete Musterstrasse 12' },
      [musterstrasseClaim]
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].reason).toMatch(/overpayment/);
    expect(candidates[0].confidence).toBeGreaterThan(0.5);
  });

  it('surfaces multiple candidates when the reference is ambiguous between tenants', () => {
    // both tenants happen to share part of their search terms with the remittance text
    const candidates = findMatchCandidates(
      {
        amount: 950,
        remittanceInformation: 'Miete Musterstrasse 12 und Beispielweg'
      },
      [musterstrasseClaim, beispielwegClaim]
    );

    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.tenantId).sort()).toEqual([
      'tenant-1',
      'tenant-2'
    ]);
  });

  it('sorts multiple candidates by descending confidence', () => {
    const candidates = findMatchCandidates(
      { amount: 950, remittanceInformation: 'Musterstrasse 12 Beispielweg' },
      [
        { ...beispielwegClaim, openAmount: 400 }, // amount mismatch -> lower confidence
        musterstrasseClaim // exact amount match -> higher confidence
      ]
    );

    expect(candidates[0].tenantId).toBe('tenant-1');
    expect(candidates[0].confidence).toBeGreaterThan(candidates[1].confidence);
  });

  it('treats a zero or negative transaction amount as not matchable on amount', () => {
    const candidates = findMatchCandidates(
      { amount: 0, remittanceInformation: 'Musterstrasse 12' },
      [musterstrasseClaim]
    );

    // still surfaced (text matches) but with confidence coming from text alone
    expect(candidates).toHaveLength(1);
    expect(candidates[0].confidence).toBe(0.5);
  });

  it('returns an empty array when there are no open claims at all', () => {
    expect(
      findMatchCandidates(
        { amount: 950, remittanceInformation: 'Miete Musterstrasse 12' },
        []
      )
    ).toEqual([]);
  });

  it('ignores an empty remittance information string entirely', () => {
    const candidates = findMatchCandidates(
      { amount: 950, remittanceInformation: '' },
      [musterstrasseClaim]
    );
    expect(candidates).toEqual([]);
  });

  describe('IBAN signal', () => {
    const claimWithKnownIban: OpenRentClaim = {
      ...musterstrasseClaim,
      knownPayerIbans: ['DE12 5001 0517 0648 4898 90']
    };

    it('surfaces a candidate purely from a known payer IBAN, even with unhelpful remittance text', () => {
      const candidates = findMatchCandidates(
        {
          amount: 950,
          remittanceInformation: 'Dauerauftrag 07/2026',
          counterpartyIban: 'DE12500105170648489890'
        },
        [claimWithKnownIban]
      );

      expect(candidates).toHaveLength(1);
      expect(candidates[0].tenantId).toBe('tenant-1');
      expect(candidates[0].reason).toMatch(/previously confirmed payment/);
    });

    it('is insensitive to IBAN whitespace/casing when comparing', () => {
      const candidates = findMatchCandidates(
        {
          amount: 950,
          remittanceInformation: 'Dauerauftrag 07/2026',
          counterpartyIban: 'de12 5001 0517 0648 4898 90'
        },
        [claimWithKnownIban]
      );

      expect(candidates).toHaveLength(1);
    });

    it('boosts confidence on top of text+amount when the IBAN also matches', () => {
      const withoutIban = findMatchCandidates(
        {
          amount: 950,
          remittanceInformation: 'Miete Juli Musterstrasse 12 App 3B'
        },
        [musterstrasseClaim]
      )[0];
      const withIban = findMatchCandidates(
        {
          amount: 950,
          remittanceInformation: 'Miete Juli Musterstrasse 12 App 3B',
          counterpartyIban: 'DE12500105170648489890'
        },
        [claimWithKnownIban]
      )[0];

      expect(withoutIban.confidence).toBe(1);
      // already at the 0-1 ceiling from text+amount alone - the bonus must be capped, not overflow
      expect(withIban.confidence).toBe(1);
    });

    it('does not surface a candidate for an IBAN that does not match any known payer', () => {
      const candidates = findMatchCandidates(
        {
          amount: 950,
          remittanceInformation: 'Dauerauftrag 07/2026',
          counterpartyIban: 'DE00000000000000000000'
        },
        [claimWithKnownIban]
      );

      expect(candidates).toEqual([]);
    });

    it('leaves confidence unchanged when no IBAN data is available at all (backward compatible)', () => {
      const candidates = findMatchCandidates(
        { amount: 400, remittanceInformation: 'Teilzahlung Musterstrasse 12' },
        [musterstrasseClaim]
      );

      // textScore 1 * 0.5 + amountScore 0.5 (partial payment) * 0.5, no IBAN bonus
      expect(candidates[0].confidence).toBe(0.75);
    });
  });
});

describe('determineMatchStatus', () => {
  it('is "unmatched" when there are no candidates', () => {
    expect(determineMatchStatus([])).toBe('unmatched');
  });

  it('is "suggested" when there is exactly one high-confidence candidate', () => {
    expect(
      determineMatchStatus([
        {
          tenantId: 'tenant-1',
          tenantName: 'Musterstrasse 12',
          term: 2026070100,
          openAmount: 950,
          confidence: 1,
          reason: 'exact match'
        }
      ])
    ).toBe('suggested');
  });

  it('is "suggested" (not auto-matched) even with several candidates - a human must confirm', () => {
    const candidate = {
      tenantId: 'tenant-1',
      tenantName: 'Musterstrasse 12',
      term: 2026070100,
      openAmount: 950,
      confidence: 0.75,
      reason: 'partial match'
    };
    expect(
      determineMatchStatus([candidate, { ...candidate, tenantId: 'tenant-2' }])
    ).toBe('suggested');
  });
});

describe('buildOpenRentClaims', () => {
  it('produces one claim per unpaid or partially paid rent term', () => {
    const claims = buildOpenRentClaims([
      {
        _id: 'tenant-1',
        name: 'Musterstrasse 12 App 3B',
        properties: [{ property: { name: 'Musterstrasse 12' } }],
        rents: [
          { term: 2026060100, total: { grandTotal: 950, payment: 950 } }, // fully paid -> excluded
          { term: 2026070100, total: { grandTotal: 950, payment: 0 } } // unpaid -> included
        ]
      }
    ]);

    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      tenantId: 'tenant-1',
      term: 2026070100,
      openAmount: 950
    });
    expect(claims[0].searchTerms).toEqual(
      expect.arrayContaining(['Musterstrasse 12 App 3B', 'Musterstrasse 12'])
    );
  });

  it('computes the open amount as grandTotal minus payment', () => {
    const claims = buildOpenRentClaims([
      {
        _id: 'tenant-1',
        name: 'Tenant A',
        rents: [{ term: 2026070100, total: { grandTotal: 950, payment: 400 } }]
      }
    ]);

    expect(claims[0].openAmount).toBe(550);
  });

  it('rounds the open amount to 2 decimal places to avoid floating point artifacts', () => {
    const claims = buildOpenRentClaims([
      {
        _id: 'tenant-1',
        name: 'Tenant A',
        rents: [
          { term: 2026070100, total: { grandTotal: 100.1, payment: 33.33 } }
        ]
      }
    ]);

    expect(claims[0].openAmount).toBe(66.77);
  });

  it('produces no claims for a tenant with only fully paid rents', () => {
    const claims = buildOpenRentClaims([
      {
        _id: 'tenant-1',
        name: 'Tenant A',
        rents: [{ term: 2026070100, total: { grandTotal: 950, payment: 950 } }]
      }
    ]);

    expect(claims).toEqual([]);
  });

  it('handles a tenant with no properties assigned', () => {
    const claims = buildOpenRentClaims([
      {
        _id: 'tenant-1',
        name: 'Tenant A',
        rents: [{ term: 2026070100, total: { grandTotal: 950, payment: 0 } }]
      }
    ]);

    expect(claims[0].searchTerms).toEqual(['Tenant A']);
  });

  it('returns an empty array for an empty tenant list', () => {
    expect(buildOpenRentClaims([])).toEqual([]);
  });

  it('aggregates claims across multiple tenants', () => {
    const claims = buildOpenRentClaims([
      {
        _id: 'tenant-1',
        name: 'Tenant A',
        rents: [{ term: 2026070100, total: { grandTotal: 500, payment: 0 } }]
      },
      {
        _id: 'tenant-2',
        name: 'Tenant B',
        rents: [{ term: 2026070100, total: { grandTotal: 700, payment: 0 } }]
      }
    ]);

    expect(claims.map((c) => c.tenantId)).toEqual(['tenant-1', 'tenant-2']);
  });

  it('attaches known payer IBANs per tenant when provided', () => {
    const claims = buildOpenRentClaims(
      [
        {
          _id: 'tenant-1',
          name: 'Tenant A',
          rents: [{ term: 2026070100, total: { grandTotal: 500, payment: 0 } }]
        },
        {
          _id: 'tenant-2',
          name: 'Tenant B',
          rents: [{ term: 2026070100, total: { grandTotal: 700, payment: 0 } }]
        }
      ],
      { 'tenant-1': ['DE12500105170648489890'] }
    );

    expect(
      claims.find((c) => c.tenantId === 'tenant-1')?.knownPayerIbans
    ).toEqual(['DE12500105170648489890']);
    expect(
      claims.find((c) => c.tenantId === 'tenant-2')?.knownPayerIbans
    ).toEqual([]);
  });

  it('defaults every claim to no known payer IBANs when the map is omitted', () => {
    const claims = buildOpenRentClaims([
      {
        _id: 'tenant-1',
        name: 'Tenant A',
        rents: [{ term: 2026070100, total: { grandTotal: 500, payment: 0 } }]
      }
    ]);

    expect(claims[0].knownPayerIbans).toEqual([]);
  });
});
