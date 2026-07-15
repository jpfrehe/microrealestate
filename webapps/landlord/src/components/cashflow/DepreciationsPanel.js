import * as Yup from 'yup';
import { Card, CardContent } from '../ui/card';
import {
  fetchDepreciations,
  fetchProperties,
  QueryKeys
} from '../../utils/restcalls';
import { Form, Formik } from 'formik';
import { LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu';
import { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from '../ui/alert';
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
  propertyId: Yup.string().required(),
  baseAmount: Yup.number().moreThan(0).required(),
  rate: Yup.number().min(0).required(),
  startDate: Yup.date().required(),
  durationYears: Yup.number().moreThan(0).required()
});

const initialValues = {
  name: '',
  propertyId: '',
  baseAmount: '',
  rate: '',
  startDate: '',
  durationYears: ''
};

function DepreciationDialog({ open, setOpen, depreciation }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const formRef = useRef();

  const handleClose = useCallback(() => setOpen(false), [setOpen]);

  const _onSubmit = useCallback(
    async (depreciationPart) => {
      try {
        setIsLoading(true);
        const { status } = depreciation
          ? await store.cashflow.updateDepreciation({
              ...depreciation,
              ...depreciationPart
            })
          : await store.cashflow.createDepreciation(depreciationPart);
        if (status !== 200) {
          return toast.error(t('Something went wrong'));
        }
        queryClient.invalidateQueries({ queryKey: [QueryKeys.DEPRECIATIONS] });
        // The monthly depreciation is part of the analysis, not of this list only.
        queryClient.invalidateQueries({ queryKey: [QueryKeys.CASHFLOW] });
        handleClose();
      } finally {
        setIsLoading(false);
      }
    },
    [depreciation, handleClose, queryClient, store, t]
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

  return (
    <ResponsiveDialog
      open={open}
      setOpen={setOpen}
      isLoading={isLoading}
      renderHeader={() =>
        depreciation ? t('Edit the depreciation') : t('Add a depreciation')
      }
      renderContent={() => (
        <Formik
          initialValues={
            depreciation
              ? {
                  ...initialValues,
                  ...depreciation,
                  startDate: depreciation.startDate
                    ? moment(depreciation.startDate)
                    : ''
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
              <div className="space-y-1">
                <NumberField
                  label={t('Depreciation base amount')}
                  name="baseAmount"
                />
                {/* BR-22: the land share cannot be depreciated, and no one is
                    going to remember that at the moment they type the number. */}
                <p className="text-xs text-muted-foreground">
                  {t(
                    'The building share of the acquisition cost, excluding the land share: land is not depreciable'
                  )}
                </p>
              </div>
              <NumberField
                label={t('Depreciation rate (% per year)')}
                name="rate"
              />
              <NumberField
                label={t('Useful life (years)')}
                name="durationYears"
              />
              <DateField label={t('Start date')} name="startDate" />
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
            data-cy="submitDepreciation"
          >
            {depreciation ? t('Save') : t('Add')}
          </Button>
        </>
      )}
    />
  );
}

function DepreciationCard({ depreciation, onEdit, onDelete }) {
  const { t } = useTranslation('common');

  return (
    <Card data-cy="depreciationCard">
      <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="font-medium">{depreciation.name}</div>
          <div className="text-xs text-muted-foreground">
            {t('{{rate}}% per year over {{durationYears}} years', {
              rate: depreciation.rate,
              durationYears: depreciation.durationYears
            })}
          </div>
          <div className="text-xs text-muted-foreground">
            {t('Since {{startDate}}', {
              startDate: moment(depreciation.startDate).format('L')
            })}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <NumberFormat
              value={depreciation.baseAmount}
              className="font-medium"
              showZero={true}
            />
            <div className="text-xs text-muted-foreground">
              {t('Depreciation base amount')}
            </div>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onEdit(depreciation)}
          >
            <LuPencil className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onDelete(depreciation)}
          >
            <LuTrash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DepreciationsPanel({ propertyId }) {
  const { t } = useTranslation('common');
  const store = useContext(StoreContext);
  const queryClient = useQueryClient();
  const [openForm, setOpenForm] = useState(false);
  const [openConfirmDelete, setOpenConfirmDelete] = useState(false);
  const [selectedDepreciation, setSelectedDepreciation] = useState();

  const { isError } = useQuery({
    queryKey: [QueryKeys.DEPRECIATIONS, propertyId],
    queryFn: () => fetchDepreciations(store, propertyId)
  });
  useQuery({
    queryKey: [QueryKeys.PROPERTIES],
    queryFn: () => fetchProperties(store)
  });

  if (isError) {
    toast.error(t('Error fetching depreciations'));
  }

  const handleAdd = useCallback(() => {
    setSelectedDepreciation(undefined);
    setOpenForm(true);
  }, []);

  const handleEdit = useCallback((depreciation) => {
    setSelectedDepreciation(depreciation);
    setOpenForm(true);
  }, []);

  const handleDelete = useCallback((depreciation) => {
    setSelectedDepreciation(depreciation);
    setOpenConfirmDelete(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const { status } = await store.cashflow.deleteDepreciation(
      selectedDepreciation._id
    );
    if (status !== 200) {
      toast.error(t('Something went wrong'));
      return;
    }
    queryClient.invalidateQueries({ queryKey: [QueryKeys.DEPRECIATIONS] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.CASHFLOW] });
  }, [queryClient, selectedDepreciation, store, t]);

  return (
    <div className="space-y-4">
      <Alert>
        <div className="text-sm text-muted-foreground">
          {t(
            'A depreciation lowers your taxable result but is never a payment: it does not appear on your bank statement'
          )}
        </div>
      </Alert>

      <div className="flex justify-end">
        <Button onClick={handleAdd} data-cy="openDepreciationDialog">
          <LuPlus className="size-4" />
          {t('Add a depreciation')}
        </Button>
      </div>

      {store.cashflow.depreciations.length ? (
        <div className="space-y-3">
          {store.cashflow.depreciations.map((depreciation) => (
            <DepreciationCard
              key={depreciation._id}
              depreciation={depreciation}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : (
        <EmptyIllustration label={t('No depreciation recorded yet')} />
      )}

      {openForm ? (
        <DepreciationDialog
          open={openForm}
          setOpen={setOpenForm}
          depreciation={selectedDepreciation}
        />
      ) : null}

      <ConfirmDialog
        title={t('Are you sure to remove this depreciation?')}
        subTitle={selectedDepreciation?.name}
        open={openConfirmDelete}
        setOpen={setOpenConfirmDelete}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

export default observer(DepreciationsPanel);
