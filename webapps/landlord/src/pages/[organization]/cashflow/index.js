import {
  fetchCashflow,
  fetchProperties,
  QueryKeys
} from '../../../utils/restcalls';
import { LuChevronLeft, LuChevronRight, LuLandmark } from 'react-icons/lu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../../components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '../../../components/ui/tabs';
import { useContext, useMemo, useState } from 'react';
import { Alert } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import CashflowSankey from '../../../components/cashflow/CashflowSankey';
import CashflowSummaryCards from '../../../components/cashflow/CashflowSummaryCards';
import DepreciationsPanel from '../../../components/cashflow/DepreciationsPanel';
import LoansPanel from '../../../components/cashflow/LoansPanel';
import moment from 'moment';
import { observer } from 'mobx-react-lite';
import Page from '../../../components/Page';
import { StoreContext } from '../../../store';
import { toast } from 'sonner';
import TransactionCategoryList from '../../../components/cashflow/TransactionCategoryList';
import { useQuery } from '@tanstack/react-query';
import useTranslation from 'next-translate/useTranslation';
import { withAuthentication } from '../../../components/Authentication';

// Radix needs a real value for the "no filter" choice, and the contract wants
// the propertyId query param simply omitted for the whole portfolio.
const ALL_PROPERTIES = '__all__';

const MONTH_FORMAT = 'YYYY-MM';

function Cashflow() {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [month, setMonth] = useState(() => moment().format(MONTH_FORMAT));
  const [propertyId, setPropertyId] = useState(ALL_PROPERTIES);

  const { isError, isLoading } = useQuery({
    queryKey: [QueryKeys.CASHFLOW, month, propertyId],
    queryFn: () =>
      fetchCashflow(
        store,
        month,
        propertyId === ALL_PROPERTIES ? undefined : propertyId
      )
  });
  useQuery({
    queryKey: [QueryKeys.PROPERTIES],
    queryFn: () => fetchProperties(store)
  });

  // The arrows step anywhere, so the picker window is stretched to always hold
  // the selected month rather than the other way around.
  const monthOptions = useMemo(() => {
    const selected = moment(month, MONTH_FORMAT);
    const cursor = moment
      .min(selected, moment().subtract(23, 'months'))
      .startOf('month');
    const last = moment.max(selected, moment()).startOf('month');
    const options = [];
    while (cursor.isSameOrBefore(last)) {
      options.push({
        value: cursor.format(MONTH_FORMAT),
        label: cursor.format('MMMM YYYY')
      });
      cursor.add(1, 'month');
    }
    return options.reverse();
  }, [month]);

  const handleMonthStep = (step) => () =>
    setMonth(
      moment(month, MONTH_FORMAT).add(step, 'month').format(MONTH_FORMAT)
    );

  if (isError) {
    toast.error(t('Error fetching the cashflow analysis'));
  }

  const data = store.cashflow.data;

  return (
    <Page loading={isLoading} dataCy="cashflowPage">
      <div className="mb-4 flex justify-end">
        <Select value={propertyId} onValueChange={setPropertyId}>
          <SelectTrigger className="md:w-72" data-cy="cashflowPropertySelect">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROPERTIES}>
              {t('All properties')}
            </SelectItem>
            {store.property.items.map((property) => (
              <SelectItem key={property._id} value={property._id}>
                {property.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="analysis">
        <TabsList className="flex justify-start w-screen-nomargin-sm md:w-full overflow-x-auto overflow-y-hidden">
          <TabsTrigger value="analysis" className="min-w-48 sm:w-full">
            {t('Cashflow analysis')}
          </TabsTrigger>
          <TabsTrigger value="loans" className="min-w-48 sm:w-full">
            {t('Loans')}
          </TabsTrigger>
          <TabsTrigger value="depreciations" className="min-w-48 sm:w-full">
            {t('Depreciations')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="analysis" className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="icon"
              onClick={handleMonthStep(-1)}
              data-cy="previousMonthButton"
            >
              <LuChevronLeft className="size-4" />
            </Button>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-52" data-cy="cashflowMonthSelect">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="secondary"
              size="icon"
              onClick={handleMonthStep(1)}
              data-cy="nextMonthButton"
            >
              <LuChevronRight className="size-4" />
            </Button>
          </div>

          {data.hasBankAccount === false ? (
            <Alert data-cy="noBankAccountAlert">
              <div className="flex items-center gap-4">
                <LuLandmark className="size-6" />
                <div className="text-sm">
                  {t('Connect a bank account to get a complete cashflow view')}
                </div>
              </div>
            </Alert>
          ) : null}

          <CashflowSummaryCards summary={data.summary} />
          <CashflowSankey sankey={data.sankey} />
          <TransactionCategoryList transactions={data.transactions} />
        </TabsContent>

        <TabsContent value="loans">
          <LoansPanel
            propertyId={propertyId === ALL_PROPERTIES ? undefined : propertyId}
          />
        </TabsContent>

        <TabsContent value="depreciations">
          <DepreciationsPanel
            propertyId={propertyId === ALL_PROPERTIES ? undefined : propertyId}
          />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

export default withAuthentication(observer(Cashflow));
