import { Card, CardContent } from '../ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { useCallback, useContext, useMemo, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import moment from 'moment';
import NumberFormat from '../NumberFormat';
import { observer } from 'mobx-react-lite';
import { StoreContext } from '../../store';
import { toast } from 'sonner';
import useTranslation from 'next-translate/useTranslation';

function confidenceVariant(confidence) {
  if (confidence >= 0.8) return 'success';
  if (confidence >= 0.5) return 'secondary';
  return 'outline';
}

function ManualAssignment({ transaction }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [tenantId, setTenantId] = useState('');
  const [term, setTerm] = useState('');

  const tenantValues = useMemo(
    () =>
      store.tenant.items.map((tenant) => ({
        id: tenant._id,
        value: tenant._id,
        label: tenant.name
      })),
    [store.tenant.items]
  );

  const selectedTenant = store.tenant.items.find((t) => t._id === tenantId);
  const termValues = useMemo(
    () =>
      (selectedTenant?.rents || [])
        .slice()
        .sort((a, b) => b.term - a.term)
        .map((rent) => ({
          id: String(rent.term),
          value: String(rent.term),
          label: `${moment(rent.term, 'YYYYMMDDHH').format('MMMM YYYY')} (${
            rent.total.payment < rent.total.grandTotal ? t('open') : t('paid')
          })`
        })),
    [selectedTenant, t]
  );

  const onConfirm = useCallback(async () => {
    if (!tenantId || !term) {
      return;
    }
    const { status, message } = await store.banking.confirmMatch(
      transaction._id,
      tenantId,
      term
    );
    if (status !== 200) {
      toast.error(message || t('Something went wrong'));
      return;
    }
    toast.success(t('Payment confirmed'));
  }, [store, transaction._id, tenantId, term, t]);

  return (
    <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
      <Select
        value={tenantId}
        onValueChange={(value) => {
          setTenantId(value);
          setTerm('');
        }}
      >
        <SelectTrigger className="sm:w-56">
          <SelectValue placeholder={t('Select a tenant')} />
        </SelectTrigger>
        <SelectContent>
          {tenantValues.map(({ id, value, label }) => (
            <SelectItem key={id} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={term} onValueChange={setTerm} disabled={!tenantId}>
        <SelectTrigger className="sm:w-48">
          <SelectValue placeholder={t('Select a period')} />
        </SelectTrigger>
        <SelectContent>
          {termValues.map(({ id, value, label }) => (
            <SelectItem key={id} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        onClick={onConfirm}
        disabled={!tenantId || !term}
        data-cy="manualAssignConfirmButton"
      >
        {t('Assign')}
      </Button>
    </div>
  );
}

function TransactionCard({ transaction }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);

  const onConfirmCandidate = useCallback(
    async (candidate) => {
      const { status, message } = await store.banking.confirmMatch(
        transaction._id,
        candidate.tenantId,
        candidate.term
      );
      if (status !== 200) {
        toast.error(message || t('Something went wrong'));
        return;
      }
      toast.success(t('Payment confirmed'));
    },
    [store, transaction._id, t]
  );

  const onIgnore = useCallback(async () => {
    const { status } = await store.banking.ignoreTransaction(transaction._id);
    if (status !== 200) {
      toast.error(t('Something went wrong'));
    }
  }, [store, transaction._id, t]);

  return (
    <Card>
      <CardContent className="p-4 flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <div>
            <div className="font-medium">
              {transaction.counterpartyName || t('Unknown sender')}
            </div>
            <div className="text-sm text-muted-foreground">
              {transaction.remittanceInformation || t('No reference')}
            </div>
            <div className="text-xs text-muted-foreground">
              {transaction.counterpartyIban} &middot;{' '}
              {moment(transaction.valueDate).format('L')}
            </div>
          </div>
          <NumberFormat
            value={transaction.amount}
            className="text-xl font-medium"
          />
        </div>

        {transaction.matchStatus === 'suggested' &&
        transaction.matchCandidates?.length ? (
          <div className="flex flex-col gap-2">
            {transaction.matchCandidates.map((candidate) => (
              <div
                key={`${candidate.tenantId}-${candidate.term}`}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border rounded p-2"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{candidate.tenantName}</span>
                    <Badge variant={confidenceVariant(candidate.confidence)}>
                      {Math.round(candidate.confidence * 100)}%
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {moment(candidate.term, 'YYYYMMDDHH').format('MMMM YYYY')}{' '}
                    &middot; {t('Open amount')}:{' '}
                    <NumberFormat
                      value={candidate.openAmount}
                      className="inline"
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {candidate.reason}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => onConfirmCandidate(candidate)}
                  data-cy="confirmCandidateButton"
                >
                  {t('Confirm')}
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        {transaction.matchStatus === 'unmatched' ? (
          <ManualAssignment transaction={transaction} />
        ) : null}

        {transaction.matchStatus === 'matched' ? (
          <div className="text-sm text-success">
            {t('Matched to {{tenantName}} ({{period}})', {
              tenantName:
                transaction.matchCandidates?.find(
                  (c) =>
                    c.tenantId === transaction.matchedTenantId &&
                    c.term === transaction.matchedTerm
                )?.tenantName || transaction.matchedTenantId,
              period: moment(transaction.matchedTerm, 'YYYYMMDDHH').format(
                'MMMM YYYY'
              )
            })}
          </div>
        ) : null}

        {transaction.matchStatus === 'suggested' ||
        transaction.matchStatus === 'unmatched' ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={onIgnore}
              data-cy="ignoreTransactionButton"
            >
              {t('Ignore')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default observer(TransactionCard);
