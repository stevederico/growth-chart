import { TrendingDown, TrendingUp, Minus, Target } from "lucide-react"

import { Badge } from "@stevederico/skateboard-ui/shadcn/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@stevederico/skateboard-ui/shadcn/ui/card"

/**
 * Format a number with locale-aware grouping.
 *
 * @param {number} num
 * @returns {string}
 */
function fmt(num) {
  return new Intl.NumberFormat().format(num ?? 0)
}

/**
 * Format a YYYY-MM-DD date string for display (e.g. "Apr 6").
 *
 * @param {string} dateStr - YYYY-MM-DD date string
 * @returns {string}
 */
function fmtDate(dateStr) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(dateStr + 'T00:00:00'))
}

/**
 * Three metric cards: WoW growth, 20% goal tracker, and downloads today.
 *
 * @component
 * @param {Object} props
 * @param {number|null} props.wowGrowth - Week-over-week growth percentage (null if insufficient data)
 * @param {number} props.downloadsToday - Downloads in the latest daily delta
 * @param {number|null} props.goalNeeded - Downloads needed to hit 20% WoW target
 * @param {string|null} props.goalDeadline - YYYY-MM-DD deadline to hit 20% WoW target
 * @returns {JSX.Element}
 */
export function SectionCards({ wowGrowth = null, downloadsToday = 0, goalNeeded = null, goalDeadline = null }) {
  const hasGrowth = wowGrowth !== null
  const isGrowthUp = hasGrowth && wowGrowth > 0
  const isGrowthDown = hasGrowth && wowGrowth < 0
  const isTodayUp = downloadsToday > 0
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
            {hasGoal ? (isGoalHit ? 'Hit!' : `${fmt(goalNeeded)} needed`) : '--'}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <Target />
              {hasGoal ? `by ${fmtDate(goalDeadline)}` : 'goal'}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {isGoalHit ? 'Target reached' : hasGoal ? `${fmt(goalNeeded)} downloads to go` : 'Need more data'}
            {isGoalHit ? <TrendingUp className="size-4" /> : <Target className="size-4" />}
          </div>
          <div className="text-muted-foreground">
            {hasGoal ? `Deadline: ${fmtDate(goalDeadline)}` : 'Requires 7+ days of data'}
          </div>
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Downloads Today</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {fmt(downloadsToday)}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              {isTodayUp ? <TrendingUp /> : <TrendingDown />}
              {isTodayUp ? `+${fmt(downloadsToday)}` : '0'}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {isTodayUp ? 'New downloads today' : 'No new downloads yet'}
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
