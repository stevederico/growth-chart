import { TrendingDown, TrendingUp, Minus, Target } from "@stevederico/skateboard-ui/icons"

import { Badge } from "@stevederico/skateboard-ui/shadcn/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@stevederico/skateboard-ui/shadcn/ui/card"

/** Supported metric type keys. */
type MetricType = 'downloads' | 'stars' | 'forks' | 'views' | 'clones'

/**
 * Format a number with locale-aware grouping.
 */
function fmt(num: number): string {
  return new Intl.NumberFormat().format(num ?? 0)
}

/**
 * Format a YYYY-MM-DD date string for display (e.g. "Apr 6").
 *
 * @param dateStr - YYYY-MM-DD date string
 */
function fmtDate(dateStr: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(dateStr + 'T00:00:00'))
}

/** Human-readable labels for each metric type. */
const METRIC_LABELS: Record<MetricType, string> = {
  downloads: 'Downloads',
  stars: 'Stars',
  forks: 'Forks',
  views: 'Page Views',
  clones: 'Clones',
}

/** Props for the SectionCards component. */
interface SectionCardsProps {
  /** Week-over-week growth percentage (null if insufficient data) */
  wowGrowth?: number | null;
  /** Count in the latest daily delta */
  valueToday?: number;
  /** Count needed to hit 20% WoW target */
  goalNeeded?: number | null;
  /** YYYY-MM-DD deadline to hit 20% WoW target */
  goalDeadline?: string | null;
  /** Active metric type key */
  metricType?: MetricType;
}

/**
 * Three metric cards: WoW growth, 20% goal tracker, and value today.
 *
 * @component
 * @returns Three metric cards
 */
export function SectionCards({ wowGrowth = null, valueToday = 0, goalNeeded = null, goalDeadline = null, metricType = 'downloads' }: SectionCardsProps) {
  const metricLabel = METRIC_LABELS[metricType] || 'Downloads'
  const hasGrowth = wowGrowth !== null
  const isGrowthUp = hasGrowth && wowGrowth > 0
  const isGrowthDown = hasGrowth && wowGrowth < 0
  const isTodayUp = valueToday > 0
  const hasGoal = goalNeeded !== null && goalDeadline !== null
  const isGoalHit = hasGoal && goalNeeded === 0

  return (
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-3">
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Week over Week</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {hasGrowth ? `${wowGrowth >= 0 ? '+' : ''}${wowGrowth.toFixed(1)}%` : '--'}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              {isGrowthUp ? <TrendingUp /> : isGrowthDown ? <TrendingDown /> : <Minus />}
              7-day
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {isGrowthUp ? 'Growing' : isGrowthDown ? 'Declining' : 'Not enough data'}
            {isGrowthUp ? <TrendingUp className="size-4" /> : isGrowthDown ? <TrendingDown className="size-4" /> : <Minus className="size-4" />}
          </div>
          <div className="text-muted-foreground">
            Compared to previous 7 days
          </div>
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>20% Growth Goal</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {goalNeeded !== null && goalDeadline !== null
              ? (goalNeeded === 0 ? 'Hit!' : `${fmt(goalNeeded)} needed`)
              : '--'}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <Target />
              {goalDeadline !== null ? `by ${fmtDate(goalDeadline)}` : 'goal'}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {isGoalHit ? 'Target reached' : goalNeeded !== null ? `${fmt(goalNeeded)} to go` : 'Need more data'}
            {isGoalHit ? <TrendingUp className="size-4" /> : <Target className="size-4" />}
          </div>
          <div className="text-muted-foreground">
            {goalDeadline !== null ? `Deadline: ${fmtDate(goalDeadline)}` : 'Requires 7+ days of data'}
          </div>
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>{metricLabel} Today</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {fmt(valueToday)}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              {isTodayUp ? <TrendingUp /> : <TrendingDown />}
              {isTodayUp ? `+${fmt(valueToday)}` : '0'}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {isTodayUp ? `New ${metricLabel.toLowerCase()} today` : `No new ${metricLabel.toLowerCase()} yet`}
            {isTodayUp ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
          </div>
          <div className="text-muted-foreground">
            Daily delta from snapshot
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
