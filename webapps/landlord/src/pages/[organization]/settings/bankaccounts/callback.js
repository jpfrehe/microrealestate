import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '../../../../components/ui/card';
import { useContext, useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import Loading from '../../../../components/Loading';
import Page from '../../../../components/Page';
import { StoreContext } from '../../../../store';
import { useRouter } from 'next/router';
import useTranslation from 'next-translate/useTranslation';
import { withAuthentication } from '../../../../components/Authentication';

// UC1 step 3-4: the landing page an XS2A aggregator redirects the landlord
// back to after the bank's SCA/TAN step, per the redirectUrl built in
// services/banking/src/managers/bankaccountmanager.ts's initiateConnection.
// Not reachable via the mock aggregator today (its redirectUrl points at a
// deliberately unresolvable domain, see mockadapter.ts) - kept ready for
// when a real provider is wired in; the connect flow that IS testable today
// lives in ConnectBankAccountDialog's inline "demo authorization" step.
function BankAccountCallback() {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const router = useRouter();
  const [state, setState] = useState('pending');

  useEffect(() => {
    if (!router.isReady) {
      return;
    }
    const { connectionId, authorizationCode } = router.query;
    if (!connectionId || !authorizationCode) {
      setState('error');
      return;
    }

    (async () => {
      const completion = await store.bankAccount.completeConnection(
        connectionId,
        authorizationCode
      );
      if (completion.status !== 200) {
        setState('error');
        return;
      }

      const selections = completion.data.accounts.map((account) => ({
        aggregatorAccountId: account.aggregatorAccountId,
        iban: account.iban,
        bankName: account.bankName,
        accountHolder: account.accountHolder,
        propertyIds: []
      }));
      const selection = await store.bankAccount.selectAccounts(
        connectionId,
        authorizationCode,
        selections
      );
      setState(selection.status === 200 ? 'success' : 'error');
    })();
  }, [router.isReady, router.query, store]);

  const goToBankAccounts = () =>
    router.push(`/${store.organization.selected.name}/settings/bankaccounts`);

  return (
    <Page dataCy="bankAccountCallbackPage">
      <Card>
        <CardHeader>
          <CardTitle>{t('Connect a bank account')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === 'pending' ? <Loading fullScreen={false} /> : null}
          {state === 'success' ? (
            <>
              <div>{t('Bank account connected')}</div>
              <Button onClick={goToBankAccounts}>{t('Bank accounts')}</Button>
            </>
          ) : null}
          {state === 'error' ? (
            <>
              <div>{t('The bank declined or cancelled the authorization')}</div>
              <Button onClick={goToBankAccounts}>{t('Bank accounts')}</Button>
            </>
          ) : null}
        </CardContent>
      </Card>
    </Page>
  );
}

export default withAuthentication(BankAccountCallback);
