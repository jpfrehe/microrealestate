import { Card, CardContent } from '../ui/card';
import { LuLink2Off, LuPencil, LuRefreshCw } from 'react-icons/lu';
import { useCallback, useContext, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import ConfirmDialog from '../ConfirmDialog';
import { Label } from '../ui/label';
import { observer } from 'mobx-react-lite';
import ResponsiveDialog from '../ResponsiveDialog';
import { StoreContext } from '../../store';
import { toast } from 'sonner';
import useTranslation from 'next-translate/useTranslation';

const STATUS_VARIANTS = {
  connected: 'success',
  reauth_required: 'destructive',
  disconnected: 'secondary',
  pending: 'outline'
};

const STATUS_LABELS = {
  connected: 'Connected',
  reauth_required: 'Reauthorization required',
  disconnected: 'Disconnected',
  pending: 'Pending'
};

function EditPropertiesDialog({ open, setOpen, bankAccount }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [propertyIds, setPropertyIds] = useState(bankAccount.propertyIds || []);
  const [saving, setSaving] = useState(false);

  const toggleProperty = useCallback((propertyId, checked) => {
    setPropertyIds((current) =>
      checked
        ? [...current, propertyId]
        : current.filter((id) => id !== propertyId)
    );
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const { status } = await store.banking.updateAccount(
      bankAccount._id,
      propertyIds
    );
    setSaving(false);
    if (status !== 200) {
      toast.error(t('Something went wrong'));
      return;
    }
    setOpen(false);
  }, [bankAccount._id, propertyIds, setOpen, store, t]);

  return (
    <ResponsiveDialog
      open={open}
      setOpen={setOpen}
      isLoading={saving}
      renderHeader={() => <span>{t('Assign properties')}</span>}
      renderContent={() => (
        <div className="flex flex-wrap gap-4">
          {store.property.items.map((property) => (
            <div key={property._id} className="flex items-center gap-2">
              <Checkbox
                id={`edit-${bankAccount._id}-${property._id}`}
                checked={propertyIds.includes(property._id)}
                onCheckedChange={(checked) =>
                  toggleProperty(property._id, checked)
                }
              />
              <Label htmlFor={`edit-${bankAccount._id}-${property._id}`}>
                {property.name}
              </Label>
            </div>
          ))}
        </div>
      )}
      renderFooter={() => (
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={handleSave}>{t('Save')}</Button>
        </>
      )}
    />
  );
}

function BankAccountCard({ bankAccount, onReconnect }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [syncing, setSyncing] = useState(false);
  const [openEditProperties, setOpenEditProperties] = useState(false);
  const [openConfirmDisconnect, setOpenConfirmDisconnect] = useState(false);

  const propertyNames = (bankAccount.propertyIds || [])
    .map((id) => store.property.items.find((p) => p._id === id)?.name)
    .filter(Boolean);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    const { status } = await store.banking.syncAccount(bankAccount._id);
    setSyncing(false);
    if (status !== 200) {
      toast.error(t('Something went wrong'));
      return;
    }
    toast.success(t('Bank account synchronized'));
  }, [bankAccount._id, store, t]);

  const handleDisconnect = useCallback(async () => {
    const { status } = await store.banking.disconnectAccount(bankAccount._id);
    if (status !== 200) {
      toast.error(t('Something went wrong'));
    }
  }, [bankAccount._id, store, t]);

  const isConnected = bankAccount.status === 'connected';
  const needsReauth = bankAccount.status === 'reauth_required';

  return (
    <Card data-cy="bankAccountCard">
      <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-medium">
              {bankAccount.bankName}
            </span>
            <Badge variant={STATUS_VARIANTS[bankAccount.status] || 'outline'}>
              {t(STATUS_LABELS[bankAccount.status] || bankAccount.status)}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground">
            {bankAccount.iban}
          </div>
          <div className="text-xs text-muted-foreground">
            {propertyNames.length
              ? propertyNames.join(', ')
              : t('Applies to the whole organization')}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {needsReauth ? (
            <Button size="sm" onClick={onReconnect} data-cy="reconnectButton">
              {t('Reconnect')}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={!isConnected || syncing}
            onClick={handleSync}
            data-cy="syncBankAccountButton"
          >
            <LuRefreshCw
              className={syncing ? 'size-4 animate-spin' : 'size-4'}
            />
            {t('Sync now')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpenEditProperties(true)}
          >
            <LuPencil className="size-4" />
            {t('Properties')}
          </Button>
          {bankAccount.status !== 'disconnected' ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpenConfirmDisconnect(true)}
              data-cy="disconnectBankAccountButton"
            >
              <LuLink2Off className="size-4" />
              {t('Disconnect')}
            </Button>
          ) : null}
        </div>
      </CardContent>
      <EditPropertiesDialog
        open={openEditProperties}
        setOpen={setOpenEditProperties}
        bankAccount={bankAccount}
      />
      <ConfirmDialog
        title={t('Disconnect this bank account?')}
        subTitle={t(
          'Future transactions will no longer be imported. Previously imported transactions are kept.'
        )}
        open={openConfirmDisconnect}
        setOpen={setOpenConfirmDisconnect}
        onConfirm={handleDisconnect}
      />
    </Card>
  );
}

export default observer(BankAccountCard);
