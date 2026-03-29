import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

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
  ChartTooltip,
  ChartTooltipContent,
} from "@stevederico/skateboard-ui/shadcn/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@stevederico/skateboard-ui/shadcn/ui/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@stevederico/skateboard-ui/shadcn/ui/toggle-group"

const MODES = {
  total: { label: "Total Downloads", description: "Cumulative downloads over time" },
  growth: { label: "Growth Rate", description: "Daily new downloads" },
}

const chartConfig = {
  total: {
    label: "Total",
    color: "var(--primary)",
  },
  growth: {
    label: "Daily",
    color: "var(--primary)",
  },
}

/**
 * Interactive area chart with mode toggle — Total (cumulative) or Growth Rate (daily deltas).
 *
 * @component
 * @param {Object} props
 * @param {Array<{date: string, total: number}>} props.data - Cumulative download snapshots
 * @param {Array<{date: string, total: number}>} props.dailyData - Daily download deltas
 * @returns {JSX.Element}
 */
export function ChartAreaInteractive({ data = [], dailyData = [] }) {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState(() => isMobile ? "7d" : "90d")
  const [mode, setMode] = React.useState("total")

  const activeData = mode === "growth" ? dailyData : data
  const dataKey = mode === "growth" ? "total" : "total"

  const filteredData = React.useMemo(() => {
    if (!activeData.length) return []
    const referenceDate = new Date(activeData[activeData.length - 1].date)
    let daysToSubtract = 90
    if (timeRange === "30d") {
      daysToSubtract = 30
    } else if (timeRange === "7d") {
      daysToSubtract = 7
    }
    const startDate = new Date(referenceDate)
    startDate.setDate(startDate.getDate() - daysToSubtract)
    return activeData.filter((item) => new Date(item.date) >= startDate)
  }, [timeRange, activeData])

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
        <CardAction className="flex flex-col gap-2 @[767px]/card:flex-row">
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && setMode(v)}
            variant="outline"
            className="*:data-[slot=toggle-group-item]:!px-4"
          >
            <ToggleGroupItem value="total">Total</ToggleGroupItem>
            <ToggleGroupItem value="growth">Growth</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            value={timeRange}
            onValueChange={setTimeRange}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:!px-4 @[767px]/card:flex"
          >
            <ToggleGroupItem value="90d">Last 3 months</ToggleGroupItem>
            <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
            <ToggleGroupItem value="7d">Last 7 days</ToggleGroupItem>
          </ToggleGroup>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label="Select a value"
            >
              <SelectValue placeholder="Last 3 months" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="90d" className="rounded-lg">
                Last 3 months
              </SelectItem>
              <SelectItem value="30d" className="rounded-lg">
                Last 30 days
              </SelectItem>
              <SelectItem value="7d" className="rounded-lg">
                Last 7 days
              </SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[250px] w-full"
        >
          <AreaChart data={filteredData}>
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
              tickFormatter={(value) => {
                const date = new Date(value)
                return new Intl.DateTimeFormat(undefined, {
                  month: "short",
                  day: "numeric",
                }).format(date)
              }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={40}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => {
                    return new Intl.DateTimeFormat(undefined, {
                      month: "short",
                      day: "numeric",
                    }).format(new Date(value))
                  }}
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey={dataKey}
              type="natural"
              fill="url(#fillTotal)"
              stroke="var(--color-total)"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
