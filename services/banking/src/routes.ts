import * as bankAccountManager from './managers/bankaccountmanager.js';
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

  const bankingRouter = express.Router();
  bankingRouter.use('/banking', router);

  return bankingRouter;
}
