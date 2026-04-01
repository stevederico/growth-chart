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

/** Parse YYYY-MM-DD as local date (avoids UTC midnight → previous-day shift) */
function parseLocalDate(str) {
  return new Date(str + 'T00:00:00')
}

/** Format a date string for display */
function fmtDate(str) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(parseLocalDate(str))
}

const MODES = {
  total: { label: "Total Downloads", description: "Cumulative downloads over time" },
  growth: { label: "Daily Downloads", description: "New downloads per day" },
}

/**
 * Custom tooltip for the area chart.
 *
 * @param {Object} props - Recharts tooltip callback props
 * @param {boolean} props.active
 * @param {Array} props.payload
 * @returns {JSX.Element|null}
 */
function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { date, total } = payload[0].payload
  return (
    <div className="border-border/50 bg-background rounded-lg border px-3 py-2 text-xs shadow-xl">
      <div className="font-medium">{fmtDate(date)}</div>
      <div className="text-muted-foreground mt-1 tabular-nums">
        {total.toLocaleString()} downloads
      </div>
    </div>
  )
}

/**
 * Interactive area chart — Total (cumulative) or Daily (new downloads per day).
 *
 * @component
 * @param {Object} props
 * @param {Array<{date: string, total: number}>} props.data - Cumulative download snapshots
 * @param {Array<{date: string, total: number}>} props.dailyData - Daily download deltas
 * @returns {JSX.Element}
 */
export function ChartAreaInteractive({ data = [], dailyData = [] }) {
  const [mode, setMode] = React.useState("total")
  const activeData = mode === "growth" ? dailyData : data

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{MODES[mode].label}</CardTitle>
        <CardDescription>
          {MODES[mode].description}
        </CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && setMode(v)}
            variant="outline"
            className="*:data-[slot=toggle-group-item]:!px-4"
          >
            <ToggleGroupItem value="total">Total</ToggleGroupItem>
            <ToggleGroupItem value="growth">Daily</ToggleGroupItem>
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
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.1} />
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
                  className="fill-muted-foreground text-xs"
                />
                <Tooltip content={CustomTooltip} cursor={false} />
                <Area
                  dataKey="total"
                  type="natural"
                  fill="url(#fillChart)"
                  stroke="hsl(var(--primary))"
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
