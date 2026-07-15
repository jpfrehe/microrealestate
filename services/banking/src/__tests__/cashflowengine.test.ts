import {
  buildAmortizationSchedule,
  buildSankeyGraph,
  CashflowAnalysisInput,
  CashflowSummary,
  categorizeTransaction,
  computeCashflowAnalysis,
  computeDepreciationForMonth,
  DepreciationInput,
  getLoanRateForMonth,
  LoanInput,
  TransactionInput
} from '../managers/cashflowengine.js';

// A plain annuity loan on the Musterstrasse property: 100.000 EUR at 3.6 % p.a.
// (= 0.3 % per month, which keeps the hand-computed expectations exact) with a
// 800 EUR monthly rate.
const sparkasseLoan = (overrides: Partial<LoanInput> = {}): LoanInput => ({
  _id: 'loan-1',
  propertyId: 'p1',
  name: 'Annuitätendarlehen Musterstr. 12',
  lender: 'Sparkasse Musterstadt',
  lenderIban: 'DE89 3704 0044 0532 0130 00',
  principalAmount: 100000,
  interestRate: 3.6,
  monthlyRate: 800,
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  status: 'active',
  ...overrides
});

const buildingDepreciation = (
  overrides: Partial<DepreciationInput> = {}
): DepreciationInput => ({
  _id: 'dep-1',
  propertyId: 'p1',
  name: 'AfA Gebäude',
  baseAmount: 480000,
  rate: 2.5,
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  durationYears: 40,
  ...overrides
});

const bankTransaction = (
  overrides: Partial<TransactionInput> = {}
): TransactionInput => ({
  _id: 't1',
  bankAccountId: 'acct-1',
  amount: -150,
  currency: 'EUR',
  valueDate: new Date('2026-07-03T00:00:00.000Z'),
  bookingDate: new Date('2026-07-03T00:00:00.000Z'),
  counterpartyName: '',
  counterpartyIban: '',
  remittanceInformation: '',
  matchStatus: 'unmatched',
  ...overrides
});

const summaryOf = (
  overrides: Partial<CashflowSummary> = {}
): CashflowSummary => ({
  totalIncome: 0,
  totalExpenses: 0,
  operatingCashflow: 0,
  depreciation: 0,
  interestExpense: 0,
  principalRepayment: 0,
  taxableResult: 0,
  deposits: 0,
  uncategorizedCount: 0,
  uncategorizedTotal: 0,
  hasForeignCurrency: false,
  ...overrides
});

const analysisInput = (
  overrides: Partial<CashflowAnalysisInput> = {}
): CashflowAnalysisInput => ({
  month: '2026-07',
  currency: 'EUR',
  properties: [
    { _id: 'p1', name: 'Musterstr. 12' },
    { _id: 'p2', name: 'Beispielweg 4' }
  ],
  bankAccounts: [{ _id: 'acct-1', propertyIds: ['p1'] }],
  transactions: [],
  loans: [],
  depreciations: [],
  ...overrides
});

type SankeyGraph = ReturnType<typeof buildSankeyGraph>;

function nodeIndex(graph: SankeyGraph, key: string): number {
  return graph.nodes.findIndex((node) => node.key === key);
}

function linkValue(
  graph: SankeyGraph,
  fromKey: string,
  toKey: string
): number | undefined {
  const source = nodeIndex(graph, fromKey);
  const target = nodeIndex(graph, toKey);
  return graph.links.find(
    (link) => link.source === source && link.target === target
  )?.value;
}

function sumLinksInto(graph: SankeyGraph, key: string): number {
  const target = nodeIndex(graph, key);
  return graph.links
    .filter((link) => link.target === target)
    .reduce((sum, link) => sum + link.value, 0);
}

function sumLinksOutOf(graph: SankeyGraph, key: string): number {
  const source = nodeIndex(graph, key);
  return graph.links
    .filter((link) => link.source === source)
    .reduce((sum, link) => sum + link.value, 0);
}

describe('buildAmortizationSchedule', () => {
  it('splits every rate into interest on the remaining debt and principal (BR-7, BR-8)', () => {
    const schedule = buildAmortizationSchedule(sparkasseLoan(), '2026-02');

    expect(schedule).toHaveLength(2);
    expect(schedule[0]).toMatchObject({
      month: '2026-01',
      interest: 300, // 100.000 * 3.6 / 100 / 12
      principal: 500,
      total: 800,
      remainingDebt: 99500
    });
    // second month's interest is computed on the *reduced* debt - booking a
    // constant interest portion would overstate the deductible expense
    expect(schedule[1]).toMatchObject({
      month: '2026-02',
      interest: 298.5,
      principal: 501.5,
      total: 800,
      remainingDebt: 98998.5
    });
  });

  it('starts the schedule in the month the loan was paid out, not in the requested month', () => {
    const schedule = buildAmortizationSchedule(
      sparkasseLoan({ startDate: new Date('2026-05-01T00:00:00.000Z') }),
      '2026-07'
    );

    expect(schedule.map((entry) => entry.month)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07'
    ]);
  });

  it('caps the final rate at the remaining debt, so the loan is never overpaid (BR-8a)', () => {
    // 1.000 EUR at 12 % p.a. (= 1 % per month), 600 EUR rate -> paid off in 2 rates
    const schedule = buildAmortizationSchedule(
      sparkasseLoan({
        principalAmount: 1000,
        interestRate: 12,
        monthlyRate: 600
      }),
      '2026-06'
    );

    expect(schedule).toHaveLength(2);
    expect(schedule[1].principal).toBeCloseTo(410, 2); // not the full 595.90
    expect(schedule[1].interest).toBeCloseTo(4.1, 2);
    expect(schedule[1].total).toBeCloseTo(414.1, 2); // below the 600 annuity
    expect(schedule[1].remainingDebt).toBe(0);
  });

  it('treats an interest-free loan as pure principal repayment (BR-8b)', () => {
    const schedule = buildAmortizationSchedule(
      sparkasseLoan({
        principalAmount: 1200,
        interestRate: 0,
        monthlyRate: 300
      }),
      '2026-12'
    );

    expect(schedule).toHaveLength(4);
    expect(schedule.every((entry) => entry.interest === 0)).toBe(true);
    expect(schedule[0].principal).toBe(300);
    expect(schedule[3].remainingDebt).toBe(0);
  });

  it('never amortizes when the rate does not even cover the interest (BR-8c)', () => {
    // 100.000 EUR at 12 % p.a. -> 1.000 EUR interest per month, but only 800 EUR is debited
    const schedule = buildAmortizationSchedule(
      sparkasseLoan({
        principalAmount: 100000,
        interestRate: 12,
        monthlyRate: 800
      }),
      '2026-03'
    );

    expect(schedule).toHaveLength(3);
    expect(schedule.every((entry) => entry.principal === 0)).toBe(true);
    expect(schedule.every((entry) => entry.remainingDebt === 100000)).toBe(
      true
    );
  });

  it('stops at the requested month even when the loan runs on much longer', () => {
    const schedule = buildAmortizationSchedule(sparkasseLoan(), '2026-12');

    expect(schedule).toHaveLength(12);
    expect(schedule[11].month).toBe('2026-12');
    expect(schedule[11].remainingDebt).toBeGreaterThan(0);
  });

  it('returns an empty schedule for a loan that has not started yet (BR-8d)', () => {
    expect(
      buildAmortizationSchedule(
        sparkasseLoan({ startDate: new Date('2027-01-01T00:00:00.000Z') }),
        '2026-12'
      )
    ).toEqual([]);
  });

  it('stops the schedule at the agreed end date (BR-8d)', () => {
    const schedule = buildAmortizationSchedule(
      sparkasseLoan({ endDate: new Date('2026-03-31T00:00:00.000Z') }),
      '2026-12'
    );

    expect(schedule.map((entry) => entry.month)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03'
    ]);
  });

  it('rounds every money amount to 2 decimals (BR-8)', () => {
    const schedule = buildAmortizationSchedule(
      sparkasseLoan({ principalAmount: 123456.78, interestRate: 3.4 }),
      '2026-01'
    );

    // 123456.78 * 3.4 / 100 / 12 = 349.79421
    expect(schedule[0].interest).toBe(349.79);
    expect(schedule[0].principal).toBe(450.21);
    expect(schedule[0].remainingDebt).toBe(123006.57);
  });
});

describe('getLoanRateForMonth', () => {
  it('returns the interest/principal split of that month, not just the debited amount (BR-7)', () => {
    expect(getLoanRateForMonth(sparkasseLoan(), '2026-01')).toMatchObject({
      interest: 300,
      principal: 500,
      total: 800,
      neverAmortizes: false
    });
  });

  it('reflects the shrinking interest portion of a later month (BR-8)', () => {
    const january = getLoanRateForMonth(sparkasseLoan(), '2026-01');
    const december = getLoanRateForMonth(sparkasseLoan(), '2026-12');

    expect(december!.interest).toBeLessThan(january!.interest);
    expect(december!.principal).toBeGreaterThan(january!.principal);
    expect(december!.total).toBeCloseTo(800, 2);
  });

  it('returns the reduced final rate for the payoff month (BR-8a)', () => {
    const rate = getLoanRateForMonth(
      sparkasseLoan({
        principalAmount: 1000,
        interestRate: 12,
        monthlyRate: 600
      }),
      '2026-02'
    );

    expect(rate!.principal).toBeCloseTo(410, 2);
    expect(rate!.total).toBeCloseTo(414.1, 2);
  });

  it('returns null once the loan is paid off (BR-8a)', () => {
    expect(
      getLoanRateForMonth(
        sparkasseLoan({
          principalAmount: 1000,
          interestRate: 12,
          monthlyRate: 600
        }),
        '2026-03'
      )
    ).toBeNull();
  });

  it('flags a loan whose rate is swallowed by the interest, so the UI can warn (BR-8c)', () => {
    const rate = getLoanRateForMonth(
      sparkasseLoan({ interestRate: 12, monthlyRate: 800 }),
      '2026-01'
    );

    expect(rate).toMatchObject({
      // the whole debit is interest expense - nothing reduces the debt
      interest: 800,
      principal: 0,
      total: 800,
      neverAmortizes: true
    });
  });

  it('flags the boundary case where the rate exactly equals the interest (BR-8c)', () => {
    // 100.000 EUR at 12 % p.a. -> interest is exactly the 1.000 EUR rate
    const rate = getLoanRateForMonth(
      sparkasseLoan({ interestRate: 12, monthlyRate: 1000 }),
      '2026-01'
    );

    expect(rate!.principal).toBe(0);
    expect(rate!.neverAmortizes).toBe(true);
  });

  it('returns null for a month before the loan was paid out (BR-8d)', () => {
    expect(
      getLoanRateForMonth(
        sparkasseLoan({ startDate: new Date('2026-06-20T00:00:00.000Z') }),
        '2026-05'
      )
    ).toBeNull();
  });

  it('charges a full rate in the payout month regardless of the day of month (BR-8d)', () => {
    expect(
      getLoanRateForMonth(
        sparkasseLoan({ startDate: new Date('2026-06-20T00:00:00.000Z') }),
        '2026-06'
      )
    ).toMatchObject({ total: 800 });
  });

  it('returns null for a month after the loan ended (BR-8d)', () => {
    expect(
      getLoanRateForMonth(
        sparkasseLoan({ endDate: new Date('2026-04-30T00:00:00.000Z') }),
        '2026-05'
      )
    ).toBeNull();
  });

  it('still charges the rate in the month the loan ends (BR-8d)', () => {
    expect(
      getLoanRateForMonth(
        sparkasseLoan({ endDate: new Date('2026-05-15T00:00:00.000Z') }),
        '2026-05'
      )
    ).toMatchObject({ total: 800 });
  });

  it('keeps several loans on the same property independent of each other (BR-7)', () => {
    const first = getLoanRateForMonth(sparkasseLoan(), '2026-02');
    const second = getLoanRateForMonth(
      sparkasseLoan({
        _id: 'loan-2',
        name: 'KfW-Darlehen Musterstr. 12',
        principalAmount: 50000,
        interestRate: 3.6,
        monthlyRate: 400,
        startDate: new Date('2026-02-01T00:00:00.000Z')
      }),
      '2026-02'
    );

    expect(first).toMatchObject({ interest: 298.5, principal: 501.5 });
    expect(second).toMatchObject({ interest: 150, principal: 250 });
  });
});

describe('computeDepreciationForMonth', () => {
  it('is one twelfth of the yearly rate on the building share (BR-21)', () => {
    // 480.000 * 2.5 / 100 / 12
    expect(computeDepreciationForMonth(buildingDepreciation(), '2026-07')).toBe(
      1000
    );
  });

  it('rounds the monthly amount to 2 decimals (BR-21)', () => {
    // 400.000 * 2 / 100 / 12 = 666.6666...
    expect(
      computeDepreciationForMonth(
        buildingDepreciation({
          baseAmount: 400000,
          rate: 2,
          durationYears: 50
        }),
        '2026-07'
      )
    ).toBe(666.67);
  });

  it('is zero before the depreciation starts (BR-21)', () => {
    expect(
      computeDepreciationForMonth(
        buildingDepreciation({
          startDate: new Date('2026-03-15T00:00:00.000Z')
        }),
        '2026-02'
      )
    ).toBe(0);
  });

  it('counts the start month in full, regardless of the day of month (BR-21)', () => {
    expect(
      computeDepreciationForMonth(
        buildingDepreciation({
          startDate: new Date('2026-03-15T00:00:00.000Z')
        }),
        '2026-03'
      )
    ).toBe(1000);
  });

  it('still depreciates in the last month of the useful life (BR-21)', () => {
    // 50 years from 2020-01 -> 600 monthly amounts, the last one in 2069-12
    expect(
      computeDepreciationForMonth(
        buildingDepreciation({
          baseAmount: 480000,
          rate: 2,
          startDate: new Date('2020-01-01T00:00:00.000Z'),
          durationYears: 50
        }),
        '2069-12'
      )
    ).toBe(800);
  });

  it('is zero once the useful life has elapsed (BR-21)', () => {
    expect(
      computeDepreciationForMonth(
        buildingDepreciation({
          baseAmount: 480000,
          rate: 2,
          startDate: new Date('2020-01-01T00:00:00.000Z'),
          durationYears: 50
        }),
        '2070-01'
      )
    ).toBe(0);
  });

  it('depreciates exactly durationYears * 12 months for a short useful life (BR-21)', () => {
    const dep = buildingDepreciation({
      baseAmount: 12000,
      rate: 10,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      durationYears: 1
    });

    expect(computeDepreciationForMonth(dep, '2026-01')).toBe(100);
    expect(computeDepreciationForMonth(dep, '2026-12')).toBe(100);
    expect(computeDepreciationForMonth(dep, '2027-01')).toBe(0);
  });
});

describe('categorizeTransaction', () => {
  const loans = [sparkasseLoan()];

  describe('priority order (BR-13)', () => {
    it('lets a manual override win over every automatic signal', () => {
      const result = categorizeTransaction(
        bankTransaction({
          amount: 950,
          remittanceInformation: 'Miete Juli Musterstr. 12',
          matchStatus: 'matched',
          matchedTenantId: 'tenant-1',
          category: 'other_income',
          categorySource: 'manual'
        }),
        { loans }
      );

      expect(result).toMatchObject({
        category: 'other_income',
        group: 'income',
        source: 'manual',
        confidence: 1
      });
    });

    it('lets a confirmed tenant match win over a keyword rule (BR-2)', () => {
      // the landlord confirmed this as rent - the word "Kaution" in the
      // reference must not override a human decision
      const result = categorizeTransaction(
        bankTransaction({
          amount: 950,
          remittanceInformation: 'Miete und Kaution Musterstr. 12',
          matchStatus: 'matched',
          matchedTenantId: 'tenant-1'
        }),
        { loans }
      );

      expect(result).toMatchObject({
        category: 'rent',
        group: 'income',
        source: 'match',
        confidence: 1
      });
      expect(result.reason).toBeTruthy();
    });

    it('lets a loan hit win over a keyword rule (BR-7)', () => {
      const result = categorizeTransaction(
        bankTransaction({
          amount: -800,
          counterpartyName: 'Sparkasse Musterstadt',
          counterpartyIban: 'DE89370400440532013000',
          remittanceInformation: 'Rate inkl. Gebäudeversicherung Musterstr. 12'
        }),
        { loans }
      );

      expect(result).toMatchObject({
        category: 'loan_rate',
        group: 'expense',
        source: 'loan',
        loanId: 'loan-1'
      });
    });

    it('falls back to a keyword rule when there is no match and no loan', () => {
      const result = categorizeTransaction(
        bankTransaction({
          amount: -150,
          counterpartyName: 'Stadtwerke Musterstadt',
          remittanceInformation: 'Abschlag Strom 07/2026'
        }),
        { loans }
      );

      expect(result).toMatchObject({
        category: 'utilities',
        group: 'expense',
        source: 'rule',
        confidence: 0.6
      });
    });

    it('does not guess when no signal applies at all (BR-12)', () => {
      const result = categorizeTransaction(
        bankTransaction({
          amount: -75,
          counterpartyName: 'M. Mustermann',
          remittanceInformation: 'Dauerauftrag 07/2026'
        }),
        { loans }
      );

      expect(result).toMatchObject({
        category: 'uncategorized',
        source: 'none',
        confidence: 0
      });
    });
  });

  describe('loan detection (BR-7, BR-13)', () => {
    it('identifies a loan rate by the lender IBAN with full confidence', () => {
      const result = categorizeTransaction(
        bankTransaction({
          amount: -800,
          counterpartyIban: 'DE89370400440532013000',
          remittanceInformation: 'Dauerauftrag 07/2026'
        }),
        { loans }
      );

      expect(result).toMatchObject({
        category: 'loan_rate',
        source: 'loan',
        loanId: 'loan-1',
        confidence: 1
      });
    });

    it('compares the lender IBAN ignoring whitespace and casing', () => {
      const result = categorizeTransaction(
        bankTransaction({
          amount: -800,
          counterpartyIban: 'de89 3704 0044 0532 0130 00',
          remittanceInformation: 'Dauerauftrag 07/2026'
        }),
        { loans }
      );

      expect(result.category).toBe('loan_rate');
    });

    it('identifies a loan rate by the loan name in the reference, with lower confidence', () => {
      const result = categorizeTransaction(
        bankTransaction({
          amount: -800,
          remittanceInformation: 'Annuitätendarlehen Musterstr. 12 Rate 07/2026'
        }),
        { loans }
      );

      expect(result).toMatchObject({
        category: 'loan_rate',
        source: 'loan',
        loanId: 'loan-1',
        confidence: 0.9
      });
    });

    it('identifies a loan rate by the lender name in the reference', () => {
      const result = categorizeTransaction(
        bankTransaction({
          amount: -800,
          remittanceInformation: 'Sparkasse Musterstadt Darlehen 07/2026'
        }),
        { loans }
      );

      expect(result).toMatchObject({ category: 'loan_rate', source: 'loan' });
    });

    it('tolerates a small deviation from the agreed rate (±1 %)', () => {
      const result = categorizeTransaction(
        bankTransaction({
          amount: -795,
          remittanceInformation: 'Sparkasse Musterstadt Rate 07/2026'
        }),
        { loans }
      );

      expect(result.category).toBe('loan_rate');
    });

    it('does not accept an amount outside the rate tolerance', () => {
      // a 2.500 EUR special repayment to the same lender is not the monthly rate
      const result = categorizeTransaction(
        bankTransaction({
          amount: -2500,
          counterpartyIban: 'DE89370400440532013000',
          remittanceInformation: 'Sondertilgung Musterstr. 12'
        }),
        { loans }
      );

      expect(result.category).toBe('uncategorized');
    });

    it('uses an absolute floor of 1,00 EUR for the tolerance on small rates', () => {
      const smallLoan = [sparkasseLoan({ monthlyRate: 50 })];

      // 1 % of 50 EUR would be 0.50 EUR - too tight for a real debit
      expect(
        categorizeTransaction(
          bankTransaction({
            amount: -50.8,
            remittanceInformation: 'Sparkasse Musterstadt Rate 07/2026'
          }),
          { loans: smallLoan }
        ).category
      ).toBe('loan_rate');
      expect(
        categorizeTransaction(
          bankTransaction({
            amount: -51.5,
            remittanceInformation: 'Sparkasse Musterstadt Rate 07/2026'
          }),
          { loans: smallLoan }
        ).category
      ).toBe('uncategorized');
    });

    it('picks the loan whose IBAN matches when a property carries several loans', () => {
      const result = categorizeTransaction(
        bankTransaction({
          amount: -400,
          counterpartyIban: 'DE02120300000000202051',
          remittanceInformation: 'Dauerauftrag 07/2026'
        }),
        {
          loans: [
            sparkasseLoan(),
            sparkasseLoan({
              _id: 'loan-2',
              name: 'KfW-Darlehen Musterstr. 12',
              lender: 'KfW',
              lenderIban: 'DE02120300000000202051',
              monthlyRate: 400
            })
          ]
        }
      );

      expect(result.loanId).toBe('loan-2');
    });

    it('does not look for loans when the realm has none', () => {
      const result = categorizeTransaction(
        bankTransaction({
          amount: -800,
          counterpartyIban: 'DE89370400440532013000',
          remittanceInformation: 'Dauerauftrag 07/2026'
        }),
        { loans: [] }
      );

      expect(result.category).toBe('uncategorized');
    });
  });

  describe('keyword rules (BR-9, BR-10, BR-11)', () => {
    it.each([
      ['Abschlag Strom 07/2026', 'utilities'],
      ['Stadtwerke Musterstadt Wasser', 'utilities'],
      ['Heizung Abrechnung 2026', 'utilities'],
      ['Hausverwaltung Musterstr. 12 07/2026', 'property_management'],
      ['Hausgeld 07/2026', 'property_management'],
      ['Gebäudeversicherung Musterstr. 12', 'insurance'],
      ['Haftpflicht Beitrag 2026', 'insurance'],
      ['Grundsteuer Q3 2026 Musterstr. 12', 'property_tax'],
      ['Instandhaltung Dach Musterstr. 12', 'maintenance'],
      ['Handwerker Rechnung 4711', 'maintenance'],
      ['Mietkaution Musterstr. 12 App 3B', 'deposit']
    ])('categorizes "%s" as %s', (remittanceInformation, category) => {
      const result = categorizeTransaction(
        bankTransaction({ amount: -150, remittanceInformation }),
        { loans: [] }
      );

      expect(result.category).toBe(category);
      expect(result.source).toBe('rule');
    });

    it('normalizes diacritics before matching keywords', () => {
      const result = categorizeTransaction(
        bankTransaction({
          amount: -45,
          remittanceInformation: 'Müllabfuhr Gebühr 07/2026'
        }),
        { loans: [] }
      );

      expect(result.category).toBe('utilities');
    });

    it('is case-insensitive', () => {
      const result = categorizeTransaction(
        bankTransaction({
          amount: -320,
          remittanceInformation: 'GRUNDSTEUER Q3/2026'
        }),
        { loans: [] }
      );

      expect(result.category).toBe('property_tax');
    });

    it('also considers the counterparty name, not just the reference', () => {
      const result = categorizeTransaction(
        bankTransaction({
          amount: -240,
          counterpartyName: 'Hausverwaltung Meier GmbH',
          remittanceInformation: 'Rechnung 0815'
        }),
        { loans: [] }
      );

      expect(result.category).toBe('property_management');
    });

    it('ignores an empty reference and counterparty entirely (BR-12)', () => {
      const result = categorizeTransaction(
        bankTransaction({
          amount: -240,
          counterpartyName: '',
          remittanceInformation: ''
        }),
        { loans: [] }
      );

      expect(result.category).toBe('uncategorized');
    });
  });

  describe('group follows the sign (BR-13a)', () => {
    it('assigns an expense category to the income group when money comes in', () => {
      // an insurance refund keeps its category, but it is a cash *inflow*
      const result = categorizeTransaction(
        bankTransaction({
          amount: 250,
          remittanceInformation: 'Rückerstattung Gebäudeversicherung 2025'
        }),
        { loans: [] }
      );

      expect(result).toMatchObject({ category: 'insurance', group: 'income' });
    });

    it('assigns the same category to the expense group when money goes out', () => {
      const result = categorizeTransaction(
        bankTransaction({
          amount: -250,
          remittanceInformation: 'Gebäudeversicherung 2026'
        }),
        { loans: [] }
      );

      expect(result).toMatchObject({ category: 'insurance', group: 'expense' });
    });

    it('assigns an uncategorized outflow to the expense group', () => {
      const result = categorizeTransaction(
        bankTransaction({ amount: -75, remittanceInformation: 'Überweisung' }),
        { loans: [] }
      );

      expect(result).toMatchObject({
        category: 'uncategorized',
        group: 'expense'
      });
    });
  });
});

describe('computeCashflowAnalysis', () => {
  const rentTransaction = bankTransaction({
    _id: 't-rent',
    amount: 1250,
    valueDate: new Date('2026-07-03T00:00:00.000Z'),
    bookingDate: new Date('2026-07-03T00:00:00.000Z'),
    counterpartyName: 'Max Mustermann',
    counterpartyIban: 'DE12500105170648489890',
    remittanceInformation: 'Miete Juli Musterstr. 12',
    matchStatus: 'matched',
    matchedTenantId: 'tenant-1'
  });
  const loanTransaction = bankTransaction({
    _id: 't-loan',
    amount: -800,
    valueDate: new Date('2026-07-01T00:00:00.000Z'),
    bookingDate: new Date('2026-07-01T00:00:00.000Z'),
    counterpartyName: 'Sparkasse Musterstadt',
    counterpartyIban: 'DE89370400440532013000',
    remittanceInformation: 'Darlehensrate 07/2026'
  });
  const utilitiesTransaction = bankTransaction({
    _id: 't-utilities',
    amount: -150,
    valueDate: new Date('2026-07-15T00:00:00.000Z'),
    bookingDate: new Date('2026-07-15T00:00:00.000Z'),
    counterpartyName: 'Stadtwerke Musterstadt',
    remittanceInformation: 'Abschlag Strom 07/2026'
  });
  // the loan is paid out in the analysed month, so its first rate splits into
  // exactly 300 EUR interest and 500 EUR principal
  const julyLoan = sparkasseLoan({
    startDate: new Date('2026-07-01T00:00:00.000Z')
  });
  const standardInput = analysisInput({
    transactions: [rentTransaction, loanTransaction, utilitiesTransaction],
    loans: [julyLoan],
    depreciations: [buildingDepreciation()]
  });

  it('reports the month, the currency and the whole portfolio by default', () => {
    const analysis = computeCashflowAnalysis(standardInput);

    expect(analysis.month).toBe('2026-07');
    expect(analysis.currency).toBe('EUR');
    expect(analysis.property).toBeNull();
    expect(analysis.hasBankAccount).toBe(true);
  });

  it('distinguishes the operating cashflow from the taxable result (BR-1)', () => {
    const { summary } = computeCashflowAnalysis(standardInput);

    expect(summary).toMatchObject({
      totalIncome: 1250,
      totalExpenses: 950, // 800 loan rate + 150 utilities
      // what really hit the account: principal repayment is an outflow, the
      // non-cash depreciation is not
      operatingCashflow: 300,
      depreciation: 1000,
      interestExpense: 300,
      principalRepayment: 500,
      // 1250 - (950 - 500) - 1000: principal is no expense, depreciation is
      taxableResult: -200
    });
  });

  it('splits the loan rate transaction into its interest and principal portion (BR-7)', () => {
    const analysis = computeCashflowAnalysis(standardInput);
    const loan = analysis.transactions.find((tx) => tx._id === 't-loan');

    expect(loan).toMatchObject({
      category: 'loan_rate',
      categoryGroup: 'expense',
      categorySource: 'loan',
      loanId: 'loan-1',
      interestPortion: 300,
      principalPortion: 500
    });
  });

  it('leaves the interest/principal portions empty on non-loan transactions (BR-7)', () => {
    const analysis = computeCashflowAnalysis(standardInput);
    const rent = analysis.transactions.find((tx) => tx._id === 't-rent');

    expect(rent).toMatchObject({
      category: 'rent',
      categoryGroup: 'income',
      categorySource: 'match',
      categoryConfidence: 1,
      interestPortion: null,
      principalPortion: null,
      loanId: null
    });
  });

  it('resolves the property of a transaction through its bank account (BR-18)', () => {
    const analysis = computeCashflowAnalysis(standardInput);

    expect(analysis.transactions[0]).toMatchObject({
      propertyId: 'p1',
      propertyName: 'Musterstr. 12'
    });
  });

  it('nets the amounts per category and counts the transactions (BR-16)', () => {
    const analysis = computeCashflowAnalysis(
      analysisInput({
        transactions: [
          rentTransaction,
          bankTransaction({
            ...rentTransaction,
            _id: 't-rent-2',
            amount: 50,
            remittanceInformation: 'Nachzahlung Miete Juli Musterstr. 12'
          })
        ]
      })
    );

    expect(analysis.categories).toContainEqual({
      category: 'rent',
      group: 'income',
      total: 1300,
      count: 2
    });
    expect(analysis.summary.totalIncome).toBe(1300);
  });

  it('reports expense category totals as positive amounts, the sign lives in the group (BR-16)', () => {
    const analysis = computeCashflowAnalysis(standardInput);

    expect(analysis.categories).toContainEqual({
      category: 'utilities',
      group: 'expense',
      total: 150,
      count: 1
    });
  });

  it('surfaces the depreciation as its own non-cash category (BR-6)', () => {
    const analysis = computeCashflowAnalysis(standardInput);

    expect(
      analysis.categories.find((c) => c.category === 'depreciation')
    ).toMatchObject({ group: 'noncash', total: 1000 });
  });

  it('sums up several depreciation series of the same property (BR-6)', () => {
    const analysis = computeCashflowAnalysis(
      analysisInput({
        depreciations: [
          buildingDepreciation(),
          buildingDepreciation({
            _id: 'dep-2',
            name: 'AfA Einbauküche',
            baseAmount: 12000,
            rate: 10,
            durationYears: 10
          })
        ]
      })
    );

    expect(analysis.summary.depreciation).toBe(1100);
  });

  it('rounds every money amount of the summary to 2 decimals', () => {
    const analysis = computeCashflowAnalysis(
      analysisInput({
        transactions: [rentTransaction],
        // 400.000 * 2 / 100 / 12 = 666.6666...
        depreciations: [
          buildingDepreciation({
            baseAmount: 400000,
            rate: 2,
            durationYears: 50
          })
        ]
      })
    );

    expect(analysis.summary.depreciation).toBe(666.67);
    expect(analysis.summary.taxableResult).toBe(583.33);
  });

  describe('deposits (BR-4)', () => {
    const depositTransaction = bankTransaction({
      _id: 't-deposit',
      amount: 1900,
      valueDate: new Date('2026-07-02T00:00:00.000Z'),
      bookingDate: new Date('2026-07-02T00:00:00.000Z'),
      counterpartyName: 'Max Mustermann',
      remittanceInformation: 'Mietkaution Musterstr. 12 App 3B'
    });

    it('keeps the deposit out of the income, the cashflow and the taxable result', () => {
      const withDeposit = computeCashflowAnalysis({
        ...standardInput,
        transactions: [...standardInput.transactions, depositTransaction]
      });
      const withoutDeposit = computeCashflowAnalysis(standardInput);

      // a deposit is held in trust - booking it as income would be a real
      // accounting error, not just a display detail
      expect(withDeposit.summary.totalIncome).toBe(
        withoutDeposit.summary.totalIncome
      );
      expect(withDeposit.summary.operatingCashflow).toBe(
        withoutDeposit.summary.operatingCashflow
      );
      expect(withDeposit.summary.taxableResult).toBe(
        withoutDeposit.summary.taxableResult
      );
    });

    it('reports the deposit separately in the summary', () => {
      const analysis = computeCashflowAnalysis({
        ...standardInput,
        transactions: [...standardInput.transactions, depositTransaction]
      });

      expect(analysis.summary.deposits).toBe(1900);
      expect(analysis.transactions.map((tx) => tx._id)).toContain('t-deposit');
    });
  });

  describe('uncategorized transactions (BR-12)', () => {
    const unclearTransaction = bankTransaction({
      _id: 't-unclear',
      amount: -75,
      valueDate: new Date('2026-07-20T00:00:00.000Z'),
      bookingDate: new Date('2026-07-20T00:00:00.000Z'),
      counterpartyName: 'M. Mustermann',
      remittanceInformation: 'Dauerauftrag 07/2026'
    });

    it('counts and totals what could not be categorized instead of guessing', () => {
      const analysis = computeCashflowAnalysis(
        analysisInput({ transactions: [rentTransaction, unclearTransaction] })
      );

      expect(analysis.summary.uncategorizedCount).toBe(1);
      expect(analysis.summary.uncategorizedTotal).toBe(75);
    });

    it('still lets an unclear outflow reduce the operating cashflow', () => {
      const analysis = computeCashflowAnalysis(
        analysisInput({ transactions: [rentTransaction, unclearTransaction] })
      );

      expect(analysis.summary.totalExpenses).toBe(75);
      expect(analysis.summary.operatingCashflow).toBe(1175);
    });
  });

  describe('ignored transactions (BR-13a)', () => {
    it('excludes an ignored transaction from the analysis completely', () => {
      const analysis = computeCashflowAnalysis({
        ...standardInput,
        transactions: [
          ...standardInput.transactions,
          bankTransaction({
            _id: 't-ignored',
            amount: -5000,
            valueDate: new Date('2026-07-10T00:00:00.000Z'),
            bookingDate: new Date('2026-07-10T00:00:00.000Z'),
            remittanceInformation: 'Privatentnahme',
            matchStatus: 'ignored'
          })
        ]
      });

      expect(analysis.transactions.map((tx) => tx._id)).not.toContain(
        't-ignored'
      );
      expect(analysis.summary.totalExpenses).toBe(950);
      expect(analysis.summary.uncategorizedCount).toBe(0);
    });
  });

  describe('month assignment (BR-15)', () => {
    it('assigns a transaction by its value date, when the money actually moved', () => {
      const analysis = computeCashflowAnalysis(
        analysisInput({
          transactions: [
            bankTransaction({
              ...rentTransaction,
              // booked on the last day of July, credited in August
              bookingDate: new Date('2026-07-31T00:00:00.000Z'),
              valueDate: new Date('2026-08-01T00:00:00.000Z')
            })
          ]
        })
      );

      expect(analysis.transactions).toEqual([]);
      expect(analysis.summary.totalIncome).toBe(0);
    });

    it('falls back to the booking date when the bank sends no value date', () => {
      const analysis = computeCashflowAnalysis(
        analysisInput({
          transactions: [
            bankTransaction({
              ...rentTransaction,
              valueDate: undefined,
              bookingDate: new Date('2026-07-31T00:00:00.000Z')
            })
          ]
        })
      );

      expect(analysis.transactions).toHaveLength(1);
      expect(analysis.summary.totalIncome).toBe(1250);
    });

    it('includes the first and the last moment of the month (inclusive bounds, UTC)', () => {
      const analysis = computeCashflowAnalysis(
        analysisInput({
          transactions: [
            bankTransaction({
              ...rentTransaction,
              _id: 't-first',
              valueDate: new Date('2026-07-01T00:00:00.000Z')
            }),
            bankTransaction({
              ...rentTransaction,
              _id: 't-last',
              valueDate: new Date('2026-07-31T23:59:59.999Z')
            })
          ]
        })
      );

      expect(analysis.transactions.map((tx) => tx._id)).toEqual([
        't-first',
        't-last'
      ]);
    });

    it('excludes the last moment of the previous month', () => {
      const analysis = computeCashflowAnalysis(
        analysisInput({
          transactions: [
            bankTransaction({
              ...rentTransaction,
              valueDate: new Date('2026-06-30T23:59:59.999Z')
            })
          ]
        })
      );

      expect(analysis.transactions).toEqual([]);
    });
  });

  describe('property filter (BR-18)', () => {
    const beispielwegTransaction = bankTransaction({
      _id: 't-beispielweg',
      bankAccountId: 'acct-2',
      amount: 700,
      valueDate: new Date('2026-07-05T00:00:00.000Z'),
      bookingDate: new Date('2026-07-05T00:00:00.000Z'),
      remittanceInformation: 'Miete Juli Beispielweg 4',
      matchStatus: 'matched',
      matchedTenantId: 'tenant-2'
    });
    const realmWideTransaction = bankTransaction({
      _id: 't-realm',
      bankAccountId: 'acct-3',
      amount: -300,
      valueDate: new Date('2026-07-06T00:00:00.000Z'),
      bookingDate: new Date('2026-07-06T00:00:00.000Z'),
      remittanceInformation: 'Gebäudeversicherung Portfolio 2026'
    });
    const multiPropertyInput = analysisInput({
      bankAccounts: [
        { _id: 'acct-1', propertyIds: ['p1'] },
        { _id: 'acct-2', propertyIds: ['p2'] },
        { _id: 'acct-3', propertyIds: [] } // realm-wide account
      ],
      transactions: [
        rentTransaction,
        beispielwegTransaction,
        realmWideTransaction
      ],
      loans: [julyLoan],
      depreciations: [buildingDepreciation()]
    });

    it('covers every account of the realm when no property is selected', () => {
      const analysis = computeCashflowAnalysis(multiPropertyInput);

      expect(analysis.transactions.map((tx) => tx._id)).toEqual([
        't-rent',
        't-beispielweg',
        't-realm'
      ]);
      expect(analysis.summary.totalIncome).toBe(1950);
    });

    it('keeps only the accounts of the selected property', () => {
      const analysis = computeCashflowAnalysis({
        ...multiPropertyInput,
        propertyId: 'p1'
      });

      expect(analysis.transactions.map((tx) => tx._id)).toEqual(['t-rent']);
      expect(analysis.property).toEqual({ _id: 'p1', name: 'Musterstr. 12' });
    });

    it('leaves out realm-wide accounts when a property is selected, they are not attributable', () => {
      const analysis = computeCashflowAnalysis({
        ...multiPropertyInput,
        propertyId: 'p1'
      });

      expect(analysis.transactions.map((tx) => tx._id)).not.toContain(
        't-realm'
      );
    });

    it('keeps only the loans and depreciations of the selected property', () => {
      const analysis = computeCashflowAnalysis({
        ...multiPropertyInput,
        propertyId: 'p2',
        loans: [julyLoan], // belongs to p1
        depreciations: [buildingDepreciation()] // belongs to p1
      });

      expect(analysis.summary.depreciation).toBe(0);
      expect(analysis.summary.interestExpense).toBe(0);
      expect(analysis.summary.principalRepayment).toBe(0);
    });
  });

  describe('foreign currency (BR-19)', () => {
    it('flags a transaction booked in another currency, since no rate is available', () => {
      const analysis = computeCashflowAnalysis(
        analysisInput({
          transactions: [
            rentTransaction,
            bankTransaction({
              _id: 't-chf',
              amount: -200,
              currency: 'CHF',
              valueDate: new Date('2026-07-08T00:00:00.000Z'),
              bookingDate: new Date('2026-07-08T00:00:00.000Z'),
              remittanceInformation: 'Gebäudeversicherung 2026'
            })
          ]
        })
      );

      expect(analysis.summary.hasForeignCurrency).toBe(true);
      // still reported - hiding it would silently lose a real cash movement
      expect(analysis.transactions.map((tx) => tx._id)).toContain('t-chf');
      expect(analysis.summary.totalExpenses).toBe(200);
    });

    it('is not flagged when everything is booked in the realm currency', () => {
      expect(
        computeCashflowAnalysis(standardInput).summary.hasForeignCurrency
      ).toBe(false);
    });
  });

  describe('empty states', () => {
    it('reports that no bank account is connected (BR-17)', () => {
      const analysis = computeCashflowAnalysis(
        analysisInput({ bankAccounts: [], transactions: [] })
      );

      expect(analysis.hasBankAccount).toBe(false);
      expect(analysis.transactions).toEqual([]);
      expect(analysis.categories).toEqual([]);
      expect(analysis.sankey).toEqual({ nodes: [], links: [] });
      expect(analysis.summary).toEqual(summaryOf());
    });

    it('reports a month without any transaction as an all-zero summary', () => {
      const analysis = computeCashflowAnalysis(
        analysisInput({ transactions: [] })
      );

      expect(analysis.hasBankAccount).toBe(true);
      expect(analysis.summary).toEqual(summaryOf());
    });

    it('accepts a negative cashflow as a valid result (BR-20)', () => {
      const analysis = computeCashflowAnalysis(
        analysisInput({
          transactions: [utilitiesTransaction, loanTransaction],
          loans: [julyLoan]
        })
      );

      expect(analysis.summary.operatingCashflow).toBe(-950);
      expect(analysis.summary.taxableResult).toBe(-450);
    });
  });

  it('builds the sankey graph as part of the analysis (AE-3)', () => {
    const { sankey } = computeCashflowAnalysis(standardInput);

    expect(nodeIndex(sankey, 'rent')).toBeGreaterThanOrEqual(0);
    expect(nodeIndex(sankey, 'loan_interest')).toBeGreaterThanOrEqual(0);
    expect(linkValue(sankey, 'rent', 'total')).toBe(1250);
  });
});

describe('buildSankeyGraph', () => {
  const cashOnlySummary = summaryOf({
    totalIncome: 1250,
    totalExpenses: 950,
    operatingCashflow: 300,
    interestExpense: 300,
    principalRepayment: 500,
    taxableResult: 450
  });
  const cashOnlyCategories = [
    {
      category: 'rent' as const,
      group: 'income' as const,
      total: 1250,
      count: 1
    },
    {
      category: 'loan_rate' as const,
      group: 'expense' as const,
      total: 800,
      count: 1
    },
    {
      category: 'utilities' as const,
      group: 'expense' as const,
      total: 150,
      count: 1
    }
  ];

  it('routes every income category through the "total" node into the expenses (three stages)', () => {
    const graph = buildSankeyGraph(cashOnlySummary, cashOnlyCategories);

    expect(linkValue(graph, 'rent', 'total')).toBe(1250);
    expect(linkValue(graph, 'total', 'utilities')).toBe(150);
    expect(linkValue(graph, 'total', 'net_cashflow')).toBe(300);
  });

  it('conserves the value flowing through the "total" node', () => {
    const graph = buildSankeyGraph(cashOnlySummary, cashOnlyCategories);

    expect(sumLinksInto(graph, 'total')).toBeCloseTo(1250, 2);
    expect(sumLinksOutOf(graph, 'total')).toBeCloseTo(1250, 2);
  });

  it('splits the loan rate into an interest and a principal outflow (BR-14a)', () => {
    const graph = buildSankeyGraph(cashOnlySummary, cashOnlyCategories);

    // the fachliche point of the whole diagram: only the interest is an
    // expense, the principal builds equity
    expect(linkValue(graph, 'total', 'loan_interest')).toBe(300);
    expect(linkValue(graph, 'total', 'loan_principal')).toBe(500);
    expect(nodeIndex(graph, 'loan_rate')).toBe(-1);
    expect(graph.nodes[nodeIndex(graph, 'loan_interest')].group).toBe(
      'expense'
    );
    expect(graph.nodes[nodeIndex(graph, 'loan_principal')].group).toBe(
      'expense'
    );
  });

  it('shows the depreciation as a separate non-cash source (BR-1, BR-6)', () => {
    const graph = buildSankeyGraph(
      summaryOf({
        ...cashOnlySummary,
        depreciation: 1000,
        taxableResult: -200
      }),
      [
        ...cashOnlyCategories,
        {
          category: 'depreciation' as const,
          group: 'noncash' as const,
          total: 1000,
          count: 1
        }
      ]
    );

    expect(linkValue(graph, 'depreciation', 'total')).toBe(1000);
    expect(graph.nodes[nodeIndex(graph, 'depreciation')].group).toBe('noncash');
    // the graph stays balanced even with the non-cash block attached
    expect(sumLinksInto(graph, 'total')).toBeCloseTo(
      sumLinksOutOf(graph, 'total'),
      2
    );
  });

  it('replaces the net cashflow outflow with a funding gap source when the month is negative (BR-14b)', () => {
    const graph = buildSankeyGraph(
      summaryOf({
        totalIncome: 500,
        totalExpenses: 800,
        operatingCashflow: -300,
        taxableResult: -300
      }),
      [
        {
          category: 'rent' as const,
          group: 'income' as const,
          total: 500,
          count: 1
        },
        {
          category: 'utilities' as const,
          group: 'expense' as const,
          total: 800,
          count: 1
        }
      ]
    );

    // recharts cannot draw a negative link - the shortfall becomes an inflow
    expect(nodeIndex(graph, 'net_cashflow')).toBe(-1);
    expect(linkValue(graph, 'funding_gap', 'total')).toBe(300);
    expect(graph.nodes[nodeIndex(graph, 'funding_gap')].group).toBe('gap');
    expect(sumLinksInto(graph, 'total')).toBeCloseTo(800, 2);
    expect(sumLinksOutOf(graph, 'total')).toBeCloseTo(800, 2);
  });

  it('has no funding gap when the cashflow is exactly zero (BR-14b, BR-14c)', () => {
    const graph = buildSankeyGraph(
      summaryOf({
        totalIncome: 800,
        totalExpenses: 800,
        operatingCashflow: 0
      }),
      [
        {
          category: 'rent' as const,
          group: 'income' as const,
          total: 800,
          count: 1
        },
        {
          category: 'utilities' as const,
          group: 'expense' as const,
          total: 800,
          count: 1
        }
      ]
    );

    expect(nodeIndex(graph, 'funding_gap')).toBe(-1);
    expect(nodeIndex(graph, 'net_cashflow')).toBe(-1); // a zero link is dropped
  });

  it('drops zero links and the nodes that would hang off them (BR-14c)', () => {
    const graph = buildSankeyGraph(cashOnlySummary, [
      ...cashOnlyCategories,
      {
        category: 'maintenance' as const,
        group: 'expense' as const,
        total: 0,
        count: 0
      }
    ]);

    expect(nodeIndex(graph, 'maintenance')).toBe(-1);
    expect(graph.links.every((link) => link.value > 0)).toBe(true);
  });

  it('does not draw the interest or principal node when there is no loan (BR-14c)', () => {
    const graph = buildSankeyGraph(
      summaryOf({
        totalIncome: 1250,
        totalExpenses: 150,
        operatingCashflow: 1100
      }),
      [
        {
          category: 'rent' as const,
          group: 'income' as const,
          total: 1250,
          count: 1
        },
        {
          category: 'utilities' as const,
          group: 'expense' as const,
          total: 150,
          count: 1
        }
      ]
    );

    expect(nodeIndex(graph, 'loan_interest')).toBe(-1);
    expect(nodeIndex(graph, 'loan_principal')).toBe(-1);
  });

  it('does not draw the deposit, it is a pass-through item (BR-14e, BR-4)', () => {
    const graph = buildSankeyGraph(
      summaryOf({ ...cashOnlySummary, deposits: 1900 }),
      [
        ...cashOnlyCategories,
        {
          category: 'deposit' as const,
          group: 'income' as const,
          total: 1900,
          count: 1
        }
      ]
    );

    expect(nodeIndex(graph, 'deposit')).toBe(-1);
    expect(sumLinksInto(graph, 'total')).toBeCloseTo(1250, 2);
  });

  it('draws the unclear transactions as their own outflow (BR-12)', () => {
    const graph = buildSankeyGraph(
      summaryOf({
        totalIncome: 1250,
        totalExpenses: 75,
        operatingCashflow: 1175,
        uncategorizedCount: 1,
        uncategorizedTotal: 75
      }),
      [
        {
          category: 'rent' as const,
          group: 'income' as const,
          total: 1250,
          count: 1
        },
        {
          category: 'uncategorized' as const,
          group: 'expense' as const,
          total: 75,
          count: 1
        }
      ]
    );

    expect(linkValue(graph, 'total', 'uncategorized')).toBe(75);
  });

  it('returns an empty graph when there is nothing to show (BR-14d)', () => {
    expect(buildSankeyGraph(summaryOf(), [])).toEqual({ nodes: [], links: [] });
  });

  it('names the nodes with the untranslated i18n key, the frontend translates', () => {
    const graph = buildSankeyGraph(cashOnlySummary, cashOnlyCategories);

    expect(graph.nodes.every((node) => node.name === node.key)).toBe(true);
  });

  it('references the nodes by numeric index, as recharts requires', () => {
    const graph = buildSankeyGraph(cashOnlySummary, cashOnlyCategories);

    expect(graph.links.length).toBeGreaterThan(0);
    graph.links.forEach((link) => {
      expect(Number.isInteger(link.source)).toBe(true);
      expect(Number.isInteger(link.target)).toBe(true);
      expect(graph.nodes[link.source]).toBeDefined();
      expect(graph.nodes[link.target]).toBeDefined();
      expect(link.source).not.toBe(link.target);
    });
  });
});
