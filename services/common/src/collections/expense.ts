import { CollectionTypes } from '@microrealestate/types';
import mongoose from 'mongoose';
import Property from './property.js';
import Realm from './realm.js';
import Transaction from './transaction.js';

const ExpenseSchema = new mongoose.Schema<CollectionTypes.Expense>({
  realmId: { type: String, ref: Realm },
  propertyId: { type: String, ref: Property },

  category: {
    type: String,
    enum: [
      'maintenance',
      'insurance',
      'management_fees',
      'property_tax',
      'utilities',
      'loan_interest',
      'other'
    ],
    default: 'other'
  },
  amount: Number,
  date: Date,
  description: String,
  documentId: String,

  source: {
    type: String,
    enum: ['manual', 'bank_transaction'],
    default: 'manual'
  },
  transactionId: { type: String, ref: Transaction },

  createdDate: Date,
  updatedDate: Date
});

ExpenseSchema.pre('save', function (next) {
  const now = new Date();
  if (!this.createdDate) {
    this.createdDate = now;
  }
  this.updatedDate = now;
  next();
});

export default mongoose.model<CollectionTypes.Expense>(
  'Expense',
  ExpenseSchema
);
