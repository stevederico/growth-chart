import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

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

const chartConfig = {
  downloads: {
    label: "Downloads",
  },
  total: {
    label: "Total",
    color: "var(--primary)",
  },
}

/**
 * Interactive area chart showing cumulative downloads over time.
 *
 * Matches the skateboard boilerplate ChartAreaInteractive layout —
 * time range toggle (7d/30d/90d) with responsive mobile select.
 * Accepts download snapshot data as props instead of hardcoded visitor data.
 *
 * @component
 * @param {Object} props
 * @param {Array<{date: string, total: number}>} props.data - Download snapshots with date and total
 * @returns {JSX.Element}
 */
export function ChartAreaInteractive({ data = [] }) {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState(() => isMobile ? "7d" : "90d")

  const filteredData = React.useMemo(() => {
    if (!data.length) return []
    const referenceDate = new Date(data[data.length - 1].date)
    let daysToSubtract = 90
    if (timeRange === "30d") {
      daysToSubtract = 30
    } else if (timeRange === "7d") {
      daysToSubtract = 7
    }
    const startDate = new Date(referenceDate)
    startDate.setDate(startDate.getDate() - daysToSubtract)
    return data.filter((item) => new Date(item.date) >= startDate)
  }, [timeRange, data])

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Total Downloads</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            Cumulative downloads over time
          </span>
          <span className="@[540px]/card:hidden">Download history</span>
        </CardDescription>
        <CardAction>
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
              dataKey="total"
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
