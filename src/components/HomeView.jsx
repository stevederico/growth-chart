import { useState, useEffect, useMemo, useCallback } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Download, TrendingUp, Tag, Package, RefreshCw, CircleAlert } from 'lucide-react';
import { apiRequest } from '@stevederico/skateboard-ui/Utilities';
import Header from '@stevederico/skateboard-ui/Header';
import { Button } from '@stevederico/skateboard-ui/shadcn/ui/button';
import { Spinner } from '@stevederico/skateboard-ui/shadcn/ui/spinner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@stevederico/skateboard-ui/shadcn/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@stevederico/skateboard-ui/shadcn/ui/chart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@stevederico/skateboard-ui/shadcn/ui/table';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@stevederico/skateboard-ui/shadcn/ui/empty';

const CHART_CONFIG = {
  total: {
    label: 'Downloads',
    color: 'var(--color-app)',
  },
};

/**
 * Format a number with locale-aware grouping (e.g. 1,234).
 *
 * @param {number} num - Number to format
 * @returns {string} Formatted number string
 */
function formatNumber(num) {
  return new Intl.NumberFormat().format(num ?? 0);
}

/**
 * Format an ISO date string to a short display (e.g. "Mar 29").
 *
 * @param {string} dateStr - ISO date string
 * @returns {string} Formatted short date
 */
function formatShortDate(dateStr) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(dateStr));
}

/**
 * Top stats row showing four metric cards.
 *
 * @component
 * @param {Object} props
 * @param {number} props.totalDownloads - All-time cumulative download count
 * @param {number} props.downloadsToday - Latest daily delta
 * @param {number} props.activeReleases - Number of releases with downloads
 * @param {string} props.latestVersion - Most recent release tag
 * @returns {JSX.Element} Four stat cards in a responsive grid
 */
function StatsRow({ totalDownloads, downloadsToday, activeReleases, latestVersion }) {
  const cards = [
    {
      label: 'Total Downloads',
      value: formatNumber(totalDownloads),
      icon: Download,
    },
    {
      label: 'Downloads Today',
      value: formatNumber(downloadsToday),
      icon: TrendingUp,
    },
    {
      label: 'Active Releases',
      value: formatNumber(activeReleases),
      icon: Package,
    },
    {
      label: 'Latest Version',
      value: latestVersion || '--',
      icon: Tag,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardDescription>{card.label}</CardDescription>
              <card.icon size={16} className="text-muted-foreground" />
            </div>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {card.value}
            </CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

/**
 * Area chart showing daily download totals over time.
 *
 * @component
 * @param {Object} props
 * @param {Array<{date: string, total: number}>} props.data - Daily download data
 * @returns {JSX.Element} Recharts AreaChart inside a Card
 */
function DownloadsChart({ data }) {
  if (!data?.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-balance">Daily Downloads</CardTitle>
          <CardDescription>No chart data available yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-balance">Daily Downloads</CardTitle>
        <CardDescription>
          Download activity over time
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={CHART_CONFIG}
          className="aspect-auto h-[280px] w-full"
        >
          <AreaChart data={data}>
            <defs>
              <linearGradient id="fillDownloads" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-total)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-total)"
                  stopOpacity={0.05}
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
              tickFormatter={formatShortDate}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={48}
              tickFormatter={(v) => formatNumber(v)}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => formatShortDate(value)}
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey="total"
              type="monotone"
              fill="url(#fillDownloads)"
              stroke="var(--color-total)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

/**
 * Table showing per-release download breakdown.
 *
 * @component
 * @param {Object} props
 * @param {Array<{tag: string, total: number}>} props.releases - Release download data
 * @param {Array<{date: string, releases: Array<{tag: string, delta: number}>}>} props.dailyData - Daily deltas for trend
 * @returns {JSX.Element} Table with release stats
 */
function ReleasesTable({ releases, dailyData }) {
  /** Build a map of tag -> last 7 days of deltas for sparkline-style trend display */
  const trendMap = useMemo(() => {
    if (!dailyData?.length) return {};
    const recentDays = dailyData.slice(-7);
    const map = {};
    for (const day of recentDays) {
      if (!day.releases) continue;
      for (const rel of day.releases) {
        if (!map[rel.tag]) map[rel.tag] = [];
        map[rel.tag].push(rel.delta);
      }
    }
    return map;
  }, [dailyData]);

  if (!releases?.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-balance">Releases</CardTitle>
          <CardDescription>No release data available yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-balance">Releases</CardTitle>
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
                <TableHead className="text-right">Total Downloads</TableHead>
                <TableHead className="text-right">7-Day Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {releases.map((release) => {
                const trend = trendMap[release.tag] || [];
                const trendTotal = trend.reduce((sum, d) => sum + d, 0);
                return (
                  <TableRow key={release.tag}>
                    <TableCell className="font-medium">{release.tag}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(release.total)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {trendTotal > 0 ? (
                        <span className="text-success flex items-center justify-end gap-1">
                          <TrendingUp size={14} />
                          +{formatNumber(trendTotal)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Downloads dashboard view for Growth Chart.
 *
 * Fetches daily download deltas and latest snapshot from the API,
 * then renders stats cards, an area chart, and a releases table.
 * Handles loading, error, and empty states.
 *
 * @component
 * @returns {JSX.Element} Full dashboard view
 */
export default function HomeView() {
  const [dailyData, setDailyData] = useState(null);
  const [latestSnapshot, setLatestSnapshot] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [daily, latest] = await Promise.all([
        apiRequest('/downloads/daily'),
        apiRequest('/downloads/latest'),
      ]);
      setDailyData(daily);
      setLatestSnapshot(latest);
    } catch (err) {
      console.error('Failed to fetch download data:', err);
      setError('Unable to load download data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /** Trigger a manual snapshot then refresh all data */
  const handleSnapshot = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await apiRequest('/downloads/snapshot', { method: 'POST' });
      await fetchData();
    } catch (err) {
      console.error('Snapshot failed:', err);
      setError('Snapshot failed. Please try again.');
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchData]);

  /** Derive stats from the latest snapshot */
  const stats = useMemo(() => {
    if (!latestSnapshot) {
      return { totalDownloads: 0, downloadsToday: 0, activeReleases: 0, latestVersion: null };
    }

    const releases = latestSnapshot.releases || [];
    const totalDownloads = latestSnapshot.total ?? releases.reduce((sum, r) => sum + (r.total || 0), 0);
    const activeReleases = releases.filter((r) => (r.total || 0) > 0).length;

    /** Sort by semver-like tag to find latest */
    const sorted = [...releases].sort((a, b) => b.tag?.localeCompare(a.tag, undefined, { numeric: true }));
    const latestVersion = sorted[0]?.tag || null;

    /** Today's downloads from the daily data (last entry) */
    const todayEntry = dailyData?.length ? dailyData[dailyData.length - 1] : null;
    const downloadsToday = todayEntry?.total ?? 0;

    return { totalDownloads, downloadsToday, activeReleases, latestVersion };
  }, [latestSnapshot, dailyData]);

  /** Sort releases by total downloads descending for the table */
  const sortedReleases = useMemo(() => {
    if (!latestSnapshot?.releases) return [];
    return [...latestSnapshot.releases].sort((a, b) => (b.total || 0) - (a.total || 0));
  }, [latestSnapshot]);

  if (isLoading) {
    return (
      <>
        <Header title="Dashboard" />
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </>
    );
  }

  if (error && !latestSnapshot) {
    return (
      <>
        <Header title="Dashboard" />
        <div className="flex flex-1 items-center justify-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleAlert size={24} />
              </EmptyMedia>
              <EmptyTitle>Failed to load data</EmptyTitle>
              <EmptyDescription>{error}</EmptyDescription>
            </EmptyHeader>
            <Button onClick={fetchData}>Try again</Button>
          </Empty>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Dashboard">
        <Button
          variant="outline"
          size="sm"
          onClick={handleSnapshot}
          disabled={isRefreshing}
          aria-label="Take snapshot"
        >
          <RefreshCw size={16} className={isRefreshing ? 'animate-spin motion-reduce:animate-none' : ''} />
          Snapshot
        </Button>
      </Header>
      <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
        <StatsRow
          totalDownloads={stats.totalDownloads}
          downloadsToday={stats.downloadsToday}
          activeReleases={stats.activeReleases}
          latestVersion={stats.latestVersion}
        />
        <DownloadsChart data={dailyData} />
        <ReleasesTable releases={sortedReleases} dailyData={dailyData} />
      </div>
    </>
  );
}
