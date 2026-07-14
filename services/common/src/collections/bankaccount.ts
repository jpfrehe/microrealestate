import { CollectionTypes } from '@microrealestate/types';
import mongoose from 'mongoose';
import Realm from './realm.js';

const BankAccountSchema = new mongoose.Schema<CollectionTypes.BankAccount>({
  realmId: { type: String, ref: Realm },
  propertyIds: [String],

  aggregatorProvider: String,
  aggregatorAccountId: String,
  iban: String,
  bankName: String,
  accountHolder: String,

  // encrypted with common/utils/crypto (CIPHER_KEY/CIPHER_IV_KEY), never stored in clear text
  encryptedAccessToken: String,
  // encrypted with common/utils/crypto (CIPHER_KEY/CIPHER_IV_KEY), never stored in clear text;
  // optional since not every aggregator provider issues a separate refresh token
  encryptedRefreshToken: String,

  consentGivenDate: Date,
  consentExpiryDate: Date,
  status: {
    type: String,
    enum: ['pending', 'connected', 'reauth_required', 'disconnected'],
    default: 'pending'
  },
  lastSyncDate: Date,
  lastBalanceFetchDate: Date,
  reauthReminderSentDate: Date,

  createdDate: Date,
  updatedDate: Date
});

BankAccountSchema.pre('save', function (next) {
  const now = new Date();
  if (!this.createdDate) {
    this.createdDate = now;
  }
  this.updatedDate = now;
  next();
});

export default mongoose.model<CollectionTypes.BankAccount>(
  'BankAccount',
  BankAccountSchema
);
