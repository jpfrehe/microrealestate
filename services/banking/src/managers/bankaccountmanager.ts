import * as Express from 'express';
import {
  AggregatorAdapter,
  BankNotSupportedError,
  ConsentDeniedError
} from '../aggregator/adapter.js';
import {
  Collections,
  Crypto,
  Service,
  ServiceError
} from '@microrealestate/common';
import {
  nextStatusAfterSyncAttempt,
  stripSecrets,
  toBankAccountRecords,
  toTransactionRecords
} from './bankaccountlogic.js';
import MockAggregatorAdapter from '../aggregator/mockadapter.js';
import { runMatchingForRealm } from './matchingmanager.js';
import { ServiceRequest } from '@microrealestate/types';

// Until a real XS2A provider is contracted (see system.md's provider
// comparison), the mock adapter lets the connect/sync/matching flow run
// end-to-end. Swapping providers only requires changing this one line.
const adapter: AggregatorAdapter = new MockAggregatorAdapter();

// Translates the adapter's domain errors (UC1's alternate flows: unsupported
// bank, denied SCA/TAN) into the HTTP status codes the landlord frontend
// needs to tell those cases apart, instead of letting them fall through to a
// generic 500 from the default error handler.
async function callAdapter<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof BankNotSupportedError) {
      throw new ServiceError(error, 422);
    }
    if (error instanceof ConsentDeniedError) {
      throw new ServiceError(error, 409);
    }
    throw error;
  }
}

////////////////////////////////////////////////////////////////////////////////
// Exported Express handlers - thin I/O wrappers around ./bankaccountlogic.js
////////////////////////////////////////////////////////////////////////////////

export async function initiateConnection(
  req: Express.Request,
  res: Express.Response
) {
  const request = req as ServiceRequest;
  const { bankId } = req.body;
  const { LANDLORD_APP_URL } = Service.getInstance().envConfig.getValues();

  const initiation = await callAdapter(
    adapter.initiateConnection({
      bankId,
      redirectUrl: `${LANDLORD_APP_URL}/${request.realm?._id}/settings/bankaccounts/callback`
    })
  );

  res.json(initiation);
}

export async function completeConnection(
  req: Express.Request,
  res: Express.Response
) {
  const { connectionId, authorizationCode } = req.body;
  const result = await callAdapter(
    adapter.completeConnection({ connectionId, authorizationCode })
  );

  // the access token never leaves the server unencrypted
  res.json({
    connectionId,
    consentExpiryDate: result.consentExpiryDate,
    accounts: result.accounts
  });
}

export async function selectAccounts(
  req: Express.Request,
  res: Express.Response
) {
  const request = req as ServiceRequest;
  const realmId = String(request.realm?._id);
  const { connectionId, authorizationCode, selections } = req.body;

  if (!Array.isArray(selections) || !selections.length) {
    throw new ServiceError('at least one account must be selected', 400);
  }

  const result = await callAdapter(
    adapter.completeConnection({ connectionId, authorizationCode })
  );

  const records = toBankAccountRecords(
    realmId,
    adapter.provider,
    result,
    selections,
    Crypto.encrypt
  );

  const bankAccounts = await Collections.BankAccount.insertMany(records);
  res.json(
    bankAccounts.map((bankAccount) => stripSecrets(bankAccount.toObject()))
  );
}

export async function listAccounts(
  req: Express.Request,
  res: Express.Response
) {
  const request = req as ServiceRequest;
  const bankAccounts = await Collections.BankAccount.find({
    realmId: request.realm?._id
  }).lean();

  res.json(bankAccounts.map(stripSecrets));
}

export async function syncAccount(req: Express.Request, res: Express.Response) {
  const request = req as ServiceRequest;
  const bankAccount = await Collections.BankAccount.findOne({
    _id: req.params.id,
    realmId: request.realm?._id
  });

  if (!bankAccount) {
    return res.sendStatus(404);
  }

  const now = new Date();
  const status = nextStatusAfterSyncAttempt(
    bankAccount.status,
    bankAccount.consentExpiryDate,
    now
  );

  if (status === 'reauth_required') {
    bankAccount.status = status;
    await bankAccount.save();
    return res.json(stripSecrets(bankAccount.toObject()));
  }

  const accessToken = Crypto.decrypt(bankAccount.encryptedAccessToken);
  const aggregatorTransactions = await adapter.listTransactions({
    accessToken,
    aggregatorAccountId: bankAccount.aggregatorAccountId,
    since: bankAccount.lastSyncDate
  });

  const records = toTransactionRecords(
    String(bankAccount.realmId),
    String(bankAccount._id),
    aggregatorTransactions
  );

  if (records.length) {
    // one bulk round-trip instead of one upsert per transaction; a
    // transaction is only ever imported once per account (unique index)
    await Collections.Transaction.bulkWrite(
      records.map((record) => ({
        updateOne: {
          filter: {
            bankAccountId: record.bankAccountId,
            aggregatorTransactionId: record.aggregatorTransactionId
          },
          update: { $setOnInsert: record },
          upsert: true
        }
      }))
    );
  }

  bankAccount.status = status;
  bankAccount.lastSyncDate = now;
  await bankAccount.save();

  // surface matching suggestions (UC2) as soon as new transactions land
  await runMatchingForRealm(String(bankAccount.realmId));

  res.json(stripSecrets(bankAccount.toObject()));
}
