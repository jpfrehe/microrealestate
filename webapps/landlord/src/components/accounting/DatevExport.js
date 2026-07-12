import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { fetchDatevPreview, QueryKeys } from '../../utils/restcalls';
import { useCallback, useContext, useState } from 'react';
import { Button } from '../ui/button';
import { downloadDocument } from '../../utils/fetch';
import { GrDocumentCsv } from 'react-icons/gr';
import { LuAlertTriangle } from 'react-icons/lu';
import moment from 'moment';
import NumberFormat from '../NumberFormat';
import { observer } from 'mobx-react-lite';
import PeriodPicker from '../PeriodPicker';
import { StoreContext } from '../../store';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import useTranslation from 'next-translate/useTranslation';

function DatevExport() {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [period, setPeriod] = useState(moment());
  const year = period.format('YYYY');
  const month = period.format('MM');

  const { data, isLoading, isError } = useQuery({
    queryKey: [QueryKeys.DATEV_PREVIEW, year, month],
    queryFn: () => fetchDatevPreview(store, year, month)
  });

  if (isError) {
    toast.error(t('Something went wrong'));
  }

  const handleDownload = useCallback(async () => {
    await downloadDocument({
      endpoint: `/accounting/${year}/${month}/datev`,
      documentName: t('DATEV export - {{month}}.csv', {
        month: period.format('YYYY-MM')
      })
    });
  }, [month, period, t, year]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between text-lg md:text-xl">
          {t('DATEV export')}
          <PeriodPicker period="month" value={period} onChange={setPeriod} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isLoading && data ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t('{{count}} bookings ready to export for {{month}}', {
                count: data.bookingsCount,
                month: period.format('MMMM YYYY')
              })}
            </p>

            {data.unclassified?.length ? (
              <div className="space-y-2 rounded-md border border-warning bg-warning/10 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-warning">
                  <LuAlertTriangle className="size-4" />
                  {t(
                    '{{count}} bookings could not be classified and are excluded from the export',
                    { count: data.unclassified.length }
                  )}
                </div>
                <ul className="space-y-1 text-sm">
                  {data.unclassified.map((item, index) => (
                    <li key={index} className="flex justify-between gap-2">
                      <span>{item.bookingText}</span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <NumberFormat value={item.amount} className="inline" />
                        <span>({item.reason})</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Button
              onClick={handleDownload}
              disabled={!data.bookingsCount}
              data-cy="downloadDatevExportButton"
            >
              <GrDocumentCsv className="size-4" />
              {t('Download DATEV export')}
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default observer(DatevExport);
