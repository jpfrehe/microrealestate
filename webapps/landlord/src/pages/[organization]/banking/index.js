import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '../../../components/ui/tabs';
import BankAccountsPanel from '../../../components/banking/BankAccountsPanel';
import Page from '../../../components/Page';
import TransactionsPanel from '../../../components/banking/TransactionsPanel';
import useTranslation from 'next-translate/useTranslation';
import { withAuthentication } from '../../../components/Authentication';

function Banking() {
  const { t } = useTranslation('common');

  return (
    <Page dataCy="bankingPage">
      <Tabs defaultValue="accounts">
        <TabsList className="flex justify-start w-screen-nomargin-sm md:w-full overflow-x-auto overflow-y-hidden">
          <TabsTrigger value="accounts" className="min-w-48 sm:w-full">
            {t('Bank accounts')}
          </TabsTrigger>
          <TabsTrigger value="transactions" className="min-w-48 sm:w-full">
            {t('Suggested bookings')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="accounts">
          <BankAccountsPanel />
        </TabsContent>
        <TabsContent value="transactions">
          <TransactionsPanel />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

export default withAuthentication(Banking);
