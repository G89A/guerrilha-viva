'use client';

import { useTransition } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';
import { logoutAction } from '@/app/(auth)/actions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { initialsOf } from '@/lib/utils';

export interface UserMenuProps {
  name: string;
  email: string;
}

export function UserMenu({ name, email }: UserMenuProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-accent"
        aria-label="Menu do usuário"
      >
        <span
          aria-hidden="true"
          className="grid size-7 place-items-center rounded-full bg-primary/10 text-xs font-medium text-primary"
        >
          {initialsOf(name)}
        </span>
        <span className="hidden max-w-[10rem] truncate sm:inline">{name}</span>
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Conta</DropdownMenuLabel>
        <div className="px-2 pb-1.5">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isPending}
          onSelect={(event) => {
            event.preventDefault();
            startTransition(() => {
              void logoutAction();
            });
          }}
        >
          <LogOut className="size-4" aria-hidden="true" />
          {isPending ? 'Saindo…' : 'Sair'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
