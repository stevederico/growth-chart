import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts"

import { useIsMobile } from "@stevederico/skateboard-ui/shadcn/hooks/use-mobile"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@stevederico/skateboard-ui/shadcn/ui/card"
import {
  ChartContainer,
} from "@stevederico/skateboard-ui/shadcn/ui/chart"
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

const chartConfig = {
  total: {
    label: "Downloads",
    color: "var(--primary)",
  },
}

/**
 * Custom tooltip to avoid shadcn ChartTooltipContent config lookup issues.
 *
 * @param {Object} props - Recharts tooltip props
 * @returns {JSX.Element|null}
 */
function CustomTooltip({ active, payload, label: mode }) {
  if (!active || !payload?.length) return null
  const { date, total } = payload[0].payload
  return (
    <div className="border-border/50 bg-background rounded-lg border px-3 py-2 text-xs shadow-xl">
      <div className="font-medium">{fmtDate(date)}</div>
      <div className="text-muted-foreground mt-1 tabular-nums">
        {mode === "growth" ? "+" : ""}{total.toLocaleString()} downloads
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
  const isMobile = useIsMobile()
  const [mode, setMode] = React.useState("total")

  const activeData = mode === "growth" ? dailyData : data

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{MODES[mode].label}</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            {MODES[mode].description}
          </span>
          <span className="@[540px]/card:hidden">
            {mode === "growth" ? "Daily downloads" : "Download history"}
          </span>
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
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[250px] w-full"
          >
            <AreaChart data={activeData}>
              <defs>
                <linearGradient id="fillTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-total)"
                    stopOpacity={1.0}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-total)"
                    stopOpacity={0.1}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={fmtDate}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={40}
              />
              <Tooltip
                cursor={false}
                content={<CustomTooltip label={mode} />}
              />
              <Area
                name="total"
                dataKey="total"
                type="natural"
                fill="url(#fillTotal)"
                stroke="var(--color-total)"
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
