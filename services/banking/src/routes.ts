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
  bankAccountsRouter.post(
    '/:id/sync',
    Middlewares.asyncWrapper(bankAccountManager.syncAccount)
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
