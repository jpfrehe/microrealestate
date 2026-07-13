import { useCallback, useContext, useState } from 'react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { LuRefreshCw } from 'react-icons/lu';
import moment from 'moment';
import { observer } from 'mobx-react-lite';
import { StoreContext } from '../../../store';
import useTranslation from 'next-translate/useTranslation';

const STATUS_VARIANTS = {
  connected: 'success',
  pending: 'secondary',
  reauth_required: 'destructive',
  disconnected: 'outline'
};

const STATUS_LABELS = {
  connected: 'Connected',
  pending: 'Pending',
  reauth_required: 'Re-authorization required',
  disconnected: 'Disconnected'
};

function BankAccountRow({ bankAccount }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [syncing, setSyncing] = useState(false);

  const propertyNames = (bankAccount.propertyIds || [])
    .map((id) => store.property.items.find((p) => p._id === id)?.name)
    .filter(Boolean);

  const onSync = useCallback(async () => {
    setSyncing(true);
    await store.bankAccount.sync(bankAccount._id);
    setSyncing(false);
  }, [store, bankAccount._id]);

  return (
    <div className="border rounded p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{bankAccount.bankName}</div>
          <div className="text-sm text-muted-foreground">
            {bankAccount.iban}
          </div>
        </div>
        <Badge variant={STATUS_VARIANTS[bankAccount.status]}>
          {t(STATUS_LABELS[bankAccount.status])}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground">
        {t('Assigned properties')}:{' '}
        {propertyNames.length ? propertyNames.join(', ') : t('All properties')}
      </div>
      {bankAccount.consentExpiryDate ? (
        <div className="text-xs text-muted-foreground">
          {t('Consent expires on {{date}}', {
            date: moment(bankAccount.consentExpiryDate).format('L')
          })}
        </div>
      ) : null}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {t('Last sync')}:{' '}
          {bankAccount.lastSyncDate
            ? moment(bankAccount.lastSyncDate).format('L LT')
            : '-'}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={onSync}
          disabled={syncing || bankAccount.status === 'disconnected'}
        >
          <LuRefreshCw
            className={`size-4 mr-1 ${syncing ? 'animate-spin' : ''}`}
          />
          {t('Sync now')}
        </Button>
      </div>
    </div>
  );
}

function BankAccountList() {
  const store = useContext(StoreContext);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {store.bankAccount.items.map((bankAccount) => (
        <BankAccountRow key={bankAccount._id} bankAccount={bankAccount} />
      ))}
    </div>
  );
}

export default observer(BankAccountList);
