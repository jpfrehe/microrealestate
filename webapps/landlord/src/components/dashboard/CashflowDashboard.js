import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { LuLandmark, LuTriangleAlert } from 'react-icons/lu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '../ui/table';
import { useContext, useMemo } from 'react';
import { cn } from '../../utils';
import { Label } from '../ui/label';
import Link from 'next/link';
import NumberFormat from '../NumberFormat';
import { observer } from 'mobx-react-lite';
import { StoreContext } from '../../store';
import { Switch } from '../ui/switch';
import useTranslation from 'next-translate/useTranslation';

function PortfolioSummary({ portfolio }) {
  const { t } = useTranslation('common');

  const tiles = [
    { label: t('Target rent'), value: portfolio.dueAmount },
    { label: t('Income'), value: portfolio.income, withColor: true },
    { label: t('Expenses'), value: -portfolio.expenses, debitColor: true },
    { label: t('Net cashflow'), value: portfolio.cashflow, withColor: true },
    { label: t('Arrears'), value: portfolio.arrears, debitColor: true }
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {tiles.map(({ label, value, withColor, debitColor }) => (
        <Card key={label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-muted-foreground">
              {label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <NumberFormat
              value={value}
              withColor={withColor}
              debitColor={debitColor}
              className="text-xl font-medium"
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CashflowDashboard({ className }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const cashflow = store.dashboard.cashflow;

  const orgName = store.organization.selected?.name;

  const showFallbackHint = useMemo(
    () => !cashflow.hasBankAccount && !cashflow.hasExpenseData,
    [cashflow.hasBankAccount, cashflow.hasExpenseData]
  );

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h2 className="text-lg font-medium">{t('Cashflow')}</h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="onlyArrears"
              checked={store.dashboard.onlyArrears}
              onCheckedChange={store.dashboard.setOnlyArrears}
            />
            <Label htmlFor="onlyArrears" className="text-sm cursor-pointer">
              {t('Only show properties with arrears')}
            </Label>
          </div>
          <Select
            value={store.dashboard.cashflowPeriod}
            onValueChange={store.dashboard.setCashflowPeriod}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">{t('Month')}</SelectItem>
              <SelectItem value="quarter">{t('Quarter')}</SelectItem>
              <SelectItem value="year">{t('Year')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {showFallbackHint ? (
        <Alert>
          <LuLandmark className="size-4" />
          <AlertTitle>{t('No bank account connected yet')}</AlertTitle>
          <AlertDescription>
            {t('Cashflow currently only reflects known rent Soll/Ist values.')}{' '}
            {orgName ? (
              <Link
                href={`/${orgName}/settings/bankaccounts`}
                className="underline"
              >
                {t('Connect a bank account for the full cashflow view')}
              </Link>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <PortfolioSummary portfolio={cashflow.portfolio} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-normal">
            {t('Properties')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cashflow.properties.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Property')}</TableHead>
                  <TableHead className="text-right">
                    {t('Target rent')}
                  </TableHead>
                  <TableHead className="text-right">{t('Income')}</TableHead>
                  <TableHead className="text-right">{t('Expenses')}</TableHead>
                  <TableHead className="text-right">
                    {t('Net cashflow')}
                  </TableHead>
                  <TableHead className="text-right">{t('Arrears')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cashflow.properties.map((property) => (
                  <TableRow
                    key={property.propertyId}
                    className={cn(orgName && 'cursor-pointer')}
                    data-cy="cashflowPropertyRow"
                  >
                    <TableCell>
                      {orgName ? (
                        <Link
                          href={`/${orgName}/properties/${property.propertyId}?tab=expenses`}
                          className="hover:underline"
                        >
                          {property.propertyName}
                        </Link>
                      ) : (
                        property.propertyName
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <NumberFormat value={property.dueAmount} />
                    </TableCell>
                    <TableCell className="text-right">
                      <NumberFormat value={property.income} withColor />
                    </TableCell>
                    <TableCell className="text-right">
                      <NumberFormat value={-property.expenses} debitColor />
                    </TableCell>
                    <TableCell className="text-right">
                      <NumberFormat value={property.cashflow} withColor />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {property.arrears > 0 ? (
                          <LuTriangleAlert className="size-4 text-warning" />
                        ) : null}
                        <NumberFormat value={property.arrears} debitColor />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-sm text-muted-foreground py-4">
              {store.dashboard.onlyArrears
                ? t('No property has arrears for this period')
                : t('No property data for this period')}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default observer(CashflowDashboard);
