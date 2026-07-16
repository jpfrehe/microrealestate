import { CollectionTypes } from '@microrealestate/types';
import mongoose from 'mongoose';
import Property from './property.js';
import Realm from './realm.js';

const LoanSchema = new mongoose.Schema<CollectionTypes.Loan>({
  realmId: { type: String, ref: Realm },
  propertyId: { type: String, ref: Property },

  name: String,
  lender: String,
  lenderIban: String,

  principalAmount: Number,
  interestRate: Number,
  monthlyRate: Number,
  startDate: Date,
  endDate: Date,

  status: {
    type: String,
    enum: ['active', 'closed'],
    default: 'active'
  },

  createdDate: Date,
  updatedDate: Date
});

LoanSchema.pre('save', function (next) {
  const now = new Date();
  if (!this.createdDate) {
    this.createdDate = now;
  }
  this.updatedDate = now;
  next();
});

export default mongoose.model<CollectionTypes.Loan>('Loan', LoanSchema);
