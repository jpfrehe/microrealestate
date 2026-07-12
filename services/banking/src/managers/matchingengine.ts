import {
  CollectionTypes,
  TransactionMatchStatus
} from '@microrealestate/types';

// Pure matching logic for UC2 (automatischer Zahlungsabgleich). Kept free of
// Mongoose/Express so the scoring rules can be unit-tested exhaustively; the
// I/O (fetching tenants/transactions, persisting results) lives in
// matchingmanager.ts.

export type OpenRentClaim = {
  tenantId: string;
  tenantName: string;
  term: number;
  openAmount: number; // amount still owed for this term (grandTotal - payment)
  searchTerms: string[]; // tenant name + property names, used for text matching
};

export type TransactionInput = {
  amount: number;
  remittanceInformation: string;
};

const AMOUNT_EPSILON = 0.01;

// U+0300-U+036F: Unicode "Combining Diacritical Marks" block, produced by
// NFD-decomposing accented letters (e.g. "ä" -> "a" + U+0308 combining
// diaeresis) - stripping it turns "Müller" into "muller" for matching.
const COMBINING_DIACRITICAL_MARKS = /[̀-ͯ]/g;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_DIACRITICAL_MARKS, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function computeTextScore(
  remittanceInformation: string,
  searchTerms: string[]
): number {
  const normalizedRemittance = normalize(remittanceInformation);
  if (!normalizedRemittance) {
    return 0;
  }

  return searchTerms.some((term) => {
    const normalizedTerm = normalize(term);
    return normalizedTerm.length > 0 && normalizedRemittance.includes(normalizedTerm);
  })
    ? 1
    : 0;
}

function computeAmountScore(
  transactionAmount: number,
  openAmount: number
): number {
  if (openAmount <= 0 || transactionAmount <= 0) {
    return 0;
  }
  if (Math.abs(transactionAmount - openAmount) <= AMOUNT_EPSILON) {
    return 1; // exact match
  }
  if (transactionAmount > openAmount) {
    return 0.8; // overpayment - still very likely the right claim
  }
  return 0.5; // partial payment - weaker signal on its own
}

function describeMatch(
  textScore: number,
  amountScore: number,
  transactionAmount: number,
  openAmount: number
): string {
  const reasons: string[] = [];
  if (textScore > 0) {
    reasons.push('remittance information mentions the tenant or property');
  }
  if (amountScore === 1) {
    reasons.push('amount matches the open balance exactly');
  } else if (transactionAmount > openAmount) {
    reasons.push(
      `amount exceeds the open balance by ${(transactionAmount - openAmount).toFixed(2)} (overpayment)`
    );
  } else if (amountScore > 0) {
    reasons.push(
      `amount only covers part of the open balance (${transactionAmount.toFixed(2)} of ${openAmount.toFixed(2)})`
    );
  }
  return reasons.join('; ') || 'no strong signal';
}

// Returns every plausible candidate, sorted by descending confidence. A
// candidate is only surfaced when the remittance text references the tenant
// or one of their properties - amount alone is too ambiguous across a
// realm's tenants (this is also what makes an unreferenced bank transfer
// come back empty, i.e. "unmatched", per UC2's alternate flow).
export function findMatchCandidates(
  transaction: TransactionInput,
  openClaims: OpenRentClaim[]
): CollectionTypes.TransactionMatchCandidate[] {
  const scoredClaims = openClaims.map((claim) => ({
    claim,
    textScore: computeTextScore(
      transaction.remittanceInformation,
      claim.searchTerms
    ),
    amountScore: computeAmountScore(transaction.amount, claim.openAmount)
  }));

  return scoredClaims
    .filter(({ textScore }) => textScore > 0)
    .map(({ claim, textScore, amountScore }) => ({
      tenantId: claim.tenantId,
      tenantName: claim.tenantName,
      term: claim.term,
      openAmount: claim.openAmount,
      confidence: textScore * 0.5 + amountScore * 0.5,
      reason: describeMatch(
        textScore,
        amountScore,
        transaction.amount,
        claim.openAmount
      )
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

export function determineMatchStatus(
  candidates: CollectionTypes.TransactionMatchCandidate[]
): TransactionMatchStatus {
  return candidates.length > 0 ? 'suggested' : 'unmatched';
}

// Builds the open claims a matching pass should consider from raw tenant
// data (as returned by Collections.Tenant.find(...).lean()).
export function buildOpenRentClaims(
  tenants: {
    _id: string;
    name: string;
    properties?: { property?: { name?: string } }[];
    rents: {
      term: number;
      total: { grandTotal: number; payment: number };
    }[];
  }[]
): OpenRentClaim[] {
  return tenants.flatMap((tenant) => {
    const propertyNames = (tenant.properties || [])
      .map((p) => p.property?.name)
      .filter((name): name is string => Boolean(name));
    const searchTerms = [tenant.name, ...propertyNames];

    return tenant.rents
      .filter((rent) => rent.total.payment < rent.total.grandTotal)
      .map((rent) => ({
        tenantId: tenant._id,
        tenantName: tenant.name,
        term: rent.term,
        openAmount:
          Math.round((rent.total.grandTotal - rent.total.payment) * 100) / 100,
        searchTerms
      }));
  });
}
