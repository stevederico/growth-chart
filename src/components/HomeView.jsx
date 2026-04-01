import { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, CircleAlert } from 'lucide-react';
import { apiRequest } from '@stevederico/skateboard-ui/Utilities';
import Header from '@stevederico/skateboard-ui/Header';
import { Button } from '@stevederico/skateboard-ui/shadcn/ui/button';
import { Spinner } from '@stevederico/skateboard-ui/shadcn/ui/spinner';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@stevederico/skateboard-ui/shadcn/ui/empty';
import { SectionCards } from './SectionCards.jsx';
import { ChartAreaInteractive } from './ChartAreaInteractive.jsx';
import { DailyTable, DataTable } from './DataTable.jsx';

/**
 * Dashboard view for Growth Chart download analytics.
 *
 * Composes SectionCards (4 metric cards), ChartAreaInteractive (area chart
 * with time range toggle), and DataTable (per-release breakdown).
 * Fetches data from /api/downloads endpoints.
 *
 * @component
 * @returns {JSX.Element} Dashboard view
 */
export default function HomeView() {
  const [snapshots, setSnapshots] = useState(null);
  const [latestSnapshot, setLatestSnapshot] = useState(null);
  const [dailyData, setDailyData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [allData, latest, daily] = await Promise.all([
        apiRequest('/downloads'),
        apiRequest('/downloads/latest'),
        apiRequest('/downloads/daily'),
      ]);
      setSnapshots(allData);
      setLatestSnapshot(latest);
      setDailyData(daily);
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

  /** Build chart data from snapshots — one point per date with total downloads */
  const chartData = useMemo(() => {
    if (!snapshots?.length) return [];
    const byDate = new Map();
    for (const s of snapshots) {
      const current = byDate.get(s.date) || 0;
      byDate.set(s.date, current + s.download_count);
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, total]) => ({ date, total }));
  }, [snapshots]);

  /** Derive stats from the latest snapshot and daily deltas */
  const stats = useMemo(() => {
    if (!latestSnapshot) {
      return { wowGrowth: null, downloadsToday: 0, goalNeeded: null, goalDeadline: null };
    }

    const today = new Date().toISOString().split('T')[0];
    const todayEntry = (dailyData || []).find((d) => d.date === today);
    const downloadsToday = todayEntry?.total || 0;

    let wowGrowth = null;
    let goalNeeded = null;
    let goalDeadline = null;

    if (chartData.length >= 2) {
      const now = new Date();
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const currentTotal = chartData[chartData.length - 1].total;
      const prevEntry = chartData.reduce((closest, entry) =>
        Math.abs(new Date(entry.date + 'T00:00:00') - sevenDaysAgo) <
        Math.abs(new Date(closest.date + 'T00:00:00') - sevenDaysAgo)
          ? entry : closest
      );

      if (prevEntry.total > 0) {
        wowGrowth = ((currentTotal - prevEntry.total) / prevEntry.total) * 100;

        // 20% WoW goal: target = reference total * 1.20
        const target = Math.ceil(prevEntry.total * 1.20);
        goalNeeded = Math.max(0, target - currentTotal);
        const deadline = new Date(prevEntry.date + 'T00:00:00');
        deadline.setDate(deadline.getDate() + 7);
        goalDeadline = deadline.toISOString().split('T')[0];
      }
    }

    return { wowGrowth, downloadsToday, goalNeeded, goalDeadline };
  }, [latestSnapshot, dailyData, chartData]);

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
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            <div className="px-4 lg:px-6">
              <ChartAreaInteractive data={chartData} dailyData={dailyData || []} />
            </div>
            <SectionCards
              wowGrowth={stats.wowGrowth}
              downloadsToday={stats.downloadsToday}
              goalNeeded={stats.goalNeeded}
              goalDeadline={stats.goalDeadline}
            />
            <div className="px-4 lg:px-6">
              <DailyTable data={dailyData || []} />
            </div>
            <div className="px-4 lg:px-6">
              <DataTable data={latestSnapshot?.releases || []} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
