// oxlint-disable-next-line react-doctor/prefer-dynamic-import -- this module is already loaded on demand: mdx-components.ts wraps every export in React.lazy(() => import('@/components/mdx-chart')). The rule scans only this file, so it cannot see the lazy consumer.
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

import { CHART_COLORS } from '@/components/chart-colors'

const CHART_MARGIN = { top: 5, right: 10, left: 0, bottom: 5 }
const AXIS_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' }
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 12,
  color: 'var(--foreground)'
}
const LEGEND_STYLE = { fontSize: 11 }

/**
 * One row of a chart series authored in MDX content. Keys are the column names
 * referenced by `xKey`/`nameKey` and by the series keys; values are either the
 * category label or the measure (`null` leaves a gap in a line).
 */
type MdxChartDatum = Record<string, string | number | null>

type SeriesKey = {
  readonly key: string
  readonly color?: string
  readonly name?: string
}

type MdxLineChartProps = {
  readonly data: ReadonlyArray<MdxChartDatum>
  readonly xKey: string
  readonly lines: ReadonlyArray<SeriesKey>
  readonly height?: number
  /** Text alternative announced to screen readers; charts are otherwise images. */
  readonly title?: string
}

export function MdxLineChart({
  data,
  xKey,
  lines,
  height = 300,
  title
}: MdxLineChartProps) {
  return (
    <figure className="not-prose my-6">
      {/* Text alternative for screen readers — the rendered SVG is an image. */}
      <figcaption className="sr-only">{title ?? 'Line chart'}</figcaption>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={[...data]} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey={xKey} tick={AXIS_TICK} stroke="var(--border)" />
          <YAxis tick={AXIS_TICK} stroke="var(--border)" />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          {lines.length > 1 && <Legend wrapperStyle={LEGEND_STYLE} />}
          {lines.map((l, i) => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              name={l.name ?? l.key}
              stroke={
                l.color ?? CHART_COLORS[i % CHART_COLORS.length] ?? CHART_COLORS[0]
              }
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </figure>
  )
}

type MdxBarChartProps = {
  readonly data: ReadonlyArray<MdxChartDatum>
  readonly xKey: string
  readonly bars: ReadonlyArray<SeriesKey>
  readonly height?: number
  /** Text alternative announced to screen readers; charts are otherwise images. */
  readonly title?: string
}

export function MdxBarChart({
  data,
  xKey,
  bars,
  height = 300,
  title
}: MdxBarChartProps) {
  return (
    <figure className="not-prose my-6">
      {/* Text alternative for screen readers — the rendered SVG is an image. */}
      <figcaption className="sr-only">{title ?? 'Bar chart'}</figcaption>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={[...data]} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey={xKey} tick={AXIS_TICK} stroke="var(--border)" />
          <YAxis tick={AXIS_TICK} stroke="var(--border)" />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          {bars.length > 1 && <Legend wrapperStyle={LEGEND_STYLE} />}
          {bars.map((b, i) => (
            <Bar
              key={b.key}
              dataKey={b.key}
              name={b.name ?? b.key}
              fill={b.color ?? CHART_COLORS[i % CHART_COLORS.length] ?? CHART_COLORS[0]}
              radius={[2, 2, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </figure>
  )
}

type MdxPieChartProps = {
  readonly data: ReadonlyArray<MdxChartDatum>
  readonly nameKey: string
  readonly valueKey: string
  readonly height?: number
  readonly colors?: ReadonlyArray<string>
  /** Text alternative announced to screen readers; charts are otherwise images. */
  readonly title?: string
}

export function MdxPieChart({
  data,
  nameKey,
  valueKey,
  height = 300,
  colors,
  title
}: MdxPieChartProps) {
  const palette = colors ?? CHART_COLORS

  return (
    <figure className="not-prose my-6">
      {/* Text alternative for screen readers — the rendered SVG is an image. */}
      <figcaption className="sr-only">{title ?? 'Pie chart'}</figcaption>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={[...data]}
            dataKey={valueKey}
            nameKey={nameKey}
            cx="50%"
            cy="50%"
            outerRadius={100}
            label
          >
            {data.map((entry, i) => (
              <Cell
                key={String(entry[nameKey])}
                fill={palette[i % palette.length] ?? CHART_COLORS[0]}
              />
            ))}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend wrapperStyle={LEGEND_STYLE} />
        </PieChart>
      </ResponsiveContainer>
    </figure>
  )
}
