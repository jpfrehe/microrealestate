import { LuTrendingDown, LuTrendingUp, LuWallet } from 'react-icons/lu';
import { cn } from '../../utils';
import { DashboardCard } from './DashboardCard';
import NumberFormat from '../NumberFormat';
import { observer } from 'mobx-react-lite';
import { StoreContext } from '../../store';
import { useContext } from 'react';
import useTranslation from 'next-translate/useTranslation';

function CashflowFigures({ className }) {
  const store = useContext(StoreContext);
  const { t } = useTranslation('common');

  const portfolio = store.dashboard.data.cashflow?.portfolio;

  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-3 gap-4', className)}>
      <DashboardCard
        Icon={LuTrendingUp}
        title={t('Income this month')}
        description={t('Rents actually received')}
        renderContent={() => (
          <NumberFormat value={portfolio?.income} showZero={true} />
        )}
      />
      <DashboardCard
        Icon={LuTrendingDown}
        title={t('Expenses this month')}
        description={t('Recorded property expenses')}
        renderContent={() => (
          <NumberFormat value={portfolio?.expenses} showZero={true} />
        )}
      />
      <DashboardCard
        Icon={LuWallet}
        title={t('Cashflow this month')}
        description={t('Income minus expenses')}
        renderContent={() => (
          <NumberFormat value={portfolio?.cashflow} showZero={true} withColor />
        )}
      />
    </div>
  );
}

export default observer(CashflowFigures);
