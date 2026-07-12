export * from './collections.js';
export * from './environmentvalues.js';
export * from './locales.js';
export * from './redisclient.js';
export * from './service.js';

export type ConnectionRole = 'administrator' | 'renter' | 'tenant';
export type UserRole = Exclude<ConnectionRole, 'tenant'>;
export type ConnectionType = 'service' | 'user' | 'application'; // 'service' is for internal services, 'user' is for users, 'application' is for external applications

export type PaymentMethod = 'transfer' | 'credit-card' | 'cash' | 'check';
export type PaymentStatus = 'paid' | 'partially-paid' | 'unpaid';
export type LeaseStatus = 'active' | 'ended' | 'terminated';
export type LeaseTimeRange = 'days' | 'weeks' | 'months' | 'years';

// Open banking / XS2A (see system.md roadmap Phase 0-4)
export type BankAccountStatus =
  | 'pending' // consent initiated, not yet confirmed by the account holder
  | 'connected'
  | 'reauth_required' // consent expired (typically after 90 days), needs a new SCA
  | 'disconnected';
export type TransactionMatchStatus =
  | 'unmatched' // no candidate found, needs manual assignment
  | 'suggested' // one or more candidates found, awaiting landlord confirmation
  | 'matched' // confirmed and applied to a rent term
  | 'ignored'; // explicitly dismissed by the landlord (e.g. not rent related)
export type ExpenseCategory =
  | 'maintenance'
  | 'insurance'
  | 'management_fees'
  | 'property_tax'
  | 'utilities'
  | 'loan_interest'
  | 'other';
export type ExpenseSource = 'manual' | 'bank_transaction';
