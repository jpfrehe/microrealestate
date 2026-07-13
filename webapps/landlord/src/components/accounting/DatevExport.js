import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { apiFetcher, downloadDocument } from '../../utils/fetch';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  mergeOrganization,
  updateStoreOrganization
} from '../organization/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { useCallback, useContext, useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { LuTriangleAlert } from 'react-icons/lu';
import moment from 'moment';
import { observer } from 'mobx-react-lite';
import { StoreContext } from '../../store';
import { toast } from 'sonner';
import { toJS } from 'mobx';
import useTranslation from 'next-translate/useTranslation';

function DatevExport({ year }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [month, setMonth] = useState(String(moment().month() + 1));
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [taxAdvisorEmail, setTaxAdvisorEmail] = useState(
    store.organization.selected?.taxAdvisorEmail || ''
  );
  const [savingEmail, setSavingEmail] = useState(false);

  const monthValues = moment.months().map((label, index) => ({
    id: String(index + 1),
    value: String(index + 1),
    label
  }));

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetcher().get(
        `/accounting/${year}/${month}/datev/preview`
      );
      setPreview(response.data);
    } catch {
      toast.error(t('Something went wrong'));
    } finally {
      setLoading(false);
    }
  }, [year, month, t]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const onDownload = useCallback(async () => {
    await downloadDocument({
      endpoint: `/accounting/${year}/${month}/datev`,
      documentName: `datev-${year}-${String(month).padStart(2, '0')}.csv`
    });
  }, [year, month]);

  const onSaveTaxAdvisorEmail = useCallback(async () => {
    setSavingEmail(true);
    const { status, data } = await store.organization.update(
      mergeOrganization(toJS(store.organization.selected), {
        taxAdvisorEmail
      })
    );
    setSavingEmail(false);
    if (status !== 200) {
      toast.error(t('Something went wrong'));
      return;
    }
    updateStoreOrganization(store, data);
    toast.success(t('Saved'));
  }, [store, taxAdvisorEmail, t]);

  const onSend = useCallback(async () => {
    setSending(true);
    try {
      await apiFetcher().post(`/accounting/${year}/${month}/datev/send`);
      toast.success(t('Export sent to the tax advisor'));
    } catch (error) {
      if (error?.response?.status === 422) {
        toast.error(t('No tax advisor email configured'));
      } else {
        toast.error(t('Something went wrong'));
      }
    } finally {
      setSending(false);
    }
  }, [year, month, t]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('DATEV export')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthValues.map(({ id, value, label }) => (
                <SelectItem key={id} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={onDownload} disabled={loading}>
            {t('Download DATEV export')}
          </Button>
        </div>

        {!loading && preview ? (
          <>
            <div className="text-sm text-muted-foreground">
              {t('{{count}} bookings ready for export', {
                count: preview.bookingsCount
              })}
            </div>

            {preview.unreconciledTransactionCount > 0 ? (
              <Alert variant="warning">
                <LuTriangleAlert className="size-4" />
                <AlertTitle>{t('Open booking proposals')}</AlertTitle>
                <AlertDescription>
                  {t(
                    'This period still has {{count}} unresolved bank transactions - the export may be incomplete.',
                    { count: preview.unreconciledTransactionCount }
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            {preview.unclassified?.length ? (
              <div className="flex flex-col gap-2">
                <div className="text-sm font-medium">
                  {t('Unclassified bookings ({{count}})', {
                    count: preview.unclassified.length
                  })}
                </div>
                {preview.unclassified.map((item, index) => (
                  <div
                    key={index}
                    className="text-xs text-muted-foreground border rounded p-2"
                  >
                    <div>{item.bookingText}</div>
                    <div>{item.reason}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        <div className="flex flex-col gap-2 pt-4 border-t">
          <Label htmlFor="taxAdvisorEmail">{t('Tax advisor email')}</Label>
          <div className="flex gap-2">
            <Input
              id="taxAdvisorEmail"
              type="email"
              value={taxAdvisorEmail}
              onChange={(e) => setTaxAdvisorEmail(e.target.value)}
              className="max-w-sm"
            />
            <Button
              variant="outline"
              onClick={onSaveTaxAdvisorEmail}
              disabled={savingEmail}
            >
              {t('Save')}
            </Button>
            <Button
              onClick={onSend}
              disabled={
                sending || !store.organization.selected?.taxAdvisorEmail
              }
            >
              {t('Send to tax advisor')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default observer(DatevExport);
