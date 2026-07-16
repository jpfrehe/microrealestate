// The backend emits stable, untranslated keys (contract section 5). Mapping
// them to a translatable label lives here so the sankey and the transaction
// list can never drift apart.
export const CATEGORY_LABELS = {
  rent: 'Rental income',
  service_charge: 'Service charge prepayment',
  deposit: 'Security deposit',
  other_income: 'Other income',
  loan_rate: 'Loan instalment',
  utilities: 'Utilities',
  property_management: 'Property management',
  maintenance: 'Maintenance',
  insurance: 'Insurance',
  property_tax: 'Property tax',
  other_expense: 'Other expense',
  depreciation: 'Depreciation (AfA)',
  uncategorized: 'Unclassified'
};

// Same order as the CashflowCategory union, income first.
export const CATEGORIES = Object.keys(CATEGORY_LABELS);

// The sankey adds the aggregate nodes and the two halves a loan instalment is
// split into (BR-14a) on top of the plain categories.
export const SANKEY_NODE_LABELS = {
  ...CATEGORY_LABELS,
  total: 'Total funds',
  // Not labelled "net cashflow": the graph balances the non-cash depreciation
  // through this node too, so with an AfA present it is more than the
  // operating cashflow the summary card reports (BR-1/BR-14b).
  net_cashflow: 'Remaining funds',
  funding_gap: 'Funding gap',
  loan_interest: 'Loan interest',
  loan_principal: 'Loan principal repayment'
};
