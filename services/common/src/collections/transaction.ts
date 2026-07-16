import BankAccount from './bankaccount.js';
import { CollectionTypes } from '@microrealestate/types';
import Loan from './loan.js';
import mongoose from 'mongoose';
import Realm from './realm.js';

const TransactionSchema = new mongoose.Schema<CollectionTypes.Transaction>({
  realmId: { type: String, ref: Realm },
  bankAccountId: { type: String, ref: BankAccount },
  aggregatorTransactionId: String,

  amount: Number,
  currency: String,
  valueDate: Date,
  bookingDate: Date,
  counterpartyName: String,
  counterpartyIban: String,
  remittanceInformation: String,

  matchStatus: {
    type: String,
    enum: ['unmatched', 'suggested', 'matched', 'ignored'],
    default: 'unmatched'
  },
  matchCandidates: [
    {
      _id: false,
      tenantId: String,
      tenantName: String,
      term: Number,
      openAmount: Number,
      confidence: Number,
      reason: String
    }
  ],
  matchedTenantId: String,
  matchedTerm: Number,

  // cashflow analysis: only persisted when the landlord overrides the automatic
  // categorization, hence no default - an unset category means "derive it"
  category: {
    type: String,
    enum: [
      'rent',
      'service_charge',
      'deposit',
      'other_income',
      'loan_rate',
      'utilities',
      'property_management',
      'maintenance',
      'insurance',
      'property_tax',
      'other_expense',
      'depreciation',
      'uncategorized'
    ]
  },
  categorySource: {
    type: String,
    enum: ['manual']
  },
  loanId: { type: String, ref: Loan },

  createdDate: Date,
  updatedDate: Date
});

// a given bank transaction must only ever be imported once per account
TransactionSchema.index(
  { bankAccountId: 1, aggregatorTransactionId: 1 },
  { unique: true }
);

TransactionSchema.pre('save', function (next) {
  const now = new Date();
  if (!this.createdDate) {
    this.createdDate = now;
  }
  this.updatedDate = now;
  next();
});

export default mongoose.model<CollectionTypes.Transaction>(
  'Transaction',
  TransactionSchema
);
