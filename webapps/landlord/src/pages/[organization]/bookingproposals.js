import {
  fetchBankAccounts,
  fetchTenants,
  QueryKeys
} from '../../utils/restcalls';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '../../components/ui/tabs';
import { useCallback, useContext, useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { CelebrationIllustration } from '../../components/Illustrations';
import { LuRefreshCw } from 'react-icons/lu';
import { observer } from 'mobx-react-lite';
import Page from '../../components/Page';
import { StoreContext } from '../../store';
import { toast } from 'sonner';
import TransactionCard from '../../components/bookingproposals/TransactionCard';
import { useQuery } from '@tanstack/react-query';
import useTranslation from 'next-translate/useTranslation';
import { withAuthentication } from '../../components/Authentication';

const STATUSES = ['suggested', 'unmatched', 'matched', 'ignored'];

async function fetchTransactions(store, status) {
  const response = await store.banking.fetchTransactions(status);
  return response.data;
}

function BookingProposals() {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [statusFilter, setStatusFilter] = useState(STATUSES[0]);

  const transactionsQuery = useQuery({
    queryKey: [QueryKeys.TRANSACTIONS, statusFilter],
    queryFn: () => fetchTransactions(store, statusFilter),
    refetchOnMount: 'always'
  });
  const tenantsQuery = useQuery({
    queryKey: [QueryKeys.TENANTS],
    queryFn: () => fetchTenants(store),
    refetchOnMount: 'always'
  });
  const bankAccountsQuery = useQuery({
    queryKey: [QueryKeys.BANK_ACCOUNTS],
    queryFn: () => fetchBankAccounts(store),
    refetchOnMount: 'always'
  });

  useEffect(() => {
    if (bankAccountsQuery.isError) {
      toast.error(t('Something went wrong'));
    }
  }, [bankAccountsQuery.isError, t]);

  const onRunMatching = useCallback(async () => {
    const { status } = await store.banking.matchTransactions();
    if (status !== 200) {
      toast.error(t('Something went wrong'));
      return;
    }
    await transactionsQuery.refetch();
  }, [store, t, transactionsQuery]);

  const isLoading = tenantsQuery.isLoading || bankAccountsQuery.isLoading;
  const hasBankAccount = store.banking.accounts.length > 0;

  return (
    <Page
      loading={isLoading}
      ActionBar={
        <Button
          variant="outline"
          onClick={onRunMatching}
          data-cy="runMatchingButton"
        >
          <LuRefreshCw className="size-4 mr-2" />
          {t('Check for new matches')}
        </Button>
      }
      dataCy="bookingProposalsPage"
    >
      {!hasBankAccount ? (
        <div className="mb-4 text-sm text-muted-foreground">
          {t(
            'No bank account is connected yet - connect one from the organization settings to import transactions automatically.'
          )}
        </div>
      ) : null}

      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList className="flex justify-start overflow-x-auto overflow-y-hidden">
          {STATUSES.map((statusKey) => (
            <TabsTrigger key={statusKey} value={statusKey}>
              {t(`transactionStatus.${statusKey}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {STATUSES.map((statusKey) => (
          <TabsContent key={statusKey} value={statusKey}>
            {transactionsQuery.isLoading ? null : store.banking.transactions
                .length ? (
              <div className="flex flex-col gap-3 mt-4">
                {store.banking.transactions.map((transaction) => (
                  <TransactionCard
                    key={transaction._id}
                    transaction={transaction}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-4">
                <CelebrationIllustration
                  label={t('No transactions in this category')}
                />
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </Page>
  );
}

export default withAuthentication(observer(BookingProposals));
