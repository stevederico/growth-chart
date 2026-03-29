import { TrendingUp } from "lucide-react"
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
export function DataTable({ data = [] }) {
  const sorted = [...data].sort((a, b) =>
    (b.download_count || 0) - (a.download_count || 0)
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
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((release) => (
                <TableRow key={release.tag}>
                  <TableCell className="font-medium">{release.tag}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(release.download_count)}
                  </TableCell>
                  <TableCell className="text-right">
                    {release.download_count > 0 ? (
                      <span className="inline-flex items-center gap-1 text-emerald-500">
                        <TrendingUp size={14} />
                        Active
                      </span>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
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
