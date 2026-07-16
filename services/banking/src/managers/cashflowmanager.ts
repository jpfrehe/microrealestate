import * as Express from 'express';
import { Collections, ServiceError } from '@microrealestate/common';
import { CollectionTypes, ServiceRequest } from '@microrealestate/types';
import {
  computeCashflowAnalysis,
  isCashflowCategory,
  TransactionInput
} from './cashflowengine.js';
import moment from 'moment';
import mongoose from 'mongoose';
import { readObjectIdParam } from '../utils/params.js';
import { toDepreciationInput } from './depreciationmanager.js';
import { toLoanInput } from './loanmanager.js';

const MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

function toTransactionInput(
  transaction: CollectionTypes.Transaction
): TransactionInput {
  return {
    _id: String(transaction._id),
    bankAccountId: String(transaction.bankAccountId),
    amount: transaction.amount,
    currency: transaction.currency,
    valueDate: transaction.valueDate,
    bookingDate: transaction.bookingDate,
    counterpartyName: transaction.counterpartyName,
    counterpartyIban: transaction.counterpartyIban,
    remittanceInformation: transaction.remittanceInformation,
    matchStatus: transaction.matchStatus,
    matchedTenantId: transaction.matchedTenantId,
    category: transaction.category,
    categorySource: transaction.categorySource
  };
}

// The month a transaction belongs to is its value date, and only a bank that
// sends none falls back to the booking date (BR-15) - the filter has to mirror
// that fallback exactly, otherwise the engine would drop rows the query
// fetched, or worse, never see rows it should have aggregated. A missing field
// and an explicit null both answer to `valueDate: null` in Mongo.
function monthFilter(month: string) {
  const from = moment.utc(month, 'YYYY-MM').startOf('month').toDate();
  const to = moment.utc(from).add(1, 'month').toDate();

  return {
    $or: [
      { valueDate: { $gte: from, $lt: to } },
      { valueDate: null, bookingDate: { $gte: from, $lt: to } }
    ]
  };
}

// Serves the whole cashflow page in one round-trip: the engine needs every
// input at once (a loan rate can only be split once its loan is known, the
// property of a transaction only via its bank account), and splitting this
// into several endpoints would just move the joining into the frontend.
export async function getCashflow(req: Express.Request, res: Express.Response) {
  const request = req as ServiceRequest;
  const realmId = String(request.realm?._id);

  const { month, propertyId } = req.query;
  if (!MONTH_FORMAT.test(String(month))) {
    throw new ServiceError('month must be formatted YYYY-MM', 422);
  }

  const [transactions, bankAccounts, loans, depreciations, properties] =
    await Promise.all([
      Collections.Transaction.find({
        realmId,
        ...monthFilter(String(month))
      }).lean(),
      Collections.BankAccount.find({ realmId }).lean(),
      Collections.Loan.find({ realmId }).lean(),
      Collections.Depreciation.find({ realmId }).lean(),
      Collections.Property.find({ realmId }).lean()
    ]);

  res.json(
    computeCashflowAnalysis({
      month: String(month),
      currency: request.realm?.currency || '',
      propertyId: typeof propertyId === 'string' ? propertyId : undefined,
      properties: properties.map((property) => ({
        _id: String(property._id),
        name: property.name
      })),
      bankAccounts: bankAccounts.map((account) => ({
        _id: String(account._id),
        propertyIds: (account.propertyIds || []).map(String)
      })),
      transactions: transactions.map(toTransactionInput),
      loans: loans.map(toLoanInput),
      depreciations: depreciations.map(toDepreciationInput)
    })
  );
}

// A loanId from outside the realm must never be stored - it would split the
// rate along another landlord's annuity. The ObjectId check comes first
// because Mongo answers a malformed id with a CastError (500) instead of the
// 422 the contract asks for.
async function assertLoanInRealm(
  realmId: string,
  loanId: unknown
): Promise<string> {
  const id = String(loanId ?? '');
  const loan = mongoose.Types.ObjectId.isValid(id)
    ? await Collections.Loan.findOne({ _id: id, realmId }).lean()
    : null;

  if (!loan) {
    throw new ServiceError('loanId is not a loan of this realm', 422);
  }
  return id;
}

// The landlord's override wins over every automatic signal (BR-13, priority 1),
// so it is the one categorization decision that is persisted. Clearing it hands
// the transaction back to the automatic detection rather than freezing today's
// guess - which is why the fields are unset instead of being written with the
// value the engine currently derives.
export async function updateTransactionCategory(
  req: Express.Request,
  res: Express.Response
) {
  const request = req as ServiceRequest;
  const realmId = String(request.realm?._id);
  const transactionId = readObjectIdParam(req.params.id);
  const { category, loanId } = req.body;

  if (category !== null && !isCashflowCategory(category)) {
    throw new ServiceError('category is not a known cashflow category', 422);
  }

  const existing = await Collections.Transaction.findOne({
    _id: transactionId,
    realmId
  }).lean();
  if (!existing) {
    return res.sendStatus(404);
  }

  // a loanId only carries meaning on a loan rate, and an override to any other
  // category has to drop the one the automatic detection may have left behind
  const linkedLoanId =
    category === 'loan_rate' && loanId != null
      ? await assertLoanInRealm(realmId, loanId)
      : null;

  const transaction = await Collections.Transaction.findOneAndUpdate(
    { _id: transactionId, realmId },
    category === null
      ? {
          updatedDate: new Date(),
          $unset: { category: 1, categorySource: 1, loanId: 1 }
        }
      : {
          category,
          categorySource: 'manual',
          updatedDate: new Date(),
          ...(linkedLoanId
            ? { loanId: linkedLoanId }
            : { $unset: { loanId: 1 } })
        },
    { new: true }
  ).lean();

  res.json(transaction);
}
