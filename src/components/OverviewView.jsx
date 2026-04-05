import { useState, useEffect } from 'react';
import { CircleAlert } from 'lucide-react';
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

/**
 * Overview table showing per-repo clone and view totals.
 *
 * @component
 * @returns {JSX.Element}
 */
export default function OverviewView() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

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

  const totals = (data || []).reduce((acc, row) => ({
    clones: acc.clones + (row.clones || 0),
    uniqueClones: acc.uniqueClones + (row.uniqueClones || 0),
    views: acc.views + (row.views || 0),
    uniqueViews: acc.uniqueViews + (row.uniqueViews || 0),
  }), { clones: 0, uniqueClones: 0, views: 0, uniqueViews: 0 });

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
                  <TableHead>Repo</TableHead>
                  <TableHead className="text-right">Clones</TableHead>
                  <TableHead className="text-right">Unique</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Unique Views</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data || []).map((row) => (
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
