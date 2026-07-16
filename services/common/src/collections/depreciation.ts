import { CollectionTypes } from '@microrealestate/types';
import mongoose from 'mongoose';
import Property from './property.js';
import Realm from './realm.js';

const DepreciationSchema = new mongoose.Schema<CollectionTypes.Depreciation>({
  realmId: { type: String, ref: Realm },
  propertyId: { type: String, ref: Property },

  name: String,
  baseAmount: Number,
  rate: Number,
  startDate: Date,
  durationYears: Number,

  createdDate: Date,
  updatedDate: Date
});

DepreciationSchema.pre('save', function (next) {
  const now = new Date();
  if (!this.createdDate) {
    this.createdDate = now;
  }
  this.updatedDate = now;
  next();
});

export default mongoose.model<CollectionTypes.Depreciation>(
  'Depreciation',
  DepreciationSchema
);
