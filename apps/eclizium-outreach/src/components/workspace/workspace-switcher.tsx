'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { switchWorkspaceAction } from '@/app/(dashboard)/actions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface WorkspaceOption {
  id: string;
  name: string;
  slug: string;
}

export interface WorkspaceSwitcherProps {
  current: WorkspaceOption;
  options: readonly WorkspaceOption[];
}

export function WorkspaceSwitcher({ current, options }: WorkspaceSwitcherProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function select(workspaceId: string) {
    if (workspaceId === current.id) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.set('workspaceId', workspaceId);
      const result = await switchWorkspaceAction(formData);

      if (!result.ok) {
        toast.error('Não foi possível trocar de workspace', {
          description: result.error.message,
        });
        return;
      }
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isPending}
        className="flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-60"
        aria-label="Trocar de workspace"
      >
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{current.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{current.slug}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[15rem]">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem key={option.id} onSelect={() => select(option.id)}>
            <Check
              className={option.id === current.id ? 'size-4 opacity-100' : 'size-4 opacity-0'}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate">{option.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
