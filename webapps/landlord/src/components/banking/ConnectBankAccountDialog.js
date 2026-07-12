import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { useCallback, useContext, useEffect, useState } from 'react';
import { Button } from '../ui/button';
import ResponsiveDialog from '../ResponsiveDialog';
import { StoreContext } from '../../store';
import { toast } from 'sonner';
import useTranslation from 'next-translate/useTranslation';

export default function ConnectBankAccountDialog({ open, setOpen }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [banks, setBanks] = useState([]);
  const [bankId, setBankId] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setBankId('');
      return;
    }
    (async () => {
      const { status, data } = await store.banking.fetchBanks();
      if (status !== 200) {
        toast.error(t('Something went wrong'));
        return;
      }
      setBanks(data);
    })();
  }, [open, store, t]);

  const handleConnect = useCallback(async () => {
    if (!bankId) {
      return;
    }
    setLoading(true);
    const { status, data } = await store.banking.initiateConnection(bankId);
    setLoading(false);
    if (status !== 200) {
      toast.error(t('Something went wrong'));
      return;
    }
    // A real XS2A flow leaves the app entirely to authenticate with the
    // bank, so this is a genuine full-page navigation, not an XHR call.
    window.location.href = data.redirectUrl;
  }, [bankId, store, t]);

  return (
    <ResponsiveDialog
      open={open}
      setOpen={setOpen}
      isLoading={loading}
      renderHeader={() => <span>{t('Connect a bank account')}</span>}
      renderContent={() => (
        <div className="w-full space-y-4">
          <p className="text-sm text-muted-foreground">
            {t(
              "You'll be redirected to your bank to securely authorize access to your account information."
            )}
          </p>
          <Select value={bankId} onValueChange={setBankId}>
            <SelectTrigger data-cy="bankSelect">
              <SelectValue placeholder={t('Select your bank')} />
            </SelectTrigger>
            <SelectContent>
              {banks.map((bank) => (
                <SelectItem key={bank.bankId} value={bank.bankId}>
                  {bank.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      renderFooter={() => (
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button
            onClick={handleConnect}
            disabled={!bankId}
            data-cy="connectBankButton"
          >
            {t('Continue')}
          </Button>
        </>
      )}
    />
  );
}
