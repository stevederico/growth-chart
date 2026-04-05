import { useState, useEffect, useMemo, useCallback } from 'react';
import { CircleAlert, Download, Star, GitFork, Eye, Copy, Plus, Github } from 'lucide-react';
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
} from '@stevederico/skateboard-ui/shadcn/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@stevederico/skateboard-ui/shadcn/ui/dialog';
import { Input } from '@stevederico/skateboard-ui/shadcn/ui/input';
import { Label } from '@stevederico/skateboard-ui/shadcn/ui/label';
import { toast } from 'sonner';
import { SectionCards } from './SectionCards.jsx';
import { ChartAreaInteractive } from './ChartAreaInteractive.jsx';
import { DailyTable } from './DataTable.jsx';

/** Available metric types for the selector dropdown. */
const METRIC_TYPES = {
  downloads: { label: 'Downloads', icon: Download },
  stars: { label: 'Stars', icon: Star },
  forks: { label: 'Forks', icon: GitFork },
  views: { label: 'Page Views', icon: Eye },
  clones: { label: 'Clones', icon: Copy },
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
  const [selectedRepo, setSelectedRepo] = useState(() => localStorage.getItem('gc_repo') || null);
  const [selectedMetric, setSelectedMetric] = useState(() => localStorage.getItem('gc_metric') || 'downloads');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newRepo, setNewRepo] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const fetchRepos = useCallback(() => {
    apiRequest('/downloads/repos')
      .then((data) => setRepos((data.repos || []).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchRepos(); }, [fetchRepos]);

  // Default to first repo once loaded; validate saved repo still exists
  useEffect(() => {
    if (repos.length === 0) return;
    if (!selectedRepo || (selectedRepo !== 'all' && !repos.includes(selectedRepo))) {
      setSelectedRepo(repos[0]);
    }
  }, [repos, selectedRepo]);

  // Persist selections to localStorage
  useEffect(() => { if (selectedRepo) localStorage.setItem('gc_repo', selectedRepo); }, [selectedRepo]);
  useEffect(() => { localStorage.setItem('gc_metric', selectedMetric); }, [selectedMetric]);

  /** Add a new repo via API, refresh the list, and select it. */
  const handleAddRepo = useCallback(async () => {
    const trimmed = newRepo.trim();
    if (!trimmed) return;
    try {
      setIsAdding(true);
      await apiRequest('/repos', {
        method: 'POST',
        body: JSON.stringify({ repo: trimmed }),
      });
      toast.success(`Added ${trimmed}`);
      setNewRepo('');
      setIsAddDialogOpen(false);
      fetchRepos();
      setSelectedRepo(trimmed);
    } catch (err) {
      console.error('Failed to add repo:', err);
      toast.error(err.message || 'Failed to add repository');
    } finally {
      setIsAdding(false);
    }
  }, [newRepo, fetchRepos]);

  const fetchData = useCallback(async () => {
    if (!selectedRepo) return;
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
        // Fall back to stars if no download data
        if (!allData?.length) {
          setSelectedMetric('stars');
          return;
        }
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
    const sorted = [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, total]) => ({ date, total }));

    // Clones/views are per-day — compute running total for cumulative chart
    const isPerDay = selectedMetric === 'clones' || selectedMetric === 'views';
    if (isPerDay) {
      let cumulative = 0;
      return sorted.map(({ date, total }) => {
        cumulative += total;
        return { date, total: cumulative };
      });
    }
    return sorted;
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

  const handleRepoChange = useCallback((value) => {
    if (value === '__add__') {
      setIsAddDialogOpen(true);
      return;
    }
    setSelectedRepo(value);
  }, []);

  const repoSelector = (
    <>
      <Select value={selectedRepo || ''} onValueChange={handleRepoChange}>
        <SelectTrigger className="w-auto">
          <span className="flex items-center gap-2">
            <Github size={14} />
            {selectedRepo && selectedRepo !== 'all'
              ? selectedRepo.split('/')[1] || selectedRepo
              : 'All Repos'}
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Repos</SelectItem>
          {repos.map((repo) => (
            <SelectItem key={repo} value={repo}>
              {repo.split('/')[1] || repo}
            </SelectItem>
          ))}
          <SelectItem value="__add__">
            <span className="flex items-center gap-2">
              <Plus size={14} /> Add Repo
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Repository</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label htmlFor="repo-input">GitHub Repository</Label>
            <Input
              id="repo-input"
              placeholder="owner/repo"
              value={newRepo}
              onChange={(e) => setNewRepo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddRepo(); }}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleAddRepo} disabled={isAdding || !newRepo.trim()}>
              {isAdding ? <><Spinner className="size-4" /> Adding...</> : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  const SelectedMetricIcon = METRIC_TYPES[selectedMetric]?.icon;

  const metricSelector = (
    <Select value={selectedMetric} onValueChange={setSelectedMetric}>
      <SelectTrigger className="w-[170px]">
        <span className="flex items-center gap-2">
          {SelectedMetricIcon && <SelectedMetricIcon size={14} />}
          {METRIC_TYPES[selectedMetric]?.label || 'Downloads'}
        </span>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(METRIC_TYPES).map(([key, { label, icon: Icon }]) => (
          <SelectItem key={key} value={key}>
            <span className="flex items-center gap-2">
              <Icon size={14} /> {label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (isLoading) {
    return (
      <>
        <Header title={<span className="hidden sm:inline">Dashboard</span>}>
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
        <Header title={<span className="hidden sm:inline">Dashboard</span>}>
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
      <Header title={<span className="hidden sm:inline">Dashboard</span>}>
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
