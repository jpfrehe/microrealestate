import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '../ui/table';
import { useContext, useState } from 'react';
import { EmptyIllustration } from '../Illustrations';
import { Label } from '../ui/label';
import { LuBuilding2 } from 'react-icons/lu';
import NumberFormat from '../NumberFormat';
import { observer } from 'mobx-react-lite';
import { StoreContext } from '../../store';
import { Switch } from '../ui/switch';
import useTranslation from 'next-translate/useTranslation';

function CashflowByProperty({ className }) {
  const store = useContext(StoreContext);
  const { t } = useTranslation('common');
  const [onlyArrears, setOnlyArrears] = useState(false);

  const allProperties = store.dashboard.data.cashflow?.properties || [];
  const properties = onlyArrears
    ? allProperties.filter((property) => property.arrears > 0)
    : allProperties;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-lg md:text-xl">
          <span className="flex items-center gap-2">
            <LuBuilding2 className="size-6 text-muted-foreground" />
            {t('Cashflow by property')}
          </span>
          <div className="flex items-center gap-2">
            <Switch
              id="onlyArrears"
              checked={onlyArrears}
              onCheckedChange={setOnlyArrears}
            />
            <Label htmlFor="onlyArrears" className="text-sm font-normal">
              {t('Only show properties with arrears')}
            </Label>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {properties.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Property')}</TableHead>
                <TableHead className="text-right">{t('Due')}</TableHead>
                <TableHead className="text-right">{t('Received')}</TableHead>
                <TableHead className="text-right">{t('Expenses')}</TableHead>
                <TableHead className="text-right">{t('Cashflow')}</TableHead>
                <TableHead className="text-right">{t('Arrears')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {properties.map((property) => (
                <TableRow key={property.propertyId}>
                  <TableCell>{property.propertyName}</TableCell>
                  <TableCell className="text-right">
                    <NumberFormat value={property.dueAmount} showZero={true} />
                  </TableCell>
                  <TableCell className="text-right">
                    <NumberFormat value={property.income} showZero={true} />
                  </TableCell>
                  <TableCell className="text-right">
                    <NumberFormat value={property.expenses} showZero={true} />
                  </TableCell>
                  <TableCell className="text-right">
                    <NumberFormat
                      value={property.cashflow}
                      showZero={true}
                      withColor
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <NumberFormat
                      value={property.arrears}
                      showZero={true}
                      debitColor
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyIllustration
            label={
              onlyArrears
                ? t('No property has arrears for this period')
                : t('No data found')
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

export default observer(CashflowByProperty);
