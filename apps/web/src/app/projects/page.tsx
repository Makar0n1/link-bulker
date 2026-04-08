'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiClient } from '../../lib/api';
import { Plus, Trash } from '../../components/icons';

export default function ProjectsPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.listProjects(),
    retry: false,
  });

  const create = useMutation({
    mutationFn: (vars: { name: string; description?: string }) => apiClient.createProject(vars),
    onSuccess: () => {
      setName('');
      setDescription('');
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.deleteProject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) alert(`Delete failed: ${err.message}`);
    },
  });

  if (projects.isError && projects.error instanceof ApiError && projects.error.status === 401) {
    router.replace('/login');
    return null;
  }

  function onCreate(e: FormEvent) {
    e.preventDefault();
    create.mutate({ name, description: description || undefined });
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold heading">Projects</h1>
        <p className="text-sm muted mt-1">Manage your link analysis projects.</p>
      </header>

      <form onSubmit={onCreate} className="card p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            required
            className="input flex-1"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="input flex-1"
          />
          <button
            type="submit"
            disabled={create.isPending || !name.trim()}
            className="btn-primary sm:flex-shrink-0"
          >
            <Plus size={14} />
            Create
          </button>
        </div>
      </form>

      {projects.isLoading && (
        <div className="card p-12 text-center text-sm muted">Loading projects…</div>
      )}

      {projects.data && projects.data.length === 0 && (
        <div className="card p-12 text-center">
          <div className="text-sm muted">No projects yet.</div>
          <div className="mt-1 text-xs muted">Create your first project above to get started.</div>
        </div>
      )}

      {projects.data && projects.data.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data.map((p) => (
            <li
              key={p.id}
              className="card group relative p-5 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md"
            >
              <Link href={`/projects/${p.id}`} className="block">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-semibold heading">{p.name}</h2>
                    {p.description && (
                      <p className="mt-1 line-clamp-2 text-xs muted">{p.description}</p>
                    )}
                  </div>
                  {(p.manualChecking || p.sheetsChecking) && (
                    <span className="pill-blue">Checking</span>
                  )}
                </div>
                <div className="mt-4 flex items-center gap-3 text-xs muted">
                  <span>{p.linksCount} links</span>
                  <span className="opacity-30">·</span>
                  <span>{p.sheetsTasksCount} sheets</span>
                </div>
              </Link>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  if (
                    confirm(
                      `Delete project "${p.name}"?\n\nThis will permanently remove ${p.linksCount} link(s) and ${p.sheetsTasksCount} sheet task(s).`,
                    )
                  ) {
                    remove.mutate(p.id);
                  }
                }}
                disabled={remove.isPending}
                className="btn-icon absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100 hover:!text-red-600 hover:!bg-red-50 dark:hover:!bg-red-950/30 dark:hover:!text-red-400"
                title="Delete project"
              >
                <Trash size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
