import type { ReactNode } from 'react';
import { Sidebar } from '../../components/Sidebar';

/**
 * Shared layout for /projects/* — wraps every page with the collapsible
 * sidebar. The main content area uses --sidebar-width (set by Sidebar)
 * so the padding reacts instantly to collapse/expand without prop drilling.
 */
export default function ProjectsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <main
        className="transition-[padding] duration-200 md:pl-[var(--sidebar-width,16rem)]"
      >
        <div className="mx-auto max-w-7xl px-4 pb-12 pt-16 md:px-8 md:pt-8 animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
