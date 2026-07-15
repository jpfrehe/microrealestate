import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { CATEGORIES, CATEGORY_LABELS } from './labels';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { useCallback, useContext } from 'react';
import { Badge } from '../ui/badge';
import { cn } from '../../utils';
import { EmptyIllustration } from '../Illustrations';
import { LuListChecks } from 'react-icons/lu';
import moment from 'moment';
import NumberFormat from '../NumberFormat';
import { QueryKeys } from '../../utils/restcalls';
import { StoreContext } from '../../store';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import useTranslation from 'next-translate/useTranslation';

// Radix has no notion of an empty option, so the "back to automatic" choice
// needs a value of its own. It maps to `category: null` on the wire.
const AUTOMATIC = '__automatic__';

const GROUP_VARIANTS = {
  income: 'success',
  expense: 'secondary',
  noncash: 'outline',
  neutral: 'outline'
};

function TransactionRow({ transaction }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const queryClient = useQueryClient();

  const isUnclassified = transaction.category === 'uncategorized';

  const handleCategoryChange = useCallback(
    async (value) => {
      const { status } = await store.cashflow.updateTransactionCategory(
        transaction._id,
        value === AUTOMATIC ? null : value
      );
      if (status !== 200) {
        toast.error(t('Something went wrong'));
        return;
      }
      // The whole analysis depends on this category, not just the row.
      queryClient.invalidateQueries({ queryKey: [QueryKeys.CASHFLOW] });
    },
    [queryClient, store, t, transaction._id]
  );

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-md border p-3 md:flex-row md:items-center md:justify-between',
        isUnclassified ? 'border-warning' : ''
      )}
      data-cy="cashflowTransactionRow"
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={GROUP_VARIANTS[transaction.categoryGroup]}>
            {t(CATEGORY_LABELS[transaction.category] || transaction.category)}
          </Badge>
          {isUnclassified ? (
            <span className="text-xs text-warning">{t('Needs review')}</span>
          ) : null}
          {transaction.propertyName ? (
            <span className="text-xs text-muted-foreground">
              {transaction.propertyName}
            </span>
          ) : null}
        </div>
        <div className="font-medium">
          {transaction.counterpartyName || t('Unknown counterparty')}
        </div>
        <div className="text-sm text-muted-foreground break-words">
          {transaction.remittanceInformation}
        </div>
        <div className="text-xs text-muted-foreground">
          {moment(transaction.valueDate).format('L')}
        </div>
        {transaction.category === 'loan_rate' ? (
          <div className="flex flex-wrap items-center gap-x-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {t('Loan interest')}
              <NumberFormat
                value={transaction.interestPortion}
                showZero={true}
                className="inline text-xs"
              />
            </span>
            <span className="flex items-center gap-1">
              {t('Loan principal repayment')}
              <NumberFormat
                value={transaction.principalPortion}
                showZero={true}
                className="inline text-xs"
              />
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-4 md:flex-col md:items-end">
        <NumberFormat
          value={transaction.amount}
          withColor
          className="text-lg font-medium"
        />
        <Select
          value={
            transaction.categorySource === 'manual'
              ? transaction.category
              : AUTOMATIC
          }
          onValueChange={handleCategoryChange}
        >
          <SelectTrigger className="w-56" data-cy="transactionCategorySelect">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTOMATIC}>
              {t('Detected automatically')}
            </SelectItem>
            {CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                {t(CATEGORY_LABELS[category])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export default function TransactionCategoryList({ transactions = [] }) {
  const { t } = useTranslation('common');

  return (
    <Card data-cy="transactionCategoryList">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
          <LuListChecks className="size-6 text-muted-foreground" />
          {t('Transactions of the month')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {transactions.length ? (
          <div className="space-y-3">
            {transactions.map((transaction) => (
              <TransactionRow key={transaction._id} transaction={transaction} />
            ))}
          </div>
        ) : (
          <EmptyIllustration label={t('No transactions in this month')} />
        )}
      </CardContent>
    </Card>
  );
}
