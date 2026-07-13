import * as Express from 'express';
import { Collections, Crypto, Service } from '@microrealestate/common';
import { CollectionTypes, ServiceRequest } from '@microrealestate/types';
import {
  nextStatusAfterSyncAttempt,
  stripSecrets,
  toBankAccountRecords,
  toTransactionRecords
} from './bankaccountlogic.js';
import { AggregatorAdapter } from '../aggregator/adapter.js';
import MockAggregatorAdapter from '../aggregator/mockadapter.js';
import mongoose from 'mongoose';
import { runMatchingForRealm } from './matchingmanager.js';

// Until a real XS2A provider is contracted (see system.md's provider
// comparison), the mock adapter lets the connect/sync/matching flow run
// end-to-end. Swapping providers only requires changing this one line.
const adapter: AggregatorAdapter = new MockAggregatorAdapter();

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

  const initiation = await adapter.initiateConnection({
    bankId,
    // the landlord frontend's dynamic route segment is the realm's name
    // slug (see webapps/landlord's [organization] pages), not its _id
    redirectUrl: `${LANDLORD_APP_URL}/${request.realm?.name}/settings/bankaccounts/callback`
  });

  res.json(initiation);
}

export async function completeConnection(
  req: Express.Request,
  res: Express.Response
) {
  const { connectionId, authorizationCode } = req.body;
  const result = await adapter.completeConnection({
    connectionId,
    authorizationCode
  });

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

  const result = await adapter.completeConnection({
    connectionId,
    authorizationCode
  });

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

// matches what both Collections.BankAccount.findOne and .find(...) resolve
// each document to, so syncBankAccount works with either call site
export type BankAccountDoc =
  mongoose.HydratedDocument<CollectionTypes.BankAccount>;

// Shared by the on-demand POST /:id/sync route and the scheduled sync job
// (syncjob.ts) - mutates and persists the given bank account in place.
export async function syncBankAccount(
  bankAccount: BankAccountDoc,
  now: Date = new Date()
): Promise<void> {
  const status = nextStatusAfterSyncAttempt(
    bankAccount.status,
    bankAccount.consentExpiryDate,
    now
  );

  if (status === 'reauth_required') {
    bankAccount.status = status;
    await bankAccount.save();
    return;
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

  for (const record of records) {
    // a transaction is only ever imported once per account
    await Collections.Transaction.updateOne(
      {
        bankAccountId: record.bankAccountId,
        aggregatorTransactionId: record.aggregatorTransactionId
      },
      { $setOnInsert: record },
      { upsert: true }
    );
  }

  bankAccount.status = status;
  bankAccount.lastSyncDate = now;
  await bankAccount.save();

  // surface matching suggestions (UC2) as soon as new transactions land
  await runMatchingForRealm(String(bankAccount.realmId));
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

  await syncBankAccount(bankAccount);

  res.json(stripSecrets(bankAccount.toObject()));
}
