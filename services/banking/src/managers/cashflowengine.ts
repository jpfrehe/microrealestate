import {
  CashflowCategory,
  CashflowCategoryGroup,
  CashflowCategorySource,
  LoanStatus,
  TransactionMatchStatus
} from '@microrealestate/types';
import { normalize } from './matchingengine.js';

// Pure cashflow logic for UC3 (Cashflow-Analyse). Kept free of
// Mongoose/Express so the categorization rules, the amortization schedule and
// the sankey graph can be unit-tested exhaustively; the I/O (fetching
// transactions/loans/depreciations, serving the response) lives in
// cashflowmanager.ts.
//
// The two results this engine reports are deliberately separate: the
// depreciation (AfA, § 7 EStG) never moves money, and the principal portion of
// a loan rate does move money but is no expense. Mixing either into a single
// number would produce a figure that is neither the bank reality nor the
// taxable one.

export type LoanInput = {
  _id: string;
  propertyId: string;
  name: string;
  lender: string;
  lenderIban?: string;
  principalAmount: number;
  interestRate: number; // nominal rate per year, in percent
  monthlyRate: number; // annuity (interest + principal), debited monthly
  startDate: Date;
  endDate?: Date;
  status: LoanStatus;
};

export type AmortizationEntry = {
  month: string; // YYYY-MM
  interest: number;
  principal: number;
  total: number; // what is actually debited, < monthlyRate on the final rate
  remainingDebt: number;
  neverAmortizes: boolean;
};

export type DepreciationInput = {
  _id: string;
  propertyId: string;
  name: string;
  baseAmount: number; // building share only, land is not depreciable
  rate: number; // depreciation rate per year, in percent
  startDate: Date;
  durationYears: number;
};

export type TransactionInput = {
  _id: string;
  bankAccountId: string;
  amount: number; // sign as the bank reports it: + inflow, - outflow
  currency: string;
  valueDate?: Date;
  bookingDate: Date;
  counterpartyName?: string;
  counterpartyIban?: string;
  remittanceInformation: string;
  matchStatus: TransactionMatchStatus;
  matchedTenantId?: string;
  category?: CashflowCategory; // only set on a landlord override
  categorySource?: 'manual';
};

export type CategorizationContext = {
  loans: LoanInput[];
};

export type CategorizationResult = {
  category: CashflowCategory;
  group: CashflowCategoryGroup;
  source: CashflowCategorySource;
  confidence: number; // 0-1
  reason: string;
  loanId: string | null;
};

export type CategoryTotal = {
  category: CashflowCategory;
  group: CashflowCategoryGroup;
  total: number; // always positive, the sign lives in the group
  count: number;
};

export type CashflowSummary = {
  totalIncome: number;
  totalExpenses: number;
  operatingCashflow: number;
  depreciation: number;
  interestExpense: number;
  principalRepayment: number;
  taxableResult: number;
  deposits: number;
  uncategorizedCount: number;
  uncategorizedTotal: number;
  hasForeignCurrency: boolean;
};

export type CashflowTransaction = {
  _id: string;
  valueDate: Date;
  bookingDate: Date;
  amount: number;
  currency: string;
  counterpartyName: string;
  counterpartyIban: string;
  remittanceInformation: string;
  category: CashflowCategory;
  categoryGroup: CashflowCategoryGroup;
  categorySource: CashflowCategorySource;
  categoryConfidence: number;
  categoryReason: string;
  propertyId: string | null;
  propertyName: string | null;
  loanId: string | null;
  interestPortion: number | null;
  principalPortion: number | null;
};

// 'gap' covers the funding shortfall, 'total'/'net' the two synthetic nodes -
// none of them is a transaction category, but the frontend colors by group.
export type SankeyNodeGroup = CashflowCategoryGroup | 'gap' | 'total' | 'net';

export type SankeyNode = {
  key: string;
  name: string; // == key: an i18n key, the frontend translates it
  group: SankeyNodeGroup;
};

export type SankeyLink = {
  source: number; // index into nodes, as recharts requires
  target: number;
  value: number;
};

export type SankeyGraph = {
  nodes: SankeyNode[];
  links: SankeyLink[];
};

export type CashflowAnalysisInput = {
  month: string; // YYYY-MM
  currency: string; // the realm's currency
  propertyId?: string;
  properties: { _id: string; name: string }[];
  bankAccounts: { _id: string; propertyIds: string[] }[];
  transactions: TransactionInput[];
  loans: LoanInput[];
  depreciations: DepreciationInput[];
};

export type CashflowAnalysis = {
  month: string;
  currency: string;
  hasBankAccount: boolean;
  property: { _id: string; name: string } | null;
  transactions: CashflowTransaction[];
  categories: CategoryTotal[];
  summary: CashflowSummary;
  sankey: SankeyGraph;
};

// A debit rarely hits the agreed annuity to the cent (fees, rate adjustments),
// so the loan signal tolerates 1 % - but on a small rate 1 % is a few cents,
// which no real debit would ever meet, hence the absolute floor.
const LOAN_RATE_TOLERANCE_RATIO = 0.01;
const LOAN_RATE_TOLERANCE_FLOOR = 1;

// Keyed by the union rather than listed as an array, so a new category cannot
// be introduced without the compiler pointing here - the API validates a
// landlord's override against this.
const CATEGORY_KEYS: Record<CashflowCategory, true> = {
  rent: true,
  service_charge: true,
  deposit: true,
  other_income: true,
  loan_rate: true,
  utilities: true,
  property_management: true,
  maintenance: true,
  insurance: true,
  property_tax: true,
  other_expense: true,
  depreciation: true,
  uncategorized: true
};

export function isCashflowCategory(value: unknown): value is CashflowCategory {
  return typeof value === 'string' && value in CATEGORY_KEYS;
}

function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}

// Months are compared as a running index so that year boundaries need no
// special casing, and in UTC so that the analysed month does not shift with
// the server's timezone (BR-15).
function monthIndexOf(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function monthIndexOfKey(month: string): number {
  const [year, monthOfYear] = month.split('-').map(Number);
  return year * 12 + (monthOfYear - 1);
}

function monthKeyOf(monthIndex: number): string {
  const year = Math.floor(monthIndex / 12);
  const monthOfYear = (monthIndex % 12) + 1;
  return `${year}-${String(monthOfYear).padStart(2, '0')}`;
}

// Builds the annuity schedule from the month the loan was paid out up to
// untilMonth. Interest always accrues on the *remaining* debt, so it shrinks
// from rate to rate - booking a constant portion would overstate the
// deductible expense (BR-8).
export function buildAmortizationSchedule(
  loan: LoanInput,
  untilMonth: string
): AmortizationEntry[] {
  const firstMonth = monthIndexOf(loan.startDate);
  // the rate is still debited in the month the loan ends, and never after it
  const lastMonth = Math.min(
    monthIndexOfKey(untilMonth),
    loan.endDate ? monthIndexOf(loan.endDate) : Number.MAX_SAFE_INTEGER
  );
  const monthlyInterestRate = loan.interestRate / 100 / 12;

  const schedule: AmortizationEntry[] = [];
  let remainingDebt = loan.principalAmount;
  for (
    let month = firstMonth;
    month <= lastMonth && remainingDebt > 0;
    month++
  ) {
    const interest = round2(remainingDebt * monthlyInterestRate);
    // BR-8c: a rate swallowed by the interest never reduces the debt. The
    // whole debit is interest expense then - the loan runs forever.
    const neverAmortizes = loan.monthlyRate <= interest;
    // BR-8a: the final rate only settles what is left, it never overpays
    const principal = neverAmortizes
      ? 0
      : round2(Math.min(loan.monthlyRate - interest, remainingDebt));
    const chargedInterest = neverAmortizes ? loan.monthlyRate : interest;

    remainingDebt = round2(remainingDebt - principal);
    schedule.push({
      month: monthKeyOf(month),
      interest: chargedInterest,
      principal,
      total: round2(chargedInterest + principal),
      remainingDebt,
      neverAmortizes
    });
  }
  return schedule;
}

// The interest/principal split of a single month, or null when no rate is due
// (before payout, after the end date, once the debt is settled).
export function getLoanRateForMonth(
  loan: LoanInput,
  month: string
): {
  interest: number;
  principal: number;
  total: number;
  neverAmortizes: boolean;
} | null {
  const entry = buildAmortizationSchedule(loan, month).find(
    (candidate) => candidate.month === month
  );
  if (!entry) {
    return null;
  }
  return {
    interest: entry.interest,
    principal: entry.principal,
    total: entry.total,
    neverAmortizes: entry.neverAmortizes
  };
}

// BR-21: pro rata temporis simplified to whole months - the start month counts
// in full, earlier months not at all, and nothing is left after the useful
// life has elapsed.
export function computeDepreciationForMonth(
  depreciation: DepreciationInput,
  month: string
): number {
  const elapsedMonths =
    monthIndexOfKey(month) - monthIndexOf(depreciation.startDate);
  if (elapsedMonths < 0 || elapsedMonths >= depreciation.durationYears * 12) {
    return 0;
  }
  return round2((depreciation.baseAmount * depreciation.rate) / 100 / 12);
}

// Keyword rules (BR-13, priority 4). Order is normative: the first category
// whose keywords appear in the normalized text wins, so the list must stay
// deterministic. Keywords are matched against normalized text, i.e. lowercase
// and without diacritics ("Müll" -> "mull").
const KEYWORD_RULES: { category: CashflowCategory; keywords: string[] }[] = [
  {
    category: 'deposit',
    keywords: ['kaution', 'mietkaution', 'deposit']
  },
  {
    category: 'utilities',
    keywords: [
      'strom',
      'gas',
      'wasser',
      'heizung',
      'mull',
      'abwasser',
      'stadtwerke',
      'energie',
      'electricity',
      'heating'
    ]
  },
  {
    category: 'property_management',
    keywords: [
      'hausverwaltung',
      'verwaltung',
      'hausgeld',
      'verwaltergebuhr',
      'property management'
    ]
  },
  {
    category: 'insurance',
    keywords: [
      'gebaudeversicherung',
      'versicherung',
      'haftpflicht',
      'allianz',
      'insurance'
    ]
  },
  {
    category: 'property_tax',
    keywords: ['grundsteuer', 'grundabgaben', 'property tax']
  },
  {
    category: 'maintenance',
    keywords: [
      'instandhaltung',
      'reparatur',
      'handwerker',
      'sanierung',
      'wartung',
      'maintenance'
    ]
  }
];

function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

// BR-13a: the group always follows the sign, never the category. An insurance
// refund stays an insurance transaction but is a cash inflow.
function groupOfAmount(amount: number): CashflowCategoryGroup {
  return amount < 0 ? 'expense' : 'income';
}

function matchesLoanRate(amount: number, loan: LoanInput): boolean {
  const tolerance = Math.max(
    loan.monthlyRate * LOAN_RATE_TOLERANCE_RATIO,
    LOAN_RATE_TOLERANCE_FLOOR
  );
  return Math.abs(Math.abs(amount) - loan.monthlyRate) <= tolerance;
}

// Finds the loan a debit belongs to. The lender IBAN is the strongest signal;
// the loan/lender name in the remittance is weaker but still explicit. Either
// way the amount has to look like the agreed rate, otherwise a special
// repayment to the same lender would be booked as a monthly rate.
function findLoan(
  transaction: TransactionInput,
  loans: LoanInput[]
): { loan: LoanInput; confidence: number; reason: string } | null {
  const counterpartyIban = transaction.counterpartyIban
    ? normalizeIban(transaction.counterpartyIban)
    : '';
  const ibanLoan = counterpartyIban
    ? loans.find(
        (loan) =>
          loan.lenderIban && normalizeIban(loan.lenderIban) === counterpartyIban
      )
    : undefined;
  if (ibanLoan && matchesLoanRate(transaction.amount, ibanLoan)) {
    return {
      loan: ibanLoan,
      confidence: 1,
      reason: `counterparty IBAN is the lender account of "${ibanLoan.name}" and the amount matches its monthly rate`
    };
  }

  const remittance = normalize(transaction.remittanceInformation);
  const namedLoan = remittance
    ? loans.find((loan) =>
        [loan.name, loan.lender].some((term) => {
          const normalizedTerm = normalize(term);
          return (
            normalizedTerm.length > 0 && remittance.includes(normalizedTerm)
          );
        })
      )
    : undefined;
  if (namedLoan && matchesLoanRate(transaction.amount, namedLoan)) {
    return {
      loan: namedLoan,
      confidence: 0.9,
      reason: `remittance information mentions "${namedLoan.name}" and the amount matches its monthly rate`
    };
  }

  return null;
}

function findKeywordCategory(
  transaction: TransactionInput
): { category: CashflowCategory; keyword: string } | null {
  const text = normalize(
    `${transaction.remittanceInformation} ${transaction.counterpartyName || ''}`
  );
  if (!text) {
    return null;
  }

  for (const rule of KEYWORD_RULES) {
    const keyword = rule.keywords.find((candidate) => text.includes(candidate));
    if (keyword) {
      return { category: rule.category, keyword };
    }
  }
  return null;
}

// Applies the signals of BR-13 in their normative priority order and stops at
// the first hit. When nothing applies the transaction stays 'uncategorized' -
// guessing here would end up as a wrong booking in the accounting export
// (UC4), which is worse than an open item the landlord has to touch.
export function categorizeTransaction(
  transaction: TransactionInput,
  context: CategorizationContext
): CategorizationResult {
  const group = groupOfAmount(transaction.amount);

  if (transaction.categorySource === 'manual' && transaction.category) {
    return {
      category: transaction.category,
      group,
      source: 'manual',
      confidence: 1,
      reason: 'category was set manually by the landlord',
      loanId: null
    };
  }

  if (transaction.matchStatus === 'matched' && transaction.matchedTenantId) {
    return {
      category: 'rent',
      group,
      source: 'match',
      confidence: 1,
      reason: 'confirmed by the payment matching as a tenant rent payment',
      loanId: null
    };
  }

  const loanHit = findLoan(transaction, context.loans);
  if (loanHit) {
    return {
      category: 'loan_rate',
      group,
      source: 'loan',
      confidence: loanHit.confidence,
      reason: loanHit.reason,
      loanId: loanHit.loan._id
    };
  }

  const keywordHit = findKeywordCategory(transaction);
  if (keywordHit) {
    return {
      category: keywordHit.category,
      group,
      source: 'rule',
      confidence: 0.6,
      reason: `remittance information or counterparty mentions "${keywordHit.keyword}"`,
      loanId: null
    };
  }

  return {
    category: 'uncategorized',
    group,
    source: 'none',
    confidence: 0,
    reason: 'no reliable signal found',
    loanId: null
  };
}

// Three-stage, value-conserving graph: every source flows into the synthetic
// 'total' node and out of it again. Recharts addresses nodes by index and
// cannot draw negative or zero links, which drives most of the shape here.
export function buildSankeyGraph(
  summary: CashflowSummary,
  categories: CategoryTotal[]
): SankeyGraph {
  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];

  const nodeIndexOf = (key: string, group: SankeyNodeGroup): number => {
    const existing = nodes.findIndex((node) => node.key === key);
    if (existing >= 0) {
      return existing;
    }
    nodes.push({ key, name: key, group });
    return nodes.length - 1;
  };
  // BR-14c: a zero link is dropped, and with it the node that would only hang
  // off it - hence the node is created lazily, from inside the link.
  const link = (
    source: { key: string; group: SankeyNodeGroup },
    target: { key: string; group: SankeyNodeGroup },
    value: number
  ): void => {
    if (value <= 0) {
      return;
    }
    links.push({
      source: nodeIndexOf(source.key, source.group),
      target: nodeIndexOf(target.key, target.group),
      value: round2(value)
    });
  };

  const total = { key: 'total', group: 'total' as const };

  // sources: cash income (BR-14e: never the deposit, it is held in trust and
  // only passes through) plus the non-cash depreciation block (BR-1)
  categories
    .filter(
      (entry) =>
        (entry.group === 'income' || entry.group === 'noncash') &&
        entry.category !== 'deposit'
    )
    .forEach((entry) =>
      link({ key: entry.category, group: entry.group }, total, entry.total)
    );

  // BR-14a: the loan rate leaves as two flows - only the interest is an
  // expense, the principal builds equity. This split is the point of the
  // whole diagram, a flat category list cannot show it.
  link(
    total,
    { key: 'loan_interest', group: 'expense' },
    summary.interestExpense
  );
  link(
    total,
    { key: 'loan_principal', group: 'expense' },
    summary.principalRepayment
  );
  categories
    .filter(
      (entry) =>
        entry.group === 'expense' &&
        entry.category !== 'loan_rate' &&
        entry.category !== 'deposit'
    )
    .forEach((entry) =>
      link(total, { key: entry.category, group: 'expense' }, entry.total)
    );

  // What is left over after the outflows. With the non-cash block attached
  // this is more than summary.operatingCashflow - the graph has to stay
  // balanced, so the residual is derived from the links actually drawn rather
  // than taken from the summary.
  const totalIndex = nodes.findIndex((node) => node.key === 'total');
  const inflow = links
    .filter((entry) => entry.target === totalIndex)
    .reduce((sum, entry) => sum + entry.value, 0);
  const outflow = links
    .filter((entry) => entry.source === totalIndex)
    .reduce((sum, entry) => sum + entry.value, 0);
  const residual = round2(inflow - outflow);

  if (residual >= 0) {
    link(total, { key: 'net_cashflow', group: 'net' }, residual);
  } else {
    // BR-14b: recharts cannot draw a negative link, so a shortfall is shown as
    // an extra source instead - the month was funded from somewhere else.
    link({ key: 'funding_gap', group: 'gap' }, total, -residual);
  }

  // BR-14d: nothing to show at all - not even the lone 'total' node, the
  // frontend renders its empty state instead
  if (!links.length) {
    return { nodes: [], links: [] };
  }
  return { nodes, links };
}

function monthOfTransaction(transaction: TransactionInput): number {
  // BR-15: the value date is when the money actually moved; only a bank that
  // sends none falls back to the booking date
  return monthIndexOf(transaction.valueDate || transaction.bookingDate);
}

function sumBy<T>(items: T[], value: (item: T) => number): number {
  return items.reduce((sum, item) => sum + value(item), 0);
}

// Aggregates one month of a realm (or of a single property) into the numbers,
// the category totals and the sankey graph the cashflow page renders.
export function computeCashflowAnalysis(
  input: CashflowAnalysisInput
): CashflowAnalysis {
  const { month, currency, propertyId } = input;

  // BR-18: a realm-wide account (no propertyIds) cannot be attributed to a
  // single property, so it drops out as soon as one is selected
  const bankAccounts = propertyId
    ? input.bankAccounts.filter((account) =>
        account.propertyIds.includes(propertyId)
      )
    : input.bankAccounts;
  const accountsById = new Map(
    bankAccounts.map((account) => [account._id, account])
  );
  const loans = propertyId
    ? input.loans.filter((loan) => loan.propertyId === propertyId)
    : input.loans;
  const depreciations = propertyId
    ? input.depreciations.filter(
        (depreciation) => depreciation.propertyId === propertyId
      )
    : input.depreciations;

  const monthIndex = monthIndexOfKey(month);
  const transactions = input.transactions.filter(
    (transaction) =>
      accountsById.has(transaction.bankAccountId) &&
      // BR-13a: the landlord dismissed this one as not rent related, it has no
      // place in the analysis either
      transaction.matchStatus !== 'ignored' &&
      monthOfTransaction(transaction) === monthIndex
  );

  const analysedTransactions: CashflowTransaction[] = transactions.map(
    (transaction) => {
      const categorization = categorizeTransaction(transaction, { loans });
      const loan =
        categorization.loanId &&
        loans.find((candidate) => candidate._id === categorization.loanId);
      const rate = loan ? getLoanRateForMonth(loan, month) : null;
      const account = accountsById.get(transaction.bankAccountId);
      const resolvedPropertyId =
        account?.propertyIds.length === 1 ? account.propertyIds[0] : null;
      const property = input.properties.find(
        (candidate) => candidate._id === resolvedPropertyId
      );

      return {
        _id: transaction._id,
        valueDate: transaction.valueDate || transaction.bookingDate,
        bookingDate: transaction.bookingDate,
        amount: transaction.amount,
        currency: transaction.currency,
        counterpartyName: transaction.counterpartyName || '',
        counterpartyIban: transaction.counterpartyIban || '',
        remittanceInformation: transaction.remittanceInformation,
        category: categorization.category,
        categoryGroup: categorization.group,
        categorySource: categorization.source,
        categoryConfidence: categorization.confidence,
        categoryReason: categorization.reason,
        propertyId: resolvedPropertyId,
        propertyName: property?.name || null,
        loanId: categorization.loanId,
        interestPortion: rate ? rate.interest : null,
        principalPortion: rate ? rate.principal : null
      };
    }
  );

  const categories: CategoryTotal[] = [];
  const addCategoryTotal = (
    category: CashflowCategory,
    group: CashflowCategoryGroup,
    total: number,
    count: number
  ) => {
    if (total > 0) {
      categories.push({ category, group, total: round2(total), count });
    }
  };
  const byCategory = new Map<string, CashflowTransaction[]>();
  analysedTransactions.forEach((transaction) => {
    const key = `${transaction.category}/${transaction.categoryGroup}`;
    byCategory.set(key, [...(byCategory.get(key) || []), transaction]);
  });
  byCategory.forEach((entries) =>
    addCategoryTotal(
      entries[0].category,
      entries[0].categoryGroup,
      sumBy(entries, (entry) => Math.abs(entry.amount)),
      entries.length
    )
  );

  // BR-6: the depreciation is computed from the Depreciation entities, it has
  // no bank transaction behind it
  const activeDepreciations = depreciations
    .map((depreciation) => computeDepreciationForMonth(depreciation, month))
    .filter((amount) => amount > 0);
  const depreciation = round2(sumBy(activeDepreciations, (amount) => amount));
  addCategoryTotal(
    'depreciation',
    'noncash',
    depreciation,
    activeDepreciations.length
  );

  // BR-4: a deposit is held in trust - counting it as income would be a real
  // accounting error, not a display detail
  const isDeposit = (transaction: CashflowTransaction) =>
    transaction.category === 'deposit';
  const uncategorized = analysedTransactions.filter(
    (transaction) => transaction.category === 'uncategorized'
  );
  const totalIncome = round2(
    sumBy(
      analysedTransactions.filter(
        (transaction) =>
          transaction.categoryGroup === 'income' && !isDeposit(transaction)
      ),
      (transaction) => transaction.amount
    )
  );
  const totalExpenses = round2(
    sumBy(
      analysedTransactions.filter(
        (transaction) =>
          transaction.categoryGroup === 'expense' && !isDeposit(transaction)
      ),
      (transaction) => Math.abs(transaction.amount)
    )
  );
  const interestExpense = round2(
    sumBy(
      analysedTransactions,
      (transaction) => transaction.interestPortion || 0
    )
  );
  const principalRepayment = round2(
    sumBy(
      analysedTransactions,
      (transaction) => transaction.principalPortion || 0
    )
  );

  const summary: CashflowSummary = {
    totalIncome,
    totalExpenses,
    operatingCashflow: round2(totalIncome - totalExpenses),
    depreciation,
    interestExpense,
    principalRepayment,
    // BR-1: the principal repayment is no expense, the depreciation is one -
    // this is where the taxable result parts ways with the bank balance
    taxableResult: round2(
      totalIncome - (totalExpenses - principalRepayment) - depreciation
    ),
    deposits: round2(
      sumBy(
        analysedTransactions.filter(isDeposit),
        (transaction) => transaction.amount
      )
    ),
    uncategorizedCount: uncategorized.length,
    uncategorizedTotal: round2(
      sumBy(uncategorized, (transaction) => Math.abs(transaction.amount))
    ),
    // BR-19: there is no exchange rate in the system, so a foreign currency
    // transaction is reported and flagged rather than silently converted
    hasForeignCurrency: analysedTransactions.some(
      (transaction) => transaction.currency !== currency
    )
  };

  return {
    month,
    currency,
    hasBankAccount: input.bankAccounts.length > 0,
    property:
      input.properties.find((candidate) => candidate._id === propertyId) ||
      null,
    transactions: analysedTransactions,
    categories,
    summary,
    sankey: buildSankeyGraph(summary, categories)
  };
}
