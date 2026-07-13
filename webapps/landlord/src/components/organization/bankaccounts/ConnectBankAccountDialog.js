import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../ui/select';
import { useCallback, useContext, useMemo, useState } from 'react';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { MOCK_SUPPORTED_BANKS } from '../../../store/BankAccount';
import ResponsiveDialog from '../../ResponsiveDialog';
import { StoreContext } from '../../../store';
import { toast } from 'sonner';
import useTranslation from 'next-translate/useTranslation';

const STEPS = {
  PICK_BANK: 'pick_bank',
  AUTHORIZE: 'authorize',
  SELECT_ACCOUNTS: 'select_accounts'
};

export default function ConnectBankAccountDialog({ open, setOpen }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [step, setStep] = useState(STEPS.PICK_BANK);
  const [isLoading, setIsLoading] = useState(false);
  const [bankId, setBankId] = useState('');
  const [redirectUrl, setRedirectUrl] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [authorizationCode, setAuthorizationCode] = useState('OK');
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [propertiesByAccount, setPropertiesByAccount] = useState({});

  const reset = useCallback(() => {
    setStep(STEPS.PICK_BANK);
    setBankId('');
    setRedirectUrl('');
    setConnectionId('');
    setAuthorizationCode('OK');
    setAccounts([]);
    setSelectedAccountIds([]);
    setPropertiesByAccount({});
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    reset();
  }, [setOpen, reset]);

  const onInitiate = useCallback(async () => {
    if (!bankId) {
      return;
    }
    setIsLoading(true);
    const { status, data, message } =
      await store.bankAccount.initiateConnection(bankId);
    setIsLoading(false);
    if (status !== 200) {
      toast.error(message || t('Something went wrong'));
      return;
    }
    setConnectionId(data.connectionId);
    setRedirectUrl(data.redirectUrl);
    setStep(STEPS.AUTHORIZE);
  }, [bankId, store, t]);

  const onAuthorize = useCallback(async () => {
    setIsLoading(true);
    const { status, data, message } =
      await store.bankAccount.completeConnection(
        connectionId,
        authorizationCode
      );
    setIsLoading(false);
    if (status !== 200) {
      toast.error(
        message || t('The bank declined or cancelled the authorization')
      );
      return;
    }
    setAccounts(data.accounts);
    setSelectedAccountIds(data.accounts.map((a) => a.aggregatorAccountId));
    setStep(STEPS.SELECT_ACCOUNTS);
  }, [connectionId, authorizationCode, store, t]);

  const toggleAccount = useCallback((aggregatorAccountId) => {
    setSelectedAccountIds((current) =>
      current.includes(aggregatorAccountId)
        ? current.filter((id) => id !== aggregatorAccountId)
        : [...current, aggregatorAccountId]
    );
  }, []);

  const toggleProperty = useCallback((aggregatorAccountId, propertyId) => {
    setPropertiesByAccount((current) => {
      const currentIds = current[aggregatorAccountId] || [];
      const nextIds = currentIds.includes(propertyId)
        ? currentIds.filter((id) => id !== propertyId)
        : [...currentIds, propertyId];
      return { ...current, [aggregatorAccountId]: nextIds };
    });
  }, []);

  const onConfirmSelection = useCallback(async () => {
    const selections = accounts
      .filter((account) =>
        selectedAccountIds.includes(account.aggregatorAccountId)
      )
      .map((account) => ({
        aggregatorAccountId: account.aggregatorAccountId,
        iban: account.iban,
        bankName: account.bankName,
        accountHolder: account.accountHolder,
        propertyIds: propertiesByAccount[account.aggregatorAccountId] || []
      }));

    if (!selections.length) {
      toast.error(t('Select at least one account'));
      return;
    }

    setIsLoading(true);
    const { status, message } = await store.bankAccount.selectAccounts(
      connectionId,
      authorizationCode,
      selections
    );
    setIsLoading(false);
    if (status !== 200) {
      toast.error(message || t('Something went wrong'));
      return;
    }
    toast.success(t('Bank account connected'));
    handleClose();
  }, [
    accounts,
    selectedAccountIds,
    propertiesByAccount,
    connectionId,
    authorizationCode,
    store,
    t,
    handleClose
  ]);

  const bankValues = useMemo(
    () =>
      MOCK_SUPPORTED_BANKS.map((bank) => ({
        id: bank.id,
        value: bank.id,
        label: bank.name
      })),
    []
  );

  return (
    <ResponsiveDialog
      open={open}
      setOpen={handleClose}
      isLoading={isLoading}
      renderHeader={() => t('Connect a bank account')}
      renderContent={() => {
        if (step === STEPS.PICK_BANK) {
          return (
            <div className="pt-6 space-y-4">
              <div className="text-sm text-muted-foreground">
                {t(
                  'Only a demo/mock provider is available so far - no real bank data is fetched.'
                )}
              </div>
              <div className="space-y-2">
                <Label>{t('Bank')}</Label>
                <Select value={bankId} onValueChange={setBankId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('Select a bank')} />
                  </SelectTrigger>
                  <SelectContent>
                    {bankValues.map(({ id, value, label }) => (
                      <SelectItem key={id} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          );
        }

        if (step === STEPS.AUTHORIZE) {
          return (
            <div className="pt-6 space-y-4">
              <div className="text-sm text-muted-foreground">
                {t(
                  'In production you would now be redirected to your bank to authenticate (SCA/TAN):'
                )}
              </div>
              <div className="text-xs break-all rounded bg-muted p-2">
                {redirectUrl}
              </div>
              <div className="space-y-2">
                <Label>{t('Authorization code (demo)')}</Label>
                <Input
                  value={authorizationCode}
                  onChange={(e) => setAuthorizationCode(e.target.value)}
                />
                <div className="text-xs text-muted-foreground">
                  {t(
                    'Enter DENY to simulate a declined authorization, any other value approves it.'
                  )}
                </div>
              </div>
            </div>
          );
        }

        return (
          <div className="pt-6 space-y-4 max-h-96 overflow-y-auto">
            {accounts.map((account) => (
              <div
                key={account.aggregatorAccountId}
                className="border rounded p-3 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={selectedAccountIds.includes(
                      account.aggregatorAccountId
                    )}
                    onCheckedChange={() =>
                      toggleAccount(account.aggregatorAccountId)
                    }
                  />
                  <div>
                    <div className="font-medium">{account.bankName}</div>
                    <div className="text-sm text-muted-foreground">
                      {account.iban}
                    </div>
                  </div>
                </div>
                {selectedAccountIds.includes(account.aggregatorAccountId) &&
                store.property.items.length ? (
                  <div className="pl-6 space-y-1">
                    <div className="text-xs text-muted-foreground">
                      {t('Assign to properties (optional)')}
                    </div>
                    {store.property.items.map((property) => (
                      <label
                        key={property._id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={(
                            propertiesByAccount[account.aggregatorAccountId] ||
                            []
                          ).includes(property._id)}
                          onCheckedChange={() =>
                            toggleProperty(
                              account.aggregatorAccountId,
                              property._id
                            )
                          }
                        />
                        {property.name}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        );
      }}
      renderFooter={() => (
        <>
          <Button variant="outline" onClick={handleClose}>
            {t('Cancel')}
          </Button>
          {step === STEPS.PICK_BANK ? (
            <Button onClick={onInitiate} disabled={!bankId}>
              {t('Continue')}
            </Button>
          ) : null}
          {step === STEPS.AUTHORIZE ? (
            <Button onClick={onAuthorize}>{t('Continue')}</Button>
          ) : null}
          {step === STEPS.SELECT_ACCOUNTS ? (
            <Button onClick={onConfirmSelection}>
              {t('Connect selected accounts')}
            </Button>
          ) : null}
        </>
      )}
    />
  );
}
