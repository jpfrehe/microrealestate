import * as Express from 'express';
import { Collections, Crypto, Service } from '@microrealestate/common';
import {
  nextStatusAfterSyncAttempt,
  stripSecrets,
  toBankAccountRecords,
  toTransactionRecords
} from './bankaccountlogic.js';
import { AggregatorAdapter } from '../aggregator/adapter.js';
import MockAggregatorAdapter from '../aggregator/mockadapter.js';
import { ServiceRequest } from '@microrealestate/types';

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
    redirectUrl: `${LANDLORD_APP_URL}/${request.realm?._id}/settings/bankaccounts/callback`
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

export async function syncAccount(
  req: Express.Request,
  res: Express.Response
) {
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

  res.json(stripSecrets(bankAccount.toObject()));
}
