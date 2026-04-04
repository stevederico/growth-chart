/**
 * Settings view for managing tracked GitHub repositories.
 *
 * Displays a list of repos fetched from /api/repos with add/delete controls.
 * Uses Dialog for the add-repo form and Sonner toast for feedback.
 *
 * @component
 * @returns {JSX.Element} Settings view
 */
import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '@stevederico/skateboard-ui/Utilities';
import Header from '@stevederico/skateboard-ui/Header';
import { Button } from '@stevederico/skateboard-ui/shadcn/ui/button';
import { Input } from '@stevederico/skateboard-ui/shadcn/ui/input';
import { Label } from '@stevederico/skateboard-ui/shadcn/ui/label';
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@stevederico/skateboard-ui/shadcn/ui/dialog';
import { Spinner } from '@stevederico/skateboard-ui/shadcn/ui/spinner';
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription,
} from '@stevederico/skateboard-ui/shadcn/ui/empty';
import { Plus, Trash2, Github, CircleAlert } from 'lucide-react';
import { toast } from 'sonner';

export default function SettingsView() {
  const [repos, setRepos] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newRepo, setNewRepo] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const fetchRepos = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);
      const data = await apiRequest('/repos');
      setRepos(data.repos || []);
    } catch (err) {
      console.error('Failed to fetch repos:', err);
      setError('Unable to load repositories. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchRepos(); }, [fetchRepos]);

  /** Add a new repo and refresh the list. */
  const handleAdd = useCallback(async () => {
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
      setIsDialogOpen(false);
      fetchRepos();
    } catch (err) {
      console.error('Failed to add repo:', err);
      toast.error(err.message || 'Failed to add repository');
    } finally {
      setIsAdding(false);
    }
  }, [newRepo, fetchRepos]);

  /** Delete a repo by id and refresh the list. */
  const handleDelete = useCallback(async (id, name) => {
    try {
      await apiRequest(`/repos/${id}`, { method: 'DELETE' });
      toast.success(`Removed ${name}`);
      fetchRepos();
    } catch (err) {
      console.error('Failed to delete repo:', err);
      toast.error(err.message || 'Failed to remove repository');
    }
  }, [fetchRepos]);

  const content = () => {
    if (isLoading) {
      return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
    }
    if (error) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><CircleAlert size={24} /></EmptyMedia>
              <EmptyTitle>Failed to load repos</EmptyTitle>
              <EmptyDescription>{error}</EmptyDescription>
            </EmptyHeader>
            <Button onClick={fetchRepos}>Try again</Button>
          </Empty>
        </div>
      );
    }
    if (repos.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><Github size={24} /></EmptyMedia>
              <EmptyTitle>No repos tracked</EmptyTitle>
              <EmptyDescription>Add a GitHub repo to start tracking downloads.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1 px-4 py-4 lg:px-6">
        {repos.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-md border border-border px-4 py-3">
            <span className="text-sm font-medium text-foreground">{r.repo}</span>
            <Button variant="ghost" size="icon" aria-label={`Remove ${r.repo}`} onClick={() => handleDelete(r.id, r.repo)}>
              <Trash2 size={16} />
            </Button>
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      <Header title="Settings">
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" aria-label="Add repository"><Plus size={18} /> Add Repo</Button>
          </DialogTrigger>
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
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              />
            </div>
            <DialogFooter>
              <Button onClick={handleAdd} disabled={isAdding || !newRepo.trim()}>
                {isAdding ? <><Spinner className="size-4" /> Adding...</> : 'Add'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Header>
      {content()}
    </>
  );
}
