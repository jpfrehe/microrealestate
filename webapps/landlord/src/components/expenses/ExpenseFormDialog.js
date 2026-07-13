import * as Yup from 'yup';
import { Form, Formik } from 'formik';
import { useCallback, useContext, useMemo, useRef } from 'react';
import { Button } from '../ui/button';
import { DateField } from '../formfields/DateField';
import { EXPENSE_CATEGORIES } from '../../store/Expense';
import { NumberField } from '../formfields/NumberField';
import ResponsiveDialog from '../ResponsiveDialog';
import { SelectField } from '../formfields/SelectField';
import { StoreContext } from '../../store';
import { TextField } from '../formfields/TextField';
import { toast } from 'sonner';
import { toJS } from 'mobx';
import useTranslation from 'next-translate/useTranslation';

const emptyExpense = (propertyId) => ({
  propertyId,
  category: 'other',
  amount: '',
  date: null,
  description: ''
});

export default function ExpenseFormDialog({
  open,
  setOpen,
  propertyId,
  expense
}) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const formRef = useRef();

  const categoryValues = useMemo(
    () =>
      EXPENSE_CATEGORIES.map((category) => ({
        id: category,
        value: category,
        label: t(`expenseCategory.${category}`)
      })),
    [t]
  );

  const validationSchema = useMemo(
    () =>
      Yup.object().shape({
        category: Yup.string().required(),
        amount: Yup.number().moreThan(0).required(),
        date: Yup.date().required(),
        description: Yup.string()
      }),
    []
  );

  const handleClose = useCallback(() => setOpen(false), [setOpen]);

  const onSubmit = useCallback(
    async (values) => {
      const payload = {
        ...values,
        date: values.date.toISOString(),
        amount: Number(values.amount)
      };

      const { status } = expense?._id
        ? await store.expense.update({ ...toJS(expense), ...payload })
        : await store.expense.create(payload);

      if (status !== 200) {
        toast.error(t('Something went wrong'));
        return;
      }
      handleClose();
    },
    [expense, store, handleClose, t]
  );

  return (
    <ResponsiveDialog
      open={open}
      setOpen={setOpen}
      renderHeader={() => (expense?._id ? t('Edit expense') : t('Add expense'))}
      renderContent={() => (
        <Formik
          initialValues={
            expense?._id
              ? {
                  ...expense,
                  date: expense.date ? new Date(expense.date) : null
                }
              : emptyExpense(propertyId)
          }
          validationSchema={validationSchema}
          onSubmit={onSubmit}
          innerRef={formRef}
        >
          {() => (
            <Form autoComplete="off">
              <div className="pt-6 space-y-4">
                <SelectField
                  label={t('Category')}
                  name="category"
                  values={categoryValues}
                />
                <NumberField label={t('Amount')} name="amount" />
                <DateField label={t('Date')} name="date" />
                <TextField label={t('Description')} name="description" />
              </div>
            </Form>
          )}
        </Formik>
      )}
      renderFooter={() => (
        <>
          <Button variant="outline" onClick={handleClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => formRef.current.submitForm()}>
            {expense?._id ? t('Save') : t('Add')}
          </Button>
        </>
      )}
    />
  );
}
