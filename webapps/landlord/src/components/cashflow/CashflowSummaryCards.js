import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { LuAlertTriangle, LuCoins, LuWallet } from 'react-icons/lu';
import { Alert } from '../ui/alert';
import { Badge } from '../ui/badge';
import NumberFormat from '../NumberFormat';
import useTranslation from 'next-translate/useTranslation';

function Figure({ label, value, hint, badge, dataCy }) {
  return (
    <Card data-cy={dataCy}>
      <CardContent className="p-4 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{label}</span>
          {badge ? (
            <Badge variant="outline" className="font-normal">
              {badge}
            </Badge>
          ) : null}
        </div>
        <NumberFormat
          value={value}
          showZero={true}
          className="text-xl font-medium"
        />
        {hint ? (
          <div className="text-xs text-muted-foreground">{hint}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function CashflowSummaryCards({ summary }) {
  const { t } = useTranslation('common');

  if (!summary) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* The two result lines are deliberately shown side by side and never
          merged: the depreciation lowers the taxable result but never reaches
          the bank account, while the principal repayment does the opposite. */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card data-cy="operatingCashflowCard">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-normal text-muted-foreground">
              <LuWallet className="size-5" />
              {t('Operating cashflow')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <NumberFormat
              value={summary.operatingCashflow}
              showZero={true}
              withColor
              className="text-3xl font-semibold"
            />
            <div className="text-xs text-muted-foreground">
              {t(
                'Cash actually received minus cash actually paid, principal repayment included'
              )}
            </div>
          </CardContent>
        </Card>

        <Card data-cy="taxableResultCard">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-normal text-muted-foreground">
              <LuCoins className="size-5" />
              {t('Taxable result')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <NumberFormat
              value={summary.taxableResult}
              showZero={true}
              withColor
              className="text-3xl font-semibold"
            />
            <div className="text-xs text-muted-foreground">
              {t(
                'Principal repayment is not an expense, depreciation is: this is not your cashflow'
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Figure
          label={t('Income')}
          value={summary.totalIncome}
          hint={t('Security deposits excluded')}
          dataCy="totalIncomeFigure"
        />
        <Figure
          label={t('Expenses')}
          value={summary.totalExpenses}
          dataCy="totalExpensesFigure"
        />
        <Figure
          label={t('Depreciation (AfA)')}
          value={summary.depreciation}
          badge={t('Non-cash')}
          hint={t('Lowers the taxable result, never the bank balance')}
          dataCy="depreciationFigure"
        />
        <Figure
          label={t('Loan interest')}
          value={summary.interestExpense}
          hint={t('Deductible expense')}
          dataCy="interestExpenseFigure"
        />
        <Figure
          label={t('Loan principal repayment')}
          value={summary.principalRepayment}
          hint={t('Cash out, but not an expense')}
          dataCy="principalRepaymentFigure"
        />
        <Figure
          label={t('Security deposits')}
          value={summary.deposits}
          hint={t('Held in trust, neither income nor taxable')}
          dataCy="depositsFigure"
        />
      </div>

      {summary.uncategorizedCount ? (
        <Alert variant="warning" data-cy="uncategorizedAlert">
          <div className="flex items-center gap-4">
            <LuAlertTriangle className="size-6" />
            <div className="text-sm">
              {t(
                '{{count}} transactions could not be classified and are shown as unclassified',
                { count: summary.uncategorizedCount }
              )}
            </div>
          </div>
        </Alert>
      ) : null}

      {summary.hasForeignCurrency ? (
        <Alert variant="warning" data-cy="foreignCurrencyAlert">
          <div className="flex items-center gap-4">
            <LuAlertTriangle className="size-6" />
            <div className="text-sm">
              {t(
                'Some transactions are in another currency and are counted without conversion'
              )}
            </div>
          </div>
        </Alert>
      ) : null}
    </div>
  );
}
