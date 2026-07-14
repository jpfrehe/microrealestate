import * as bankAccountManager from './managers/bankaccountmanager.js';
import * as matchingManager from './managers/matchingmanager.js';
import { Middlewares, Service } from '@microrealestate/common';
import express from 'express';

export default function routes() {
  const { ACCESS_TOKEN_SECRET } = Service.getInstance().envConfig.getValues();
  const router = express.Router();
  router.use(
    Middlewares.needAccessToken(ACCESS_TOKEN_SECRET),
    Middlewares.checkOrganization(),
    Middlewares.notRoles(['tenant'])
  );

  router.get('/banks', Middlewares.asyncWrapper(bankAccountManager.listBanks));

  const bankAccountsRouter = express.Router();
  bankAccountsRouter.get(
    '/',
    Middlewares.asyncWrapper(bankAccountManager.listAccounts)
  );
  bankAccountsRouter.post(
    '/connect',
    Middlewares.asyncWrapper(bankAccountManager.initiateConnection)
  );
  bankAccountsRouter.post(
    '/connect/complete',
    Middlewares.asyncWrapper(bankAccountManager.completeConnection)
  );
  bankAccountsRouter.post(
    '/connect/select',
    Middlewares.asyncWrapper(bankAccountManager.selectAccounts)
  );
  bankAccountsRouter.patch(
    '/:id',
    Middlewares.asyncWrapper(bankAccountManager.updateAccount)
  );
  bankAccountsRouter.post(
    '/:id/disconnect',
    Middlewares.asyncWrapper(bankAccountManager.disconnectAccount)
  );
  bankAccountsRouter.post(
    '/:id/sync',
    Middlewares.asyncWrapper(bankAccountManager.syncAccount)
  );
  bankAccountsRouter.get(
    '/:id/balance',
    Middlewares.asyncWrapper(bankAccountManager.getBalance)
  );
  router.use('/bankaccounts', bankAccountsRouter);

  const transactionsRouter = express.Router();
  transactionsRouter.get(
    '/',
    Middlewares.asyncWrapper(matchingManager.listTransactions)
  );
  transactionsRouter.post(
    '/match',
    Middlewares.asyncWrapper(matchingManager.matchTransactions)
  );
  transactionsRouter.post(
    '/:id/confirm',
    Middlewares.asyncWrapper(matchingManager.confirmMatch)
  );
  transactionsRouter.post(
    '/:id/ignore',
    Middlewares.asyncWrapper(matchingManager.ignoreTransaction)
  );
  router.use('/transactions', transactionsRouter);

  const bankingRouter = express.Router();
  bankingRouter.use('/banking', router);

  return bankingRouter;
}
