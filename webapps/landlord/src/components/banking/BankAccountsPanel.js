import {
  fetchBankAccounts,
  fetchProperties,
  QueryKeys
} from '../../utils/restcalls';
import { useContext, useState } from 'react';
import BankAccountCard from './BankAccountCard';
import { Button } from '../ui/button';
import ConnectBankAccountDialog from './ConnectBankAccountDialog';
import { EmptyIllustration } from '../Illustrations';
import { LuPlus } from 'react-icons/lu';
import { observer } from 'mobx-react-lite';
import { StoreContext } from '../../store';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import useTranslation from 'next-translate/useTranslation';

function BankAccountsPanel() {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [openConnect, setOpenConnect] = useState(false);

  const { isError: isAccountsError } = useQuery({
    queryKey: [QueryKeys.BANK_ACCOUNTS],
    queryFn: () => fetchBankAccounts(store)
  });
  useQuery({
    queryKey: [QueryKeys.PROPERTIES],
    queryFn: () => fetchProperties(store)
  });

  if (isAccountsError) {
    toast.error(t('Error fetching bank accounts'));
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => setOpenConnect(true)}
          data-cy="openConnectBankAccountDialog"
        >
          <LuPlus className="size-4" />
          {t('Connect a bank account')}
        </Button>
      </div>

      {store.banking.accounts.length ? (
        <div className="space-y-3">
          {store.banking.accounts.map((bankAccount) => (
            <BankAccountCard
              key={bankAccount._id}
              bankAccount={bankAccount}
              onReconnect={() => setOpenConnect(true)}
            />
          ))}
        </div>
      ) : (
        <EmptyIllustration label={t('No bank account connected yet')} />
      )}

      <ConnectBankAccountDialog open={openConnect} setOpen={setOpenConnect} />
    </div>
  );
}

export default observer(BankAccountsPanel);
