import { TrendingDown, TrendingUp } from "lucide-react"

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
 * Four metric cards showing download stats.
 *
 * Matches the skateboard boilerplate SectionCards layout exactly —
 * gradient cards with badge, footer trend line, and description.
 *
 * @component
 * @param {Object} props
 * @param {number} props.totalDownloads - All-time cumulative downloads
 * @param {number} props.downloadsToday - Downloads in the latest daily delta
 * @param {number} props.activeReleases - Releases with at least 1 download
 * @param {string} props.latestVersion - Most recent release tag
 * @returns {JSX.Element}
 */
export function SectionCards({ totalDownloads = 0, downloadsToday = 0 }) {
  const isUp = downloadsToday > 0

  return (
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2">
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Total Downloads</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {fmt(totalDownloads)}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <TrendingUp />
              All time
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Across all releases <TrendingUp className="size-4" />
          </div>
          <div className="text-muted-foreground">
            Cumulative download count
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
              {isUp ? <TrendingUp /> : <TrendingDown />}
              {isUp ? `+${fmt(downloadsToday)}` : '0'}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {isUp ? 'New downloads today' : 'No new downloads yet'}
            {isUp ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
          </div>
          <div className="text-muted-foreground">
            Daily delta from snapshot
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
