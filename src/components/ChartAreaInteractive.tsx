import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@stevederico/skateboard-ui/shadcn/ui/card"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@stevederico/skateboard-ui/shadcn/ui/toggle-group"

/** A single point plotted on the area chart. */
interface MetricPoint {
  date: string;
  total: number;
}

/** Supported metric type keys. */
type MetricType = 'downloads' | 'stars' | 'forks' | 'views' | 'clones'

/** Parse YYYY-MM-DD as local date (avoids UTC midnight → previous-day shift) */
function parseLocalDate(str: string): Date {
  return new Date(str + 'T00:00:00')
}

/** Format a date string for display */
function fmtDate(str: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(parseLocalDate(str))
}

/** Human-readable labels for each metric type. */
const METRIC_LABELS: Record<MetricType, string> = {
  downloads: 'Downloads',
  stars: 'Stars',
  forks: 'Forks',
  views: 'Page Views',
  clones: 'Clones',
}

/** Props passed to the custom chart tooltip (recharts callback shape). */
interface CustomTooltipProps {
  /** Whether the tooltip is currently active */
  active?: boolean;
  /** Recharts payload entries, each carrying the hovered data point */
  payload?: Array<{ payload: MetricPoint }>;
  /** Current metric type for the label */
  metricType?: MetricType;
}

/**
 * Custom tooltip for the area chart.
 *
 * @param props - Recharts tooltip callback props
 * @returns Tooltip element, or null when inactive
 */
function CustomTooltip({ active, payload, metricType = 'downloads' }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const { date, total } = payload[0].payload
  const label = (METRIC_LABELS[metricType] || 'Downloads').toLowerCase()
  return (
    <div className="border-border/50 bg-background rounded-lg border px-3 py-2 text-xs shadow-xl">
      <div className="font-medium">{fmtDate(date)}</div>
      <div className="text-muted-foreground mt-1 tabular-nums">
        {total.toLocaleString()} {label}
      </div>
    </div>
  )
}

/** Props for the ChartAreaInteractive component. */
interface ChartAreaInteractiveProps {
  /** Cumulative metric snapshots */
  data?: MetricPoint[];
  /** Daily metric deltas */
  dailyData?: MetricPoint[];
  /** Active metric type key */
  metricType?: MetricType;
}

/** Chart display mode: cumulative total or daily deltas. */
type ChartMode = 'growth' | 'total'

/**
 * Interactive area chart — Total (cumulative) or Daily (new per day).
 *
 * Supports multiple metric types (downloads, stars, forks, views, clones)
 * with a toggle between cumulative and daily views.
 *
 * @component
 * @returns Interactive area chart
 */
export function ChartAreaInteractive({ data = [], dailyData = [], metricType = 'downloads' }: ChartAreaInteractiveProps) {
  const [mode, setMode] = React.useState<ChartMode>("growth")
  const activeData = mode === "growth" ? dailyData : data
  const label = METRIC_LABELS[metricType] || 'Downloads'

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{mode === 'total' ? `Total ${label}` : `Daily ${label}`}</CardTitle>
        <CardDescription>
          {mode === 'total' ? `Cumulative ${label.toLowerCase()} over time` : `New ${label.toLowerCase()} per day`}
        </CardDescription>
        <CardAction>
          <ToggleGroup
            value={[mode]}
            onValueChange={(values: string[]) => {
              if (values.length > 0) setMode(values[0] as ChartMode)
            }}
            variant="outline"
            className="*:data-[slot=toggle-group-item]:!px-4"
          >
            <ToggleGroupItem value="growth">Daily</ToggleGroupItem>
            <ToggleGroupItem value="total">Total</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {activeData.length === 0 ? (
          <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
            Not enough data yet
          </div>
        ) : (
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activeData}>
                <defs>
                  <linearGradient id="fillChart" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={fmtDate}
                  className="fill-muted-foreground text-xs"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={40}
                  domain={[0, 'auto']}
                  allowDataOverflow={false}
                  className="fill-muted-foreground text-xs"
                />
                <Tooltip content={(props: any) => <CustomTooltip {...props} metricType={metricType} />} cursor={false} />
                <Area
                  dataKey="total"
                  type="monotone"
                  fill="url(#fillChart)"
                  stroke="var(--primary)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
