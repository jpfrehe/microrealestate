import * as Express from 'express';
import {
  buildOpenRentClaims,
  determineMatchStatus,
  findMatchCandidates
} from './matchingengine.js';
import { Collections, logger, Service } from '@microrealestate/common';
import { CollectionTypes, ServiceRequest } from '@microrealestate/types';
import axios from 'axios';
import moment from 'moment';

// Recomputes match suggestions for every 'unmatched' transaction of a realm.
// Called after a bank sync (see bankaccountmanager.syncAccount) and can also
// be triggered on demand via POST /banking/transactions/match.
export async function runMatchingForRealm(realmId: string): Promise<void> {
  const [unmatchedTransactions, tenants, knownIbansByTenant] =
    await Promise.all([
      Collections.Transaction.find({ realmId, matchStatus: 'unmatched' }),
      Collections.Tenant.find({ realmId }).lean(),
      buildKnownPayerIbansByTenant(realmId)
    ]);

  if (!unmatchedTransactions.length) {
    return;
  }

  const openClaims = buildOpenRentClaims(tenants, knownIbansByTenant);

  for (const transaction of unmatchedTransactions) {
    const candidates = findMatchCandidates(
      {
        amount: transaction.amount,
        remittanceInformation: transaction.remittanceInformation,
        counterpartyIban: transaction.counterpartyIban
      },
      openClaims
    );

    transaction.matchCandidates = candidates;
    transaction.matchStatus = determineMatchStatus(candidates);
    await transaction.save();
  }
}

// Every distinct payer IBAN seen on this realm's previously confirmed
// matches, grouped by tenant - lets findMatchCandidates recognize a
// recurring payer even when a transaction's remittance text is unhelpful.
async function buildKnownPayerIbansByTenant(
  realmId: string
): Promise<Record<string, string[]>> {
  const rows = await Collections.Transaction.aggregate<{
    _id: string;
    ibans: string[];
  }>([
    {
      $match: {
        realmId,
        matchStatus: 'matched',
        matchedTenantId: { $ne: null },
        counterpartyIban: { $nin: [null, ''] }
      }
    },
    {
      $group: {
        _id: '$matchedTenantId',
        ibans: { $addToSet: '$counterpartyIban' }
      }
    }
  ]);

  return Object.fromEntries(rows.map((row) => [row._id, row.ibans]));
}

export async function matchTransactions(
  req: Express.Request,
  res: Express.Response
) {
  const request = req as ServiceRequest;
  await runMatchingForRealm(String(request.realm?._id));
  res.sendStatus(204);
}

export async function listTransactions(
  req: Express.Request,
  res: Express.Response
) {
  const request = req as ServiceRequest;
  const filter: Partial<
    Pick<CollectionTypes.Transaction, 'realmId' | 'matchStatus'>
  > = { realmId: request.realm?._id };
  if (typeof req.query.status === 'string') {
    filter.matchStatus = req.query
      .status as CollectionTypes.Transaction['matchStatus'];
  }

  const transactions = await Collections.Transaction.find(filter)
    .sort({ bookingDate: -1 })
    .lean();

  res.json(transactions);
}

export async function confirmMatch(
  req: Express.Request,
  res: Express.Response
) {
  const request = req as ServiceRequest;
  const { tenantId, term } = req.body;

  const transaction = await Collections.Transaction.findOne({
    _id: req.params.id,
    realmId: request.realm?._id
  });
  if (!transaction) {
    return res.sendStatus(404);
  }
  if (transaction.matchStatus === 'matched') {
    return res.status(409).json({ message: 'transaction already matched' });
  }

  const candidate = transaction.matchCandidates.find(
    (c) => c.tenantId === tenantId && c.term === Number(term)
  );
  if (!candidate) {
    return res
      .status(400)
      .json({ message: 'tenantId/term is not a suggested candidate' });
  }

  const { API_URL } = Service.getInstance().envConfig.getValues();
  try {
    await axios.patch(
      `${API_URL}/rents/payment/${tenantId}/${term}`,
      {
        _id: tenantId,
        payments: [
          {
            date: moment(transaction.valueDate).format('DD/MM/YYYY'),
            amount: transaction.amount,
            type: 'transfer',
            reference: transaction.aggregatorTransactionId,
            description: `Automatischer Bankabgleich: ${transaction.remittanceInformation}`
          }
        ]
      },
      {
        headers: {
          authorization: req.headers.authorization,
          organizationid: req.headers.organizationid,
          'Accept-Language': req.headers['accept-language']
        }
      }
    );
  } catch (error) {
    logger.error(String(error));
    throw error;
  }

  transaction.matchStatus = 'matched';
  transaction.matchedTenantId = tenantId;
  transaction.matchedTerm = Number(term);
  await transaction.save();

  res.json(transaction.toObject());
}

export async function ignoreTransaction(
  req: Express.Request,
  res: Express.Response
) {
  const request = req as ServiceRequest;
  const transaction = await Collections.Transaction.findOneAndUpdate(
    { _id: req.params.id, realmId: request.realm?._id },
    { matchStatus: 'ignored' },
    { new: true }
  ).lean();

  if (!transaction) {
    return res.sendStatus(404);
  }
  res.json(transaction);
}
