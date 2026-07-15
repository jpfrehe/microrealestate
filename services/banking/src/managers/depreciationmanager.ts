import * as Express from 'express';
import { Collections, ServiceError } from '@microrealestate/common';
import { CollectionTypes, ServiceRequest } from '@microrealestate/types';
import { assertPropertyInRealm } from './loanmanager.js';
import { DepreciationInput } from './cashflowengine.js';

type DepreciationPayload = Partial<
  Pick<
    CollectionTypes.Depreciation,
    | 'propertyId'
    | 'name'
    | 'baseAmount'
    | 'rate'
    | 'startDate'
    | 'durationYears'
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

// Whitelists and validates the payload instead of handing req.body to Mongo:
// realmId/_id must not be settable by the client. baseAmount is the building
// share only - the land share is not depreciable (BR-22) - but that's a
// question the UI's help text answers, not something validation can tell.
// On PATCH only the fields actually sent are validated.
async function buildDepreciationPayload(
  realmId: string,
  body: Record<string, unknown>,
  { partial }: { partial: boolean }
): Promise<DepreciationPayload> {
  const payload: DepreciationPayload = {};
  const given = (field: string) => body[field] !== undefined;

  if (!partial || given('propertyId')) {
    payload.propertyId = await assertPropertyInRealm(realmId, body.propertyId);
  }
  if (!partial || given('name')) {
    payload.name = assertNonEmptyString(body.name, 'name');
  }
  if (!partial || given('baseAmount')) {
    payload.baseAmount = assertPositiveNumber(body.baseAmount, 'baseAmount');
  }
  if (!partial || given('rate')) {
    payload.rate = assertNonNegativeNumber(body.rate, 'rate');
  }
  if (!partial || given('startDate')) {
    payload.startDate = assertDate(body.startDate, 'startDate');
  }
  if (!partial || given('durationYears')) {
    payload.durationYears = assertPositiveNumber(
      body.durationYears,
      'durationYears'
    );
  }

  return payload;
}

// Maps a Depreciation document to the engine's plain-data input. Shared with
// cashflowmanager so both call sites feed the engine the exact same shape.
export function toDepreciationInput(
  depreciation: CollectionTypes.Depreciation
): DepreciationInput {
  return {
    _id: String(depreciation._id),
    propertyId: String(depreciation.propertyId),
    name: depreciation.name,
    baseAmount: depreciation.baseAmount,
    rate: depreciation.rate,
    startDate: depreciation.startDate,
    durationYears: depreciation.durationYears
  };
}

export async function listDepreciations(
  req: Express.Request,
  res: Express.Response
) {
  const request = req as ServiceRequest;
  const filter: Partial<
    Pick<CollectionTypes.Depreciation, 'realmId' | 'propertyId'>
  > = { realmId: request.realm?._id };
  if (typeof req.query.propertyId === 'string') {
    filter.propertyId = req.query.propertyId;
  }

  const depreciations = await Collections.Depreciation.find(filter).sort({
    startDate: -1
  });

  res.json(depreciations.map((depreciation) => depreciation.toObject()));
}

export async function createDepreciation(
  req: Express.Request,
  res: Express.Response
) {
  const request = req as ServiceRequest;
  const realmId = String(request.realm?._id);
  const payload = await buildDepreciationPayload(realmId, req.body, {
    partial: false
  });

  // save() rather than create/insertMany so the schema's createdDate/
  // updatedDate hook runs
  const depreciation = new Collections.Depreciation({ ...payload, realmId });
  await depreciation.save();

  res.status(201).json(depreciation.toObject());
}

export async function updateDepreciation(
  req: Express.Request,
  res: Express.Response
) {
  const request = req as ServiceRequest;
  const realmId = String(request.realm?._id);
  const payload = await buildDepreciationPayload(realmId, req.body, {
    partial: true
  });

  const depreciation = await Collections.Depreciation.findOneAndUpdate(
    { _id: req.params.id, realmId },
    { ...payload, updatedDate: new Date() },
    { new: true }
  ).lean();

  if (!depreciation) {
    return res.sendStatus(404);
  }
  res.json(depreciation);
}

export async function deleteDepreciation(
  req: Express.Request,
  res: Express.Response
) {
  const request = req as ServiceRequest;
  const { deletedCount } = await Collections.Depreciation.deleteOne({
    _id: req.params.id,
    realmId: request.realm?._id
  });

  if (!deletedCount) {
    return res.sendStatus(404);
  }
  res.sendStatus(204);
}
