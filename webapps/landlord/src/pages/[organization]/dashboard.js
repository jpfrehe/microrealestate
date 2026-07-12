import {
  fetchBankAccounts,
  fetchDashboard,
  fetchLeases,
  fetchProperties,
  fetchTenants,
  QueryKeys
} from '../../utils/restcalls';
import CashflowByProperty from '../../components/dashboard/CashflowByProperty';
import CashflowFigures from '../../components/dashboard/CashflowFigures';
import GeneralFigures from '../../components/dashboard/GeneralFigures';
import Link from '../../components/Link';
import { LuLandmark } from 'react-icons/lu';
import MonthFigures from '../../components/dashboard/MonthFigures';
import Page from '../../components/Page';
import Shortcuts from '../../components/dashboard/Shortcuts';
import { StoreContext } from '../../store';
import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import useTranslation from 'next-translate/useTranslation';
import Welcome from '../../components/Welcome';
import { withAuthentication } from '../../components/Authentication';
import YearFigures from '../../components/dashboard/YearFigures';

function Dashboard() {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const dashboardQuery = useQuery({
    queryKey: [QueryKeys.DASHBOARD],
    queryFn: () => fetchDashboard(store),
    refetchOnMount: 'always',
    retry: 3
  });
  const tenantsQuery = useQuery({
    queryKey: [QueryKeys.TENANTS],
    queryFn: () => fetchTenants(store),
    refetchOnMount: 'always',
    retry: 3
  });
  const propertiesQuery = useQuery({
    queryKey: [QueryKeys.PROPERTIES],
    queryFn: () => fetchProperties(store),
    refetchOnMount: 'always',
    retry: 3
  });
  const leasesQuery = useQuery({
    queryKey: [QueryKeys.LEASES],
    queryFn: () => fetchLeases(store),
    refetchOnMount: 'always',
    retry: 3
  });
  const bankAccountsQuery = useQuery({
    queryKey: [QueryKeys.BANK_ACCOUNTS],
    queryFn: () => fetchBankAccounts(store),
    refetchOnMount: 'always',
    retry: 3
  });
  const isLoading =
    dashboardQuery.isLoading ||
    tenantsQuery.isLoading ||
    propertiesQuery.isLoading ||
    leasesQuery.isLoading;
  const isFirstConnection =
    !leasesQuery?.data?.length ||
    !dashboardQuery?.data?.overview?.propertyCount ||
    !tenantsQuery?.data?.length ||
    !propertiesQuery?.data?.length;
  // UC3 alternate flow: cashflow numbers are shown either way (they fall
  // back to rent due/paid alone), but nudge the landlord towards UC1 when
  // there is no automated bank data feeding them yet.
  const hasNoBankAccount =
    !bankAccountsQuery.isLoading && !bankAccountsQuery.data?.length;

  return (
    <Page loading={isLoading} dataCy="dashboardPage">
      <div className="flex flex-col gap-4">
        <Welcome className="mb-6" />
        {isFirstConnection ? (
          <Shortcuts firstConnection className="w-full" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Shortcuts className="md:col-span-5" />
            <MonthFigures className="md:col-span-3" />
            <GeneralFigures className="md:col-span-2" />
            <YearFigures className="md:col-span-5" />
            {hasNoBankAccount ? (
              <Link
                href={`/${store.organization.selected.name}/banking`}
                className="md:col-span-5 flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground hover:text-foreground"
                data-cy="connectBankAccountHint"
              >
                <LuLandmark className="size-5" />
                {t(
                  'Connect a bank account to see actual cashflow instead of rent due/paid alone'
                )}
              </Link>
            ) : null}
            <CashflowFigures className="md:col-span-5" />
            <CashflowByProperty className="md:col-span-5" />
          </div>
        )}
      </div>
    </Page>
  );
}

export default withAuthentication(Dashboard);
