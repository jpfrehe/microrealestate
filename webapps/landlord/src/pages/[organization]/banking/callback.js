import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '../../../components/ui/card';
import { fetchProperties, QueryKeys } from '../../../utils/restcalls';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Label } from '../../../components/ui/label';
import Loading from '../../../components/Loading';
import { LuAlertCircle } from 'react-icons/lu';
import { observer } from 'mobx-react-lite';
import Page from '../../../components/Page';
import { StoreContext } from '../../../store';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import useTranslation from 'next-translate/useTranslation';
import { withAuthentication } from '../../../components/Authentication';

const ERROR_MESSAGES = {
  409: 'You declined the connection at your bank.',
  422: 'This bank is not supported yet.'
};

const AccountSelectionForm = observer(function AccountSelectionForm({
  accounts,
  connectionToken,
  onDone
}) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [selected, setSelected] = useState(() =>
    accounts.map((account) => ({ ...account, propertyIds: [] }))
  );
  const [saving, setSaving] = useState(false);

  const toggleAccount = useCallback((aggregatorAccountId, checked) => {
    setSelected((current) =>
      checked
        ? current
        : current.filter(
            (account) => account.aggregatorAccountId !== aggregatorAccountId
          )
    );
  }, []);

  const toggleProperty = useCallback(
    (aggregatorAccountId, propertyId, checked) => {
      setSelected((current) =>
        current.map((account) => {
          if (account.aggregatorAccountId !== aggregatorAccountId) {
            return account;
          }
          const propertyIds = checked
            ? [...account.propertyIds, propertyId]
            : account.propertyIds.filter((id) => id !== propertyId);
          return { ...account, propertyIds };
        })
      );
    },
    []
  );

  const handleSubmit = useCallback(async () => {
    if (!selected.length) {
      toast.error(t('Select at least one account'));
      return;
    }
    setSaving(true);
    const { status } = await store.banking.selectAccounts(
      connectionToken,
      selected
    );
    setSaving(false);
    if (status !== 200) {
      toast.error(t('Something went wrong'));
      return;
    }
    toast.success(t('Bank account connected'));
    onDone();
  }, [connectionToken, onDone, selected, store, t]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Select accounts to connect')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {accounts.map((account) => {
          const isChecked = selected.some(
            (a) => a.aggregatorAccountId === account.aggregatorAccountId
          );
          const current = selected.find(
            (a) => a.aggregatorAccountId === account.aggregatorAccountId
          );
          return (
            <div
              key={account.aggregatorAccountId}
              className="space-y-3 rounded-md border p-4"
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  id={account.aggregatorAccountId}
                  checked={isChecked}
                  onCheckedChange={(checked) =>
                    toggleAccount(account.aggregatorAccountId, checked)
                  }
                />
                <Label
                  htmlFor={account.aggregatorAccountId}
                  className="space-y-1"
                >
                  <div className="text-base font-medium">
                    {account.bankName}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {account.iban}
                  </div>
                </Label>
              </div>
              {isChecked ? (
                <div className="ml-7 space-y-2">
                  <div className="text-xs text-muted-foreground">
                    {t(
                      'Assign to properties (leave empty to apply to the whole organization)'
                    )}
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {store.property.items.map((property) => (
                      <div
                        key={property._id}
                        className="flex items-center gap-2"
                      >
                        <Checkbox
                          id={`${account.aggregatorAccountId}-${property._id}`}
                          checked={current?.propertyIds.includes(property._id)}
                          onCheckedChange={(checked) =>
                            toggleProperty(
                              account.aggregatorAccountId,
                              property._id,
                              checked
                            )
                          }
                        />
                        <Label
                          htmlFor={`${account.aggregatorAccountId}-${property._id}`}
                        >
                          {property.name}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
        <Button
          onClick={handleSubmit}
          disabled={saving}
          data-cy="confirmAccountSelectionButton"
        >
          {saving ? t('In progress') : t('Connect selected accounts')}
        </Button>
      </CardContent>
    </Card>
  );
});

function CallbackError({ status }) {
  const { t } = useTranslation('common');
  const router = useRouter();
  const store = useContext(StoreContext);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-warning">
          <LuAlertCircle className="size-6" />
          {t('Connection failed')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>{t(ERROR_MESSAGES[status] || 'Something went wrong')}</p>
        <Button
          variant="outline"
          onClick={() =>
            router.push(`/${store.organization.selected.name}/banking`)
          }
        >
          {t('Back to bank accounts')}
        </Button>
      </CardContent>
    </Card>
  );
}

function BankingCallback() {
  const router = useRouter();
  const store = useContext(StoreContext);
  const { connectionId, authorizationCode } = router.query;
  const [result, setResult] = useState(null); // { status, connectionToken, accounts }
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!connectionId || !authorizationCode || requestedRef.current) {
      return;
    }
    requestedRef.current = true;

    (async () => {
      const { status, data } = await store.banking.completeConnection(
        connectionId,
        authorizationCode
      );
      setResult({ status, ...data });
    })();
  }, [authorizationCode, connectionId, store]);

  // properties are needed to offer the "assign to property" checkboxes below
  const { isLoading: isLoadingProperties } = useQuery({
    queryKey: [QueryKeys.PROPERTIES],
    queryFn: () => fetchProperties(store)
  });

  const handleDone = useCallback(() => {
    router.push(`/${store.organization.selected.name}/banking`);
  }, [router, store.organization.selected.name]);

  return (
    <Page className="max-w-2xl" dataCy="bankingCallbackPage">
      {!result || isLoadingProperties ? (
        <Loading fullScreen={false} />
      ) : result.status === 200 ? (
        <AccountSelectionForm
          accounts={result.accounts}
          connectionToken={result.connectionToken}
          onDone={handleDone}
        />
      ) : (
        <CallbackError status={result.status} />
      )}
    </Page>
  );
}

export default withAuthentication(observer(BankingCallback));
