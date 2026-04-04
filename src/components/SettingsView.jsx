/**
 * Settings view with theme toggle, manual data fetch, and support contact.
 *
 * Mirrors the skateboard-ui SettingsView layout with an added
 * "Fetch Data" card for manually refreshing GitHub metrics.
 *
 * @component
 * @returns {JSX.Element} Settings view
 */
import { useState, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon, RefreshCw } from 'lucide-react';
import { getState } from '@stevederico/skateboard-ui/Context';
import { apiRequest } from '@stevederico/skateboard-ui/Utilities';
import Header from '@stevederico/skateboard-ui/Header';
import { Button } from '@stevederico/skateboard-ui/shadcn/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardAction } from '@stevederico/skateboard-ui/shadcn/ui/card';
import { Spinner } from '@stevederico/skateboard-ui/shadcn/ui/spinner';
import { toast } from 'sonner';

export default function SettingsView() {
  const { state } = getState();
  const constants = state.constants;
  const { theme, setTheme } = useTheme();
  const isDarkMode = theme === 'dark';
  const [isFetching, setIsFetching] = useState(false);

  const handleFetchData = useCallback(async () => {
    try {
      setIsFetching(true);
      await Promise.allSettled([
        apiRequest('/downloads/snapshot', { method: 'POST', body: JSON.stringify({}) }),
        apiRequest('/metrics/snapshot', { method: 'POST', body: JSON.stringify({}) }),
      ]);
      toast.success('Data refreshed from GitHub');
    } catch (err) {
      console.error('Failed to fetch data:', err);
      toast.error(err.message || 'Failed to fetch data from GitHub');
    } finally {
      setIsFetching(false);
    }
  }, []);

  return (
    <div className="flex-1">
      <Header title="Settings">
        <Button variant="ghost" size="icon" onClick={() => setTheme(isDarkMode ? 'light' : 'dark')} aria-label="Toggle dark mode">
          {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
        </Button>
      </Header>

      <div className="flex flex-col items-center p-4 gap-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Fetch Data</CardTitle>
            <CardDescription>Manually refresh all metrics from GitHub</CardDescription>
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                onClick={handleFetchData}
                disabled={isFetching}
              >
                {isFetching ? <Spinner className="size-4" /> : <RefreshCw size={16} />}
                {isFetching ? 'Fetching...' : 'Fetch'}
              </Button>
            </CardAction>
          </CardHeader>
        </Card>

        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Support</CardTitle>
            <CardDescription>How can we help?</CardDescription>
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { window.location.href = `mailto:${constants.companyEmail}`; }}
              >
                Contact
              </Button>
            </CardAction>
          </CardHeader>
        </Card>
      </div>

      <div className="mt-8 text-center pb-24 md:pb-8">
        <p className="text-xs text-muted-foreground">v{constants.version || '0.0.0'}</p>
      </div>
    </div>
  );
}
