import * as Express from 'express';
import { buildAmortizationSchedule, LoanInput } from './cashflowengine.js';
import { Collections, ServiceError } from '@microrealestate/common';
import { CollectionTypes, ServiceRequest } from '@microrealestate/types';
import moment from 'moment';
import mongoose from 'mongoose';

const MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

// An open-ended loan has no endDate, so the plan runs until the debt is
// repaid. The engine stops emitting rates at that point (BR-8a), which means
// the horizon only has to be far enough out not to truncate a running loan -
// no German real-estate loan outlives it, and a loan that never amortizes
// (BR-8c) at least gets a bounded answer instead of an endless one.
const SCHEDULE_HORIZON_YEARS = 60;

type LoanPayload = Partial<
  Pick<
    CollectionTypes.Loan,
    | 'propertyId'
    | 'name'
    | 'lender'
    | 'lenderIban'
    | 'principalAmount'
    | 'interestRate'
    | 'monthlyRate'
    | 'startDate'
    | 'endDate'
    | 'status'
  >
>;

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ServiceError(`${field} must be a non-empty string`, 422);
  }
  return value.trim();
}

function assertPositiveNumber(value: unknown, field: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new ServiceError(`${field} must be a number greater than 0`, 422);
  }
  return numeric;
}

function assertNonNegativeNumber(value: unknown, field: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new ServiceError(`${field} must be a number greater or equal 0`, 422);
  }
  return numeric;
}

function assertDate(value: unknown, field: string): Date {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ServiceError(`${field} must be a valid date`, 422);
  }
  return date;
}

function assertStatus(value: unknown): CollectionTypes.Loan['status'] {
  if (value !== 'active' && value !== 'closed') {
    throw new ServiceError('status must be either active or closed', 422);
  }
  return value;
}

// A propertyId from outside the realm must never be stored - it would
// attribute a loan to another landlord's object. The ObjectId check comes
// first because Mongo answers a malformed id with a CastError (500) instead
// of the 422 the contract asks for.
export async function assertPropertyInRealm(
  realmId: string,
  propertyId: unknown
): Promise<string> {
  const id = String(propertyId ?? '');
  const property = mongoose.Types.ObjectId.isValid(id)
    ? await Collections.Property.findOne({ _id: id, realmId }).lean()
    : null;

  if (!property) {
    throw new ServiceError('propertyId is not a property of this realm', 422);
  }
  return id;
}

// Whitelists and validates the payload instead of handing req.body to Mongo:
// realmId/_id must not be settable by the client, and an implausible rate
// would silently corrupt the cashflow analysis (the schedule drives both the
// interest/principal split and the taxable result). On PATCH only the fields
// actually sent are validated, so a partial update stays partial.
async function buildLoanPayload(
  realmId: string,
  body: Record<string, unknown>,
  { partial }: { partial: boolean }
): Promise<LoanPayload> {
  const payload: LoanPayload = {};
  const given = (field: string) => body[field] !== undefined;

  if (!partial || given('propertyId')) {
    payload.propertyId = await assertPropertyInRealm(realmId, body.propertyId);
  }
  if (!partial || given('name')) {
    payload.name = assertNonEmptyString(body.name, 'name');
  }
  if (!partial || given('lender')) {
    payload.lender = assertNonEmptyString(body.lender, 'lender');
  }
  // null is how the client says "no lender IBAN"/"no end date" - on a create
  // the field is then simply left unset, on an update it is cleared below
  if (given('lenderIban') && body.lenderIban !== null) {
    payload.lenderIban = assertNonEmptyString(body.lenderIban, 'lenderIban');
  }
  if (!partial || given('principalAmount')) {
    payload.principalAmount = assertPositiveNumber(
      body.principalAmount,
      'principalAmount'
    );
  }
  if (!partial || given('interestRate')) {
    payload.interestRate = assertNonNegativeNumber(
      body.interestRate,
      'interestRate'
    );
  }
  if (!partial || given('monthlyRate')) {
    payload.monthlyRate = assertPositiveNumber(body.monthlyRate, 'monthlyRate');
  }
  if (!partial || given('startDate')) {
    payload.startDate = assertDate(body.startDate, 'startDate');
  }
  if (given('endDate') && body.endDate !== null) {
    payload.endDate = assertDate(body.endDate, 'endDate');
  }
  if (given('status')) {
    payload.status = assertStatus(body.status);
  }

  return payload;
}

// Maps a Loan document to the engine's plain-data input. Shared with
// cashflowmanager so both call sites feed the engine the exact same shape.
export function toLoanInput(loan: CollectionTypes.Loan): LoanInput {
  return {
    _id: String(loan._id),
    propertyId: String(loan.propertyId),
    name: loan.name,
    lender: loan.lender,
    lenderIban: loan.lenderIban,
    principalAmount: loan.principalAmount,
    interestRate: loan.interestRate,
    monthlyRate: loan.monthlyRate,
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status
  };
}

export async function listLoans(req: Express.Request, res: Express.Response) {
  const request = req as ServiceRequest;
  const filter: Partial<Pick<CollectionTypes.Loan, 'realmId' | 'propertyId'>> =
    { realmId: request.realm?._id };
  if (typeof req.query.propertyId === 'string') {
    filter.propertyId = req.query.propertyId;
  }

  const loans = await Collections.Loan.find(filter).sort({ startDate: -1 });

  res.json(loans.map((loan) => loan.toObject()));
}

export async function createLoan(req: Express.Request, res: Express.Response) {
  const request = req as ServiceRequest;
  const realmId = String(request.realm?._id);
  const payload = await buildLoanPayload(realmId, req.body, {
    partial: false
  });

  // save() rather than create/insertMany so the schema's createdDate/
  // updatedDate hook runs
  const loan = new Collections.Loan({ ...payload, realmId });
  await loan.save();

  res.status(201).json(loan.toObject());
}

export async function updateLoan(req: Express.Request, res: Express.Response) {
  const request = req as ServiceRequest;
  const realmId = String(request.realm?._id);
  const payload = await buildLoanPayload(realmId, req.body, { partial: true });

  // an explicit null clears an optional field - a fixed-term loan turns back
  // into an open-ended one - which only $unset expresses, since a null value
  // would reach the engine as if it were a date
  const cleared = (['endDate', 'lenderIban'] as const).filter(
    (field) => req.body[field] === null
  );

  const loan = await Collections.Loan.findOneAndUpdate(
    { _id: req.params.id, realmId },
    {
      ...payload,
      updatedDate: new Date(),
      ...(cleared.length
        ? { $unset: Object.fromEntries(cleared.map((field) => [field, 1])) }
        : {})
    },
    { new: true }
  ).lean();

  if (!loan) {
    return res.sendStatus(404);
  }
  res.json(loan);
}

export async function deleteLoan(req: Express.Request, res: Express.Response) {
  const request = req as ServiceRequest;
  const { deletedCount } = await Collections.Loan.deleteOne({
    _id: req.params.id,
    realmId: request.realm?._id
  });

  if (!deletedCount) {
    return res.sendStatus(404);
  }
  res.sendStatus(204);
}

// The full annuity plan (BR-8) behind the interest/principal split the
// cashflow analysis reports - the landlord can check month by month what the
// analysis booked as expense (interest) and what as repayment (principal).
export async function getSchedule(req: Express.Request, res: Express.Response) {
  const request = req as ServiceRequest;
  const loan = await Collections.Loan.findOne({
    _id: req.params.id,
    realmId: request.realm?._id
  }).lean();

  if (!loan) {
    return res.sendStatus(404);
  }

  const { until } = req.query;
  if (until !== undefined && !MONTH_FORMAT.test(String(until))) {
    throw new ServiceError('until must be formatted YYYY-MM', 422);
  }

  const untilMonth = until
    ? String(until)
    : moment
        .utc(loan.endDate || loan.startDate)
        .add(loan.endDate ? 0 : SCHEDULE_HORIZON_YEARS, 'years')
        .format('YYYY-MM');

  res.json(buildAmortizationSchedule(toLoanInput(loan), untilMonth));
}
