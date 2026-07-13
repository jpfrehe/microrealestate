import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '../../../../components/ui/card';
import {
  fetchBankAccounts,
  fetchProperties,
  QueryKeys
} from '../../../../utils/restcalls';
import { useContext, useState } from 'react';
import BankAccountList from '../../../../components/organization/bankaccounts/BankAccountList';
import { CelebrationIllustration } from '../../../../components/Illustrations';
import ConnectBankAccountDialog from '../../../../components/organization/bankaccounts/ConnectBankAccountDialog';
import { LuPlusCircle } from 'react-icons/lu';
import { observer } from 'mobx-react-lite';
import Page from '../../../../components/Page';
import ShortcutButton from '../../../../components/ShortcutButton';
import { StoreContext } from '../../../../store';
import { useQuery } from '@tanstack/react-query';
import useTranslation from 'next-translate/useTranslation';
import { withAuthentication } from '../../../../components/Authentication';

function BankAccountsSettings() {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [openConnectDialog, setOpenConnectDialog] = useState(false);

  const bankAccountsQuery = useQuery({
    queryKey: [QueryKeys.BANK_ACCOUNTS],
    queryFn: () => fetchBankAccounts(store),
    refetchOnMount: 'always'
  });
  const propertiesQuery = useQuery({
    queryKey: [QueryKeys.PROPERTIES],
    queryFn: () => fetchProperties(store),
    refetchOnMount: 'always'
  });

  const isLoading = bankAccountsQuery.isLoading || propertiesQuery.isLoading;

  return (
    <Page
      loading={isLoading}
      ActionBar={
        <div className="grid grid-cols-5 gap-1.5 md:gap-4">
          <ShortcutButton
            label={t('Connect account')}
            Icon={LuPlusCircle}
            onClick={() => setOpenConnectDialog(true)}
            disabled={!store.user.isAdministrator}
            dataCy="connectBankAccountButton"
          />
        </div>
      }
      dataCy="bankAccountsPage"
    >
      <Card>
        <CardHeader>
          <CardTitle>{t('Bank accounts')}</CardTitle>
          <CardDescription>
            {t(
              'Manage your connected bank accounts for automatic transaction import'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {store.bankAccount.items.length ? (
            <BankAccountList />
          ) : (
            <CelebrationIllustration label={t('No bank account connected')} />
          )}
        </CardContent>
      </Card>

      {openConnectDialog ? (
        <ConnectBankAccountDialog
          open={openConnectDialog}
          setOpen={setOpenConnectDialog}
        />
      ) : null}
    </Page>
  );
}

export default withAuthentication(observer(BankAccountsSettings));
