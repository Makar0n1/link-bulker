'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiClient } from '../lib/api';
import { useTheme } from '../lib/theme';
import {
  ChevronLeft,
  ChevronRight,
  Folder,
  LogOut,
  Menu,
  Moon,
  Sun,
  X,
} from './icons';

const STORAGE_KEY = 'sidebar-collapsed';

/**
 * Update --sidebar-width on the html element so the projects layout's
 * padding-left can react instantly without a React context boundary.
 */
function setSidebarWidth(collapsed: boolean) {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--sidebar-width', collapsed ? '4rem' : '16rem');
}

/**
 * Single source of truth for the look of every clickable row in the sidebar
 * (project links, theme toggle, logout, etc.).
 *
 * Expanded mode → padded pill with icon + label.
 * Collapsed mode (md+) → 40×40 centered square so every icon line up
 * vertically on the same axis.
 */
function navItemClass(active: boolean, collapsed: boolean): string {
  const base = active
    ? 'bg-neutral-100 font-medium heading dark:bg-neutral-800/70'
    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/50 dark:hover:text-neutral-100';
  return [
    'flex items-center text-sm transition-colors rounded-lg w-full',
    collapsed
      ? 'gap-2 px-3 py-2 md:gap-0 md:h-10 md:w-10 md:justify-center md:px-0 md:py-0 md:mx-auto'
      : 'gap-2 px-3 py-2',
    base,
  ].join(' ');
}

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { theme, toggle: toggleTheme } = useTheme();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Hydrate persisted collapse state and reflect into the CSS var
  useEffect(() => {
    let initial = false;
    try {
      initial = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      /* ignore */
    }
    setCollapsed(initial);
    setSidebarWidth(initial);
  }, []);

  useEffect(() => {
    setSidebarWidth(collapsed);
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => apiClient.me(),
    retry: false,
  });

  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.listProjects(),
    retry: false,
  });

  const logout = useMutation({
    mutationFn: () => apiClient.logout(),
    onSuccess: () => {
      qc.clear();
      router.replace('/login');
    },
  });

  if (me.isError && me.error instanceof ApiError && me.error.status === 401) {
    router.replace('/login');
    return null;
  }

  const isProjectActive = (id: string) => pathname?.startsWith(`/projects/${id}`);
  const isProjectsListActive = pathname === '/projects';

  return (
    <>
      {/* Mobile hamburger trigger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="btn-icon fixed left-4 top-4 z-30 md:hidden card-flat shadow-md"
        aria-label="Open menu"
      >
        <Menu size={18} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm animate-overlay-in md:hidden"
          aria-hidden
        />
      )}

      {/* Sidebar — desktop & mobile drawer */}
      <aside
        className={[
          'group/sidebar fixed inset-y-0 left-0 z-50 flex flex-col border-r divider bg-white dark:bg-neutral-950',
          'transition-[width,transform] duration-200 ease-out',
          collapsed ? 'md:w-16' : 'md:w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          'w-64',
        ].join(' ')}
      >
        {/* Floating collapse/expand handle on the right border (desktop only).
            Sits half-on, half-off the border so it reads as belonging to the
            sidebar without taking up space inside the rail. Appears on hover. */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className={[
            'absolute right-0 top-7 z-10 hidden md:flex',
            'h-6 w-6 -translate-y-1/2 translate-x-1/2 items-center justify-center',
            'rounded-full border divider bg-white text-neutral-500 shadow-sm',
            'opacity-0 group-hover/sidebar:opacity-100 focus:opacity-100',
            'transition-all duration-150 hover:scale-110 hover:text-neutral-900',
            'dark:bg-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100',
          ].join(' ')}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>

        {/* Header — LC logo always visible, label fades on collapse */}
        <div
          className={[
            'flex h-14 items-center border-b divider',
            collapsed ? 'md:justify-center md:px-2' : 'justify-between px-3',
          ].join(' ')}
        >
          <Link
            href="/projects"
            className="flex items-center gap-2 font-semibold heading"
            title="Link Checker"
          >
            <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-neutral-900 text-xs font-bold text-white dark:bg-white dark:text-neutral-900">
              LC
            </span>
            <span
              className={`whitespace-nowrap transition-opacity duration-150 ${
                collapsed ? 'md:hidden' : ''
              }`}
            >
              Link Checker
            </span>
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="btn-icon md:hidden"
            aria-label="Close menu"
          >
            <X size={16} />
          </button>
        </div>

        {/*
          Row layout helpers — kept here so collapsed/expanded states share the
          same structure. In expanded mode rows get padding + label, in
          collapsed mode they become 40×40 centered squares so every icon
          (Folder, Sun/Moon, avatar, LogOut) sits on the same vertical axis.
        */}
        {/* Projects list */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <Link
            href="/projects"
            className={navItemClass(isProjectsListActive, collapsed)}
            title="All projects"
          >
            <Folder size={16} className="flex-shrink-0" />
            <span className={collapsed ? 'md:hidden' : ''}>All projects</span>
          </Link>

          <div
            className={`mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider muted ${
              collapsed ? 'md:hidden' : ''
            }`}
          >
            Recent
          </div>

          <ul className="space-y-0.5">
            {projects.data?.slice(0, 50).map((p) => {
              const active = isProjectActive(p.id);
              const busy = p.manualChecking || p.sheetsChecking;
              return (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    title={p.name}
                    className={navItemClass(active, collapsed)}
                  >
                    <span
                      className={[
                        'inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full',
                        busy
                          ? 'bg-amber-400 animate-pulse'
                          : active
                            ? 'bg-neutral-900 dark:bg-neutral-100'
                            : 'bg-neutral-300 dark:bg-neutral-700',
                      ].join(' ')}
                    />
                    <span className={`truncate ${collapsed ? 'md:hidden' : ''}`}>{p.name}</span>
                  </Link>
                </li>
              );
            })}
            {projects.data && projects.data.length === 0 && (
              <li
                className={`px-3 py-1.5 text-xs muted ${collapsed ? 'md:hidden' : ''}`}
              >
                No projects yet
              </li>
            )}
          </ul>
        </nav>

        {/* Footer: theme toggle + account + logout */}
        <div className="border-t divider p-2 space-y-1">
          <button
            onClick={toggleTheme}
            className={navItemClass(false, collapsed)}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? (
              <Sun size={16} className="flex-shrink-0" />
            ) : (
              <Moon size={16} className="flex-shrink-0" />
            )}
            <span className={collapsed ? 'md:hidden' : ''}>
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </span>
          </button>

          {me.data && (
            <div
              className={[
                'flex items-center text-sm',
                collapsed
                  ? 'md:h-10 md:w-10 md:justify-center md:px-0 md:mx-auto'
                  : 'gap-2 rounded-lg px-3 py-2',
              ].join(' ')}
              title={me.data.user.email}
            >
              <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full bg-neutral-200 text-[10px] font-semibold heading dark:bg-neutral-800">
                {me.data.user.email[0]?.toUpperCase()}
              </span>
              <div className={`min-w-0 flex-1 ${collapsed ? 'md:hidden' : ''}`}>
                <div className="truncate text-xs font-medium heading">{me.data.user.email}</div>
                <div className="text-[10px] muted uppercase tracking-wider">
                  {me.data.user.role}
                </div>
              </div>
            </div>
          )}

          <button
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className={[
              navItemClass(false, collapsed),
              '!text-red-600 hover:!bg-red-50 dark:!text-red-400 dark:hover:!bg-red-950/30',
              'disabled:opacity-50',
            ].join(' ')}
            title="Sign out"
          >
            <LogOut size={16} className="flex-shrink-0" />
            <span className={collapsed ? 'md:hidden' : ''}>Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
