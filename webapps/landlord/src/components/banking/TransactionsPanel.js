import {
  fetchTenants,
  fetchTransactions,
  QueryKeys
} from '../../utils/restcalls';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { useContext, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/button';
import { EmptyIllustration } from '../Illustrations';
import { LuRefreshCw } from 'react-icons/lu';
import { observer } from 'mobx-react-lite';
import { StoreContext } from '../../store';
import { toast } from 'sonner';
import TransactionCard from './TransactionCard';
import useTranslation from 'next-translate/useTranslation';

const STATUS_FILTERS = ['suggested', 'unmatched', 'matched', 'ignored'];

function TransactionsPanel() {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('suggested');
  const [matching, setMatching] = useState(false);

  const { isError, isLoading } = useQuery({
    queryKey: [QueryKeys.TRANSACTIONS, status],
    queryFn: () => fetchTransactions(store, status)
  });
  useQuery({
    queryKey: [QueryKeys.TENANTS],
    queryFn: () => fetchTenants(store)
  });

  if (isError) {
    toast.error(t('Error fetching transactions'));
  }

  const handleRefreshMatching = async () => {
    setMatching(true);
    const { status: requestStatus } = await store.banking.matchTransactions();
    setMatching(false);
    if (requestStatus !== 200) {
      toast.error(t('Something went wrong'));
      return;
    }
    queryClient.invalidateQueries({ queryKey: [QueryKeys.TRANSACTIONS] });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col-reverse gap-2 md:flex-row md:items-center md:justify-between">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="md:w-64" data-cy="transactionStatusSelect">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(
                  {
                    suggested: 'Suggested matches',
                    unmatched: 'Not matched',
                    matched: 'Matched',
                    ignored: 'Ignored'
                  }[value]
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={handleRefreshMatching}
          disabled={matching}
        >
          <LuRefreshCw
            className={matching ? 'size-4 animate-spin' : 'size-4'}
          />
          {t('Re-check matches')}
        </Button>
      </div>

      {!isLoading && store.banking.transactions.length ? (
        <div className="space-y-3">
          {store.banking.transactions.map((transaction) => (
            <TransactionCard key={transaction._id} transaction={transaction} />
          ))}
        </div>
      ) : !isLoading ? (
        <EmptyIllustration label={t('No transactions in this view')} />
      ) : null}
    </div>
  );
}

export default observer(TransactionsPanel);
