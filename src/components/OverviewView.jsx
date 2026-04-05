import { useState, useEffect, useMemo } from 'react';
import { CircleAlert, ArrowUp, ArrowDown } from 'lucide-react';
import { apiRequest } from '@stevederico/skateboard-ui/Utilities';
import Header from '@stevederico/skateboard-ui/Header';
import { Spinner } from '@stevederico/skateboard-ui/shadcn/ui/spinner';
import { Button } from '@stevederico/skateboard-ui/shadcn/ui/button';
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription,
} from '@stevederico/skateboard-ui/shadcn/ui/empty';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@stevederico/skateboard-ui/shadcn/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@stevederico/skateboard-ui/shadcn/ui/table';

/** Format a number with locale-aware grouping. */
function fmt(num) {
  return new Intl.NumberFormat().format(num ?? 0);
}

/** Sortable columns and their data keys. */
const COLUMNS = [
  { key: 'repo', label: 'Repo', align: 'left' },
  { key: 'clones', label: 'Clones', align: 'right' },
  { key: 'uniqueClones', label: 'Unique', align: 'right' },
  { key: 'views', label: 'Views', align: 'right' },
  { key: 'uniqueViews', label: 'Unique Views', align: 'right' },
];

/**
 * Overview table showing per-repo clone and view totals.
 * Column headers are clickable to sort ascending/descending.
 *
 * @component
 * @returns {JSX.Element}
 */
export default function OverviewView() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('clones');
  const [sortDir, setSortDir] = useState('desc');

  const fetchData = () => {
    setIsLoading(true);
    setError(null);
    apiRequest('/metrics/overview')
      .then((rows) => setData(rows))
      .catch((err) => {
        console.error('Failed to fetch overview:', err);
        setError('Unable to load overview data.');
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'repo' ? 'asc' : 'desc');
    }
  };

  const sortedData = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (sortKey === 'repo') {
        const cmp = (aVal || '').localeCompare(bVal || '', undefined, { sensitivity: 'base' });
        return sortDir === 'asc' ? cmp : -cmp;
      }
      return sortDir === 'asc' ? (aVal || 0) - (bVal || 0) : (bVal || 0) - (aVal || 0);
    });
  }, [data, sortKey, sortDir]);

  const totals = useMemo(() => (data || []).reduce((acc, row) => ({
    clones: acc.clones + (row.clones || 0),
    uniqueClones: acc.uniqueClones + (row.uniqueClones || 0),
    views: acc.views + (row.views || 0),
    uniqueViews: acc.uniqueViews + (row.uniqueViews || 0),
  }), { clones: 0, uniqueClones: 0, views: 0, uniqueViews: 0 }), [data]);

  if (isLoading) {
    return (
      <>
        <Header title="Overview" />
        <div className="flex flex-1 items-center justify-center"><Spinner /></div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Header title="Overview" />
        <div className="flex flex-1 items-center justify-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><CircleAlert size={24} /></EmptyMedia>
              <EmptyTitle>Failed to load data</EmptyTitle>
              <EmptyDescription>{error}</EmptyDescription>
            </EmptyHeader>
            <Button onClick={fetchData}>Try again</Button>
          </Empty>
        </div>
      </>
    );
  }

  const SortIcon = sortDir === 'asc' ? ArrowUp : ArrowDown;

  return (
    <>
      <Header title="Overview" />
      <div className="flex flex-1 flex-col gap-4 p-4 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle>All Repositories</CardTitle>
            <CardDescription>Clone and view totals across all tracked repos</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  {COLUMNS.map(({ key, label, align }) => (
                    <TableHead
                      key={key}
                      className={`${align === 'right' ? 'text-right' : ''} cursor-pointer select-none`}
                      onClick={() => handleSort(key)}
                      aria-label={`Sort by ${label}`}
                    >
                      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
                        {label}
                        {sortKey === key && <SortIcon size={14} />}
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedData.map((row) => (
                  <TableRow key={row.repo}>
                    <TableCell className="font-medium">{row.repo.split('/')[1] || row.repo}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(row.clones)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(row.uniqueClones)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(row.views)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(row.uniqueViews)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold border-t-2">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.clones)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.uniqueClones)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.views)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.uniqueViews)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
