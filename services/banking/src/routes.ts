import * as bankAccountManager from './managers/bankaccountmanager.js';
import * as cashflowManager from './managers/cashflowmanager.js';
import * as depreciationManager from './managers/depreciationmanager.js';
import * as loanManager from './managers/loanmanager.js';
import * as matchingManager from './managers/matchingmanager.js';
import { Middlewares, Service } from '@microrealestate/common';
import express from 'express';
import rateLimit from 'express-rate-limit';

// Complements the persisted lastBalanceFetchDate cooldown in
// bankaccountmanager.getBalance (which rate-limits per account across
// service instances) with a per-IP window, matching CodeQL's expected
// rate-limiting pattern for a DB-accessing route (js/missing-rate-limiting).
const balanceRateLimiter = rateLimit({
  windowMs: 30 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

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
    balanceRateLimiter,
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
  transactionsRouter.patch(
    '/:id/category',
    Middlewares.asyncWrapper(cashflowManager.updateTransactionCategory)
  );
  router.use('/transactions', transactionsRouter);

  router.get(
    '/cashflow',
    Middlewares.asyncWrapper(cashflowManager.getCashflow)
  );

  const loansRouter = express.Router();
  loansRouter.get('/', Middlewares.asyncWrapper(loanManager.listLoans));
  loansRouter.post('/', Middlewares.asyncWrapper(loanManager.createLoan));
  loansRouter.patch('/:id', Middlewares.asyncWrapper(loanManager.updateLoan));
  loansRouter.delete('/:id', Middlewares.asyncWrapper(loanManager.deleteLoan));
  loansRouter.get(
    '/:id/schedule',
    Middlewares.asyncWrapper(loanManager.getSchedule)
  );
  router.use('/loans', loansRouter);

  const depreciationsRouter = express.Router();
  depreciationsRouter.get(
    '/',
    Middlewares.asyncWrapper(depreciationManager.listDepreciations)
  );
  depreciationsRouter.post(
    '/',
    Middlewares.asyncWrapper(depreciationManager.createDepreciation)
  );
  depreciationsRouter.patch(
    '/:id',
    Middlewares.asyncWrapper(depreciationManager.updateDepreciation)
  );
  depreciationsRouter.delete(
    '/:id',
    Middlewares.asyncWrapper(depreciationManager.deleteDepreciation)
  );
  router.use('/depreciations', depreciationsRouter);

  const bankingRouter = express.Router();
  bankingRouter.use('/banking', router);

  return bankingRouter;
}
