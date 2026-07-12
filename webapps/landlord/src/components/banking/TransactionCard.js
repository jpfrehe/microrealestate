import { Card, CardContent } from '../ui/card';
import { useCallback, useContext, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import ManualMatchDialog from './ManualMatchDialog';
import moment from 'moment';
import NumberFormat from '../NumberFormat';
import { observer } from 'mobx-react-lite';
import { StoreContext } from '../../store';
import { toast } from 'sonner';
import useTranslation from 'next-translate/useTranslation';

const STATUS_VARIANTS = {
  unmatched: 'outline',
  suggested: 'secondary',
  matched: 'success',
  ignored: 'outline'
};

const STATUS_LABELS = {
  unmatched: 'Not matched',
  suggested: 'Suggested match',
  matched: 'Matched',
  ignored: 'Ignored'
};

function CandidateRow({ transactionId, candidate }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = useCallback(async () => {
    setConfirming(true);
    const { status } = await store.banking.confirmMatch(
      transactionId,
      candidate.tenantId,
      candidate.term
    );
    setConfirming(false);
    if (status === 409) {
      toast.error(t('This transaction was already matched'));
      return;
    }
    if (status !== 200) {
      toast.error(t('Something went wrong'));
      return;
    }
    toast.success(t('Payment recorded'));
  }, [candidate.tenantId, candidate.term, store, t, transactionId]);

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="font-medium">{candidate.tenantName}</div>
        <div className="text-xs text-muted-foreground">
          {moment(String(candidate.term), 'YYYYMMDDHH').format('MMMM YYYY')} ·{' '}
          {t('Open balance')}:{' '}
          <NumberFormat value={candidate.openAmount} className="inline" />
        </div>
        <div className="text-xs text-muted-foreground">{candidate.reason}</div>
      </div>
      <Button
        size="sm"
        onClick={handleConfirm}
        disabled={confirming}
        data-cy="confirmMatchButton"
      >
        {t('Confirm')}
      </Button>
    </div>
  );
}

function TransactionCard({ transaction }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [openManualMatch, setOpenManualMatch] = useState(false);

  const handleIgnore = useCallback(async () => {
    const { status } = await store.banking.ignoreTransaction(transaction._id);
    if (status === 409) {
      toast.error(t('This transaction was already matched'));
      return;
    }
    if (status !== 200) {
      toast.error(t('Something went wrong'));
    }
  }, [store, t, transaction._id]);

  return (
    <Card data-cy="transactionCard">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <NumberFormat
              value={transaction.amount}
              withColor
              className="text-lg font-medium"
            />
            <div className="text-xs text-muted-foreground">
              {moment(transaction.bookingDate).format('L')}
            </div>
          </div>
          <Badge
            variant={STATUS_VARIANTS[transaction.matchStatus] || 'outline'}
          >
            {t(
              STATUS_LABELS[transaction.matchStatus] || transaction.matchStatus
            )}
          </Badge>
        </div>

        <div className="text-sm">{transaction.remittanceInformation}</div>

        {transaction.matchStatus === 'suggested' ? (
          <div className="space-y-2">
            {transaction.matchCandidates.map((candidate) => (
              <CandidateRow
                key={`${candidate.tenantId}-${candidate.term}`}
                transactionId={transaction._id}
                candidate={candidate}
              />
            ))}
          </div>
        ) : null}

        {transaction.matchStatus === 'matched' ? (
          <div className="text-xs text-muted-foreground">
            {t('Matched to {{tenant}} for {{term}}', {
              tenant: transaction.matchedTenantId,
              term: moment(
                String(transaction.matchedTerm),
                'YYYYMMDDHH'
              ).format('MMMM YYYY')
            })}
          </div>
        ) : null}

        {transaction.matchStatus === 'unmatched' ||
        transaction.matchStatus === 'suggested' ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpenManualMatch(true)}
              data-cy="manualMatchButton"
            >
              {t('Assign manually')}
            </Button>
            <Button size="sm" variant="outline" onClick={handleIgnore}>
              {t('Ignore')}
            </Button>
          </div>
        ) : null}
      </CardContent>

      <ManualMatchDialog
        open={openManualMatch}
        setOpen={setOpenManualMatch}
        transactionId={transaction._id}
      />
    </Card>
  );
}

export default observer(TransactionCard);
