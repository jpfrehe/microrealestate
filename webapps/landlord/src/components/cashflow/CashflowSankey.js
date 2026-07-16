import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Layer, Rectangle, Sankey, Tooltip } from 'recharts';
import { ChartContainer } from '../ui/chart';
import { EmptyIllustration } from '../Illustrations';
import { LuGitFork } from 'react-icons/lu';
import { SANKEY_NODE_LABELS } from './labels';
import useFormatNumber from '../../hooks/useFormatNumber';
import useTranslation from 'next-translate/useTranslation';

// Only variables that keep their hue in both themes are used here - the
// --chart-* ones swap around between light and dark, which would let 'expense'
// collide with the orange of 'gap'. 'noncash' is deliberately grey and off the
// income/expense scale: the depreciation is not money (BR-1).
const GROUP_COLORS = {
  income: 'hsl(var(--success))',
  noncash: 'hsl(var(--muted-foreground))',
  expense: 'hsl(var(--primary))',
  gap: 'hsl(var(--warning))',
  total: 'hsl(var(--secondary-foreground))',
  net: 'hsl(var(--success))',
  neutral: 'hsl(var(--secondary-foreground))'
};

function nodeColor(group) {
  return GROUP_COLORS[group] || GROUP_COLORS.neutral;
}

function SankeyNode({ x, y, width, height, index, payload, containerWidth }) {
  const isOut = x + width + 6 > containerWidth;
  return (
    <Layer key={`node-${index}`}>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill={nodeColor(payload.group)}
        fillOpacity={payload.group === 'noncash' ? 0.55 : 1}
        stroke={nodeColor(payload.group)}
        strokeDasharray={payload.group === 'noncash' ? '3 2' : undefined}
        radius={2}
      />
      <text
        textAnchor={isOut ? 'end' : 'start'}
        x={isOut ? x - 6 : x + width + 6}
        y={y + height / 2}
        dominantBaseline="middle"
        className="text-[10px] md:text-xs"
        fill="hsl(var(--foreground))"
      >
        {payload.label}
      </text>
    </Layer>
  );
}

function SankeyLink({
  sourceX,
  targetX,
  sourceY,
  targetY,
  sourceControlX,
  targetControlX,
  linkWidth,
  index,
  payload
}) {
  // The link is coloured after whichever end carries the meaning: an inflow is
  // owned by its source, an outflow by its target - everything leaves the
  // aggregate hub, which says nothing about where it goes.
  const group =
    payload.source.group === 'total'
      ? payload.target.group
      : payload.source.group;

  return (
    <Layer key={`link-${index}`}>
      <path
        d={`
          M${sourceX},${sourceY + linkWidth / 2}
          C${sourceControlX},${sourceY + linkWidth / 2}
            ${targetControlX},${targetY + linkWidth / 2}
            ${targetX},${targetY + linkWidth / 2}
          L${targetX},${targetY - linkWidth / 2}
          C${targetControlX},${targetY - linkWidth / 2}
            ${sourceControlX},${sourceY - linkWidth / 2}
            ${sourceX},${sourceY - linkWidth / 2}
          Z
        `}
        fill={nodeColor(group)}
        fillOpacity={0.25}
        strokeWidth={0}
      />
    </Layer>
  );
}

function SankeyTooltip({ active, payload }) {
  const formatNumber = useFormatNumber();

  if (!active || !payload?.length) {
    return null;
  }

  // Recharts hands over the renderer props of whatever is hovered, so the node
  // resp. the link itself sits one level down. Only a link carries a source.
  const item = payload[0].payload.payload;
  const isLink = !!item.source;

  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <div className="font-medium">
        {isLink ? `${item.source.label} → ${item.target.label}` : item.label}
      </div>
      <div className="text-muted-foreground">{formatNumber(item.value)}</div>
    </div>
  );
}

export default function CashflowSankey({ sankey }) {
  const { t } = useTranslation('common');

  const nodes = sankey?.nodes || [];
  const links = sankey?.links || [];

  return (
    <Card data-cy="cashflowSankey">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
          <LuGitFork className="size-6 text-muted-foreground" />
          {t('Where the money goes')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {nodes.length ? (
          <ChartContainer config={{}} className="h-[520px] w-full">
            <Sankey
              data={{
                // The node names stay untranslated on the wire, so the label is
                // resolved here and read back by the renderers and the tooltip.
                nodes: nodes.map((node) => ({
                  ...node,
                  label: t(SANKEY_NODE_LABELS[node.name] || node.name)
                })),
                links
              }}
              node={<SankeyNode />}
              link={<SankeyLink />}
              nodePadding={26}
              nodeWidth={12}
              margin={{ top: 16, right: 140, bottom: 16, left: 120 }}
            >
              <Tooltip content={<SankeyTooltip />} />
            </Sankey>
          </ChartContainer>
        ) : (
          <EmptyIllustration label={t('No cashflow to show for this month')} />
        )}
      </CardContent>
    </Card>
  );
}
