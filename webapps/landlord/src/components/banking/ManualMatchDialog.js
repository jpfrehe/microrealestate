import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { useCallback, useContext, useEffect, useState } from 'react';
import { Button } from '../ui/button';
import moment from 'moment';
import NumberFormat from '../NumberFormat';
import { observer } from 'mobx-react-lite';
import ResponsiveDialog from '../ResponsiveDialog';
import { StoreContext } from '../../store';
import { toast } from 'sonner';
import useTranslation from 'next-translate/useTranslation';

function ManualMatchDialog({ open, setOpen, transactionId }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [tenantId, setTenantId] = useState('');
  const [openRents, setOpenRents] = useState([]);
  const [term, setTerm] = useState('');
  const [loadingRents, setLoadingRents] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setTenantId('');
      setOpenRents([]);
      setTerm('');
    }
  }, [open]);

  const handleTenantChange = useCallback(
    async (newTenantId) => {
      setTenantId(newTenantId);
      setTerm('');
      setLoadingRents(true);
      const { status, data } = await store.rent.fetchTenantRents(newTenantId);
      setLoadingRents(false);
      if (status !== 200) {
        toast.error(t('Something went wrong'));
        return;
      }
      setOpenRents(
        (data.rents || []).filter(
          (rent) => rent.total.payment < rent.total.grandTotal
        )
      );
    },
    [store, t]
  );

  const handleConfirm = useCallback(async () => {
    if (!tenantId || !term) {
      return;
    }
    setSaving(true);
    const { status } = await store.banking.confirmMatch(
      transactionId,
      tenantId,
      term
    );
    setSaving(false);
    if (status === 409) {
      toast.error(t('This transaction was already matched'));
      return;
    }
    if (status !== 200) {
      toast.error(t('Something went wrong'));
      return;
    }
    toast.success(t('Payment recorded'));
    setOpen(false);
  }, [setOpen, store, t, tenantId, term, transactionId]);

  return (
    <ResponsiveDialog
      open={open}
      setOpen={setOpen}
      isLoading={saving}
      renderHeader={() => <span>{t('Assign manually')}</span>}
      renderContent={() => (
        <div className="w-full space-y-4">
          <Select value={tenantId} onValueChange={handleTenantChange}>
            <SelectTrigger>
              <SelectValue placeholder={t('Select a tenant')} />
            </SelectTrigger>
            <SelectContent>
              {store.tenant.items.map((tenant) => (
                <SelectItem key={tenant._id} value={tenant._id}>
                  {tenant.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {tenantId && !loadingRents ? (
            openRents.length ? (
              <Select value={term} onValueChange={setTerm}>
                <SelectTrigger data-cy="manualMatchTermSelect">
                  <SelectValue placeholder={t('Select the rent period')} />
                </SelectTrigger>
                <SelectContent>
                  {openRents.map((rent) => (
                    <SelectItem key={rent.term} value={String(rent.term)}>
                      {moment(String(rent.term), 'YYYYMMDDHH').format(
                        'MMMM YYYY'
                      )}{' '}
                      -{' '}
                      <NumberFormat
                        value={rent.total.grandTotal - rent.total.payment}
                        className="inline"
                      />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('This tenant has no open balance')}
              </p>
            )
          ) : null}
        </div>
      )}
      renderFooter={() => (
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={!tenantId || !term}>
            {t('Confirm')}
          </Button>
        </>
      )}
    />
  );
}

export default observer(ManualMatchDialog);
