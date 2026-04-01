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
 * Format an ISO date string to a readable display (e.g. "Mar 29, 2026").
 *
 * @param {string} dateStr - ISO date string
 * @returns {string}
 */
function fmtDate(dateStr) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(dateStr + 'T00:00:00'))
}

/**
 * Per-release download breakdown table.
 *
 * Shows each release tag, its cumulative download count,
 * and a 7-day trend indicator. Sorted by downloads descending.
 *
 * @component
 * @param {Object} props
 * @param {Array<{tag: string, download_count: number}>} props.data - Release download data
 * @returns {JSX.Element}
 */
/**
 * Daily download totals table.
 *
 * Shows each date and its total new downloads, sorted most recent first.
 *
 * @component
 * @param {Object} props
 * @param {Array<{date: string, total: number}>} props.data - Daily delta data
 * @returns {JSX.Element}
 */
export function DailyTable({ data = [] }) {
  const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Downloads</CardTitle>
        <CardDescription>
          New downloads per day
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Downloads</TableHead>
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

export function DataTable({ data = [] }) {
  const sorted = [...data].sort((a, b) =>
    b.tag?.localeCompare(a.tag, undefined, { numeric: true })
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Releases</CardTitle>
        <CardDescription>
          Per-release download breakdown
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Release</TableHead>
                <TableHead className="text-right">Downloads</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((release) => (
                <TableRow key={release.tag}>
                  <TableCell className="font-medium">{release.tag}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(release.download_count)}
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
