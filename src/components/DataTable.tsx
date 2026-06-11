import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@stevederico/skateboard-ui/shadcn/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@stevederico/skateboard-ui/shadcn/ui/table"

/** A single day's metric total. */
interface MetricPoint {
  date: string;
  total: number;
}

/** Supported metric type keys. */
type MetricType = 'downloads' | 'stars' | 'forks' | 'views' | 'clones'

/**
 * Format a number with locale-aware grouping.
 */
function fmt(num: number): string {
  return new Intl.NumberFormat().format(num ?? 0)
}

/**
 * Format an ISO date string to a readable display (e.g. "Mar 29, 2026").
 *
 * @param dateStr - ISO date string
 */
function fmtDate(dateStr: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
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

/** Props for the DailyTable component. */
interface DailyTableProps {
  /** Daily delta data */
  data?: MetricPoint[];
  /** Active metric type key */
  metricType?: MetricType;
}

/**
 * Daily metric totals table.
 *
 * Shows each date and its total new count, sorted most recent first.
 * Supports multiple metric types via the metricType prop.
 *
 * @component
 * @returns Daily metric totals table
 */
export function DailyTable({ data = [], metricType = 'downloads' }: DailyTableProps) {
  const metricLabel = METRIC_LABELS[metricType] || 'Downloads'
  const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{`Daily ${metricLabel}`}</CardTitle>
        <CardDescription>
          {`New ${metricLabel.toLowerCase()} per day`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">{metricLabel}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((day) => (
                <TableRow key={day.date}>
                  <TableCell className="font-medium">{fmtDate(day.date)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    +{fmt(day.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
