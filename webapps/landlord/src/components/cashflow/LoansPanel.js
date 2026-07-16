import * as Yup from 'yup';
import { Card, CardContent } from '../ui/card';
import { fetchLoans, fetchProperties, QueryKeys } from '../../utils/restcalls';
import { Form, Formik } from 'formik';
import { LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu';
import { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/button';
import ConfirmDialog from '../ConfirmDialog';
import { DateField } from '../formfields/DateField';
import { EmptyIllustration } from '../Illustrations';
import moment from 'moment';
import { NumberField } from '../formfields/NumberField';
import NumberFormat from '../NumberFormat';
import { observer } from 'mobx-react-lite';
import ResponsiveDialog from '../ResponsiveDialog';
import { SelectField } from '../formfields/SelectField';
import { StoreContext } from '../../store';
import { TextField } from '../formfields/TextField';
import { toast } from 'sonner';
import useTranslation from 'next-translate/useTranslation';

const validationSchema = Yup.object().shape({
  name: Yup.string().required(),
  lender: Yup.string().required(),
  lenderIban: Yup.string(),
  propertyId: Yup.string().required(),
  principalAmount: Yup.number().moreThan(0).required(),
  interestRate: Yup.number().min(0).required(),
  monthlyRate: Yup.number().moreThan(0).required(),
  startDate: Yup.date().required(),
  endDate: Yup.date().nullable(),
  status: Yup.string().oneOf(['active', 'closed']).required()
});

const initialValues = {
  name: '',
  lender: '',
  lenderIban: '',
  propertyId: '',
  principalAmount: '',
  interestRate: '',
  monthlyRate: '',
  startDate: '',
  // an open-ended loan simply has no end date, and null is what both the form
  // fields and the API express that with - an empty string is neither
  endDate: null,
  status: 'active'
};

function LoanDialog({ open, setOpen, loan }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const formRef = useRef();

  const handleClose = useCallback(() => setOpen(false), [setOpen]);

  const _onSubmit = useCallback(
    async (loanPart) => {
      // The two optional fields are sent as an explicit null when left blank:
      // that is what clears them on an update, and the empty string the text
      // field carries is not a value the API accepts.
      const payload = {
        ...loanPart,
        lenderIban: loanPart.lenderIban || null,
        endDate: loanPart.endDate || null
      };
      try {
        setIsLoading(true);
        const { status } = loan
          ? await store.cashflow.updateLoan({ ...loan, ...payload })
          : await store.cashflow.createLoan(payload);
        if (status !== 200) {
          return toast.error(t('Something went wrong'));
        }
        queryClient.invalidateQueries({ queryKey: [QueryKeys.LOANS] });
        // The instalments feed the analysis, so it is stale as well.
        queryClient.invalidateQueries({ queryKey: [QueryKeys.CASHFLOW] });
        handleClose();
      } finally {
        setIsLoading(false);
      }
    },
    [handleClose, loan, queryClient, store, t]
  );

  const properties = useMemo(
    () =>
      store.property.items.map(({ _id, name }) => ({
        id: _id,
        label: name,
        value: _id
      })),
    [store.property.items]
  );

  const statusValues = useMemo(
    () => [
      { id: 'active', label: t('Active'), value: 'active' },
      { id: 'closed', label: t('Closed'), value: 'closed' }
    ],
    [t]
  );

  return (
    <ResponsiveDialog
      open={open}
      setOpen={setOpen}
      isLoading={isLoading}
      renderHeader={() => (loan ? t('Edit the loan') : t('Add a loan'))}
      renderContent={() => (
        <Formik
          initialValues={
            loan
              ? {
                  ...initialValues,
                  ...loan,
                  lenderIban: loan.lenderIban || '',
                  startDate: loan.startDate ? moment(loan.startDate) : '',
                  endDate: loan.endDate ? moment(loan.endDate) : null
                }
              : initialValues
          }
          validationSchema={validationSchema}
          onSubmit={_onSubmit}
          innerRef={formRef}
        >
          <Form autoComplete="off">
            <div className="pt-6 space-y-4">
              <TextField label={t('Name')} name="name" />
              <SelectField
                label={t('Property')}
                name="propertyId"
                values={properties}
              />
              <TextField label={t('Lender')} name="lender" />
              <div className="space-y-1">
                <TextField label={t('Lender IBAN')} name="lenderIban" />
                <p className="text-xs text-muted-foreground">
                  {t(
                    'The account the instalment is debited from, used to recognize the instalment on your statement'
                  )}
                </p>
              </div>
              <div className="space-y-1">
                <NumberField label={t('Loan amount')} name="principalAmount" />
                <p className="text-xs text-muted-foreground">
                  {t('The amount originally borrowed')}
                </p>
              </div>
              <NumberField
                label={t('Interest rate (% per year)')}
                name="interestRate"
              />
              <div className="space-y-1">
                <NumberField
                  label={t('Monthly instalment')}
                  name="monthlyRate"
                />
                <p className="text-xs text-muted-foreground">
                  {t('Interest and principal together, as debited every month')}
                </p>
              </div>
              <DateField label={t('Start date')} name="startDate" />
              <DateField label={t('End date')} name="endDate" />
              <SelectField
                label={t('Status')}
                name="status"
                values={statusValues}
              />
            </div>
          </Form>
        </Formik>
      )}
      renderFooter={() => (
        <>
          <Button variant="outline" onClick={handleClose}>
            {t('Cancel')}
          </Button>
          <Button
            onClick={() => formRef.current.submitForm()}
            data-cy="submitLoan"
          >
            {loan ? t('Save') : t('Add')}
          </Button>
        </>
      )}
    />
  );
}

function LoanCard({ loan, onEdit, onDelete }) {
  const { t } = useTranslation('common');

  return (
    <Card data-cy="loanCard">
      <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="font-medium">{loan.name}</div>
          <div className="text-sm text-muted-foreground">{loan.lender}</div>
          <div className="text-xs text-muted-foreground">
            {t('{{rate}}% per year since {{startDate}}', {
              rate: loan.interestRate,
              startDate: moment(loan.startDate).format('L')
            })}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <NumberFormat
              value={loan.monthlyRate}
              className="font-medium"
              showZero={true}
            />
            <div className="text-xs text-muted-foreground">
              {t('Monthly instalment')}
            </div>
          </div>
          <Button variant="outline" size="icon" onClick={() => onEdit(loan)}>
            <LuPencil className="size-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => onDelete(loan)}>
            <LuTrash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LoansPanel({ propertyId }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const queryClient = useQueryClient();
  const [openForm, setOpenForm] = useState(false);
  const [openConfirmDelete, setOpenConfirmDelete] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState();

  const { isError } = useQuery({
    queryKey: [QueryKeys.LOANS, propertyId],
    queryFn: () => fetchLoans(store, propertyId)
  });
  useQuery({
    queryKey: [QueryKeys.PROPERTIES],
    queryFn: () => fetchProperties(store)
  });

  if (isError) {
    toast.error(t('Error fetching loans'));
  }

  const handleAdd = useCallback(() => {
    setSelectedLoan(undefined);
    setOpenForm(true);
  }, []);

  const handleEdit = useCallback((loan) => {
    setSelectedLoan(loan);
    setOpenForm(true);
  }, []);

  const handleDelete = useCallback((loan) => {
    setSelectedLoan(loan);
    setOpenConfirmDelete(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const { status } = await store.cashflow.deleteLoan(selectedLoan._id);
    if (status !== 200) {
      toast.error(t('Something went wrong'));
      return;
    }
    queryClient.invalidateQueries({ queryKey: [QueryKeys.LOANS] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.CASHFLOW] });
  }, [queryClient, selectedLoan, store, t]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={handleAdd} data-cy="openLoanDialog">
          <LuPlus className="size-4" />
          {t('Add a loan')}
        </Button>
      </div>

      {store.cashflow.loans.length ? (
        <div className="space-y-3">
          {store.cashflow.loans.map((loan) => (
            <LoanCard
              key={loan._id}
              loan={loan}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : (
        <EmptyIllustration label={t('No loan recorded yet')} />
      )}

      {openForm ? (
        <LoanDialog open={openForm} setOpen={setOpenForm} loan={selectedLoan} />
      ) : null}

      <ConfirmDialog
        title={t('Are you sure to remove this loan?')}
        subTitle={selectedLoan?.name}
        open={openConfirmDelete}
        setOpen={setOpenConfirmDelete}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

export default observer(LoansPanel);
