import { useState, useEffect, useMemo, useCallback } from 'react';
import { CircleAlert } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@stevederico/skateboard-ui/shadcn/ui/select';
import { SectionCards } from './SectionCards.jsx';
import { ChartAreaInteractive } from './ChartAreaInteractive.jsx';
import { DailyTable } from './DataTable.jsx';

/** Available metric types for the selector dropdown. */
const METRIC_TYPES = {
  downloads: { label: 'Downloads' },
  stars: { label: 'Stars' },
  forks: { label: 'Forks' },
  views: { label: 'Page Views' },
  clones: { label: 'Clones' },
};

/**
 * Analytics view for Growth Chart metrics.
 *
 * Composes SectionCards (3 metric cards), ChartAreaInteractive (area chart
 * with time range toggle), and DailyTable (daily breakdown).
 * Supports multiple metric types (downloads, stars, forks, views, clones)
 * with optional repo filtering.
 *
 * @component
 * @returns {JSX.Element} Analytics view
 */
export default function HomeView() {
  const [snapshots, setSnapshots] = useState(null);
  const [latestSnapshot, setLatestSnapshot] = useState(null);
  const [dailyData, setDailyData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [repos, setRepos] = useState([]);
  const [selectedRepo, setSelectedRepo] = useState('all');
  const [selectedMetric, setSelectedMetric] = useState('downloads');

  useEffect(() => {
    apiRequest('/downloads/repos')
      .then((data) => setRepos(data.repos || []))
      .catch(() => {});
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);
      if (selectedMetric === 'downloads') {
        const repoParam = selectedRepo !== 'all' ? `?repo=${encodeURIComponent(selectedRepo)}` : '';
        const [allData, latest, daily] = await Promise.all([
          apiRequest(`/downloads${repoParam}`),
          apiRequest(`/downloads/latest${repoParam}`),
          apiRequest(`/downloads/daily${repoParam}`),
        ]);
        setSnapshots(allData);
        setLatestSnapshot(latest);
        setDailyData(daily);
      } else {
        const repoParam = selectedRepo !== 'all' ? `&repo=${encodeURIComponent(selectedRepo)}` : '';
        const params = `?metric=${selectedMetric}${repoParam}`;
        const [allData, latest, daily] = await Promise.all([
          apiRequest(`/metrics${params}`),
          apiRequest(`/metrics/latest${params}`),
          apiRequest(`/metrics/daily${params}`),
        ]);
        setSnapshots(allData);
        setLatestSnapshot(latest);
        setDailyData(daily);
      }
    } catch (err) {
      console.error('Failed to fetch data:', err);
      setError('Unable to load data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedRepo, selectedMetric]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /** Build chart data from snapshots — one point per date with total count */
  const chartData = useMemo(() => {
    if (!snapshots?.length) return [];
    if (selectedMetric === 'downloads') {
      const byDate = new Map();
      for (const s of snapshots) {
        const current = byDate.get(s.date) || 0;
        byDate.set(s.date, current + s.download_count);
      }
      return [...byDate.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, total]) => ({ date, total }));
    }
    // Metrics: group by date, sum count across repos
    const byDate = new Map();
    for (const s of snapshots) {
      const current = byDate.get(s.date) || 0;
      byDate.set(s.date, current + s.count);
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, total]) => ({ date, total }));
  }, [snapshots, selectedMetric]);

  /** Derive stats from the latest snapshot and daily deltas */
  const stats = useMemo(() => {
    if (!latestSnapshot) {
      return { wowGrowth: null, valueToday: 0, goalNeeded: null, goalDeadline: null };
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

    return { wowGrowth, valueToday: downloadsToday, goalNeeded, goalDeadline };
  }, [latestSnapshot, dailyData, chartData]);

  const repoSelector = repos.length > 1 && (
    <Select value={selectedRepo} onValueChange={setSelectedRepo}>
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="All Repos" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Repos</SelectItem>
        {repos.map((repo) => (
          <SelectItem key={repo} value={repo}>
            {repo.split('/')[1] || repo}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const metricSelector = (
    <Select value={selectedMetric} onValueChange={setSelectedMetric}>
      <SelectTrigger className="w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(METRIC_TYPES).map(([key, { label }]) => (
          <SelectItem key={key} value={key}>{label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (isLoading) {
    return (
      <>
        <Header title={METRIC_TYPES[selectedMetric]?.label || 'Downloads'}>
          {metricSelector}
          {repoSelector}
        </Header>
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </>
    );
  }

  if (error && !latestSnapshot) {
    return (
      <>
        <Header title={METRIC_TYPES[selectedMetric]?.label || 'Downloads'}>
          {metricSelector}
          {repoSelector}
        </Header>
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
      <Header title={METRIC_TYPES[selectedMetric]?.label || 'Downloads'}>
        {metricSelector}
        {repoSelector}
      </Header>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            <div className="px-4 lg:px-6">
              <ChartAreaInteractive data={chartData} dailyData={dailyData || []} metricType={selectedMetric} />
            </div>
            <SectionCards
              wowGrowth={stats.wowGrowth}
              valueToday={stats.valueToday}
              goalNeeded={stats.goalNeeded}
              goalDeadline={stats.goalDeadline}
              metricType={selectedMetric}
            />
            <div className="px-4 lg:px-6">
              <DailyTable data={dailyData || []} metricType={selectedMetric} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
