import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '../ui/table';
import { EmptyIllustration } from '../Illustrations';
import { LuBuilding2 } from 'react-icons/lu';
import NumberFormat from '../NumberFormat';
import { observer } from 'mobx-react-lite';
import { StoreContext } from '../../store';
import { useContext } from 'react';
import useTranslation from 'next-translate/useTranslation';

function CashflowByProperty({ className }) {
  const store = useContext(StoreContext);
  const { t } = useTranslation('common');

  const properties = store.dashboard.data.cashflow?.properties || [];

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
          <LuBuilding2 className="size-6 text-muted-foreground" />
          {t('Cashflow by property')}
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyIllustration label={t('No data found')} />
        )}
      </CardContent>
    </Card>
  );
}

export default observer(CashflowByProperty);
