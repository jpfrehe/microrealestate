import { LuPencil, LuPlus, LuTrash } from 'react-icons/lu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '../ui/table';
import { useContext, useState } from 'react';
import { Button } from '../ui/button';
import ConfirmDialog from '../ConfirmDialog';
import ExpenseFormDialog from './ExpenseFormDialog';
import moment from 'moment';
import NumberFormat from '../NumberFormat';
import { observer } from 'mobx-react-lite';
import { StoreContext } from '../../store';
import useTranslation from 'next-translate/useTranslation';

function ExpenseList({ propertyId }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [confirmDeleteExpense, setConfirmDeleteExpense] = useState(null);

  const expenses = store.expense.items;

  const onAdd = () => {
    setEditingExpense(null);
    setOpenDialog(true);
  };

  const onEdit = (expense) => {
    setEditingExpense(expense);
    setOpenDialog(true);
  };

  const onConfirmDelete = async () => {
    await store.expense.delete([confirmDeleteExpense._id]);
    setConfirmDeleteExpense(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium">
          {t('Expenses for this property')}
        </h3>
        <Button size="sm" onClick={onAdd} data-cy="addExpenseButton">
          <LuPlus className="size-4 mr-1" />
          {t('Add expense')}
        </Button>
      </div>

      {expenses.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Date')}</TableHead>
              <TableHead>{t('Category')}</TableHead>
              <TableHead>{t('Description')}</TableHead>
              <TableHead className="text-right">{t('Amount')}</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {expenses.map((expense) => (
              <TableRow key={expense._id}>
                <TableCell>{moment(expense.date).format('L')}</TableCell>
                <TableCell>
                  {t(`expenseCategory.${expense.category}`)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {expense.description}
                </TableCell>
                <TableCell className="text-right">
                  <NumberFormat value={expense.amount} debitColor />
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEdit(expense)}
                    >
                      <LuPencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setConfirmDeleteExpense(expense)}
                    >
                      <LuTrash className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="text-sm text-muted-foreground">
          {t('No expense recorded for this property yet')}
        </div>
      )}

      {openDialog ? (
        <ExpenseFormDialog
          open={openDialog}
          setOpen={setOpenDialog}
          propertyId={propertyId}
          expense={editingExpense}
        />
      ) : null}

      <ConfirmDialog
        title={t('Are you sure to definitely remove this expense?')}
        subTitle={confirmDeleteExpense?.description}
        open={!!confirmDeleteExpense}
        setOpen={(open) => !open && setConfirmDeleteExpense(null)}
        onConfirm={onConfirmDelete}
      />
    </div>
  );
}

export default observer(ExpenseList);
