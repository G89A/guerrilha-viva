'use client';

import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { SidebarNav } from '@/components/layout/sidebar';
import { UserMenu } from '@/components/layout/user-menu';
import {
  WorkspaceSwitcher,
  type WorkspaceOption,
} from '@/components/workspace/workspace-switcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface AppShellProps {
  user: { name: string; email: string };
  workspace: WorkspaceOption;
  workspaces: readonly WorkspaceOption[];
  roleLabel: string;
  children: React.ReactNode;
}

/**
 * Fixed sidebar on desktop, off-canvas drawer under `lg`. The shell is a client
 * component only because of the drawer state; all data arrives as props from
 * the server layout.
 */
export function AppShell({ user, workspace, workspaces, roleLabel, children }: AppShellProps) {
  const [isDrawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      {isDrawerOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card transition-transform lg:static lg:translate-x-0',
          isDrawerOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <span className="text-sm font-semibold tracking-tight">
            ECLIZIUM <span className="text-muted-foreground">Outreach</span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-label="Fechar navegação"
          >
            <X aria-hidden="true" />
          </Button>
        </div>

        <div className="border-b border-border p-3">
          <WorkspaceSwitcher current={workspace} options={workspaces} />
          <Badge variant="neutral" className="mt-2">
            {roleLabel}
          </Badge>
        </div>

        <div className="flex-1 overflow-y-auto">
          <SidebarNav onNavigate={() => setDrawerOpen(false)} />
        </div>

        <p className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
          Sprint 6 · Inbox de atendimento
        </p>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 backdrop-blur lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir navegação"
          >
            <Menu aria-hidden="true" />
          </Button>
          <div className="min-w-0 flex-1" />
          <UserMenu name={user.name} email={user.email} />
        </header>

        <main id="conteudo" className="min-w-0 flex-1 px-4 py-6 lg:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
