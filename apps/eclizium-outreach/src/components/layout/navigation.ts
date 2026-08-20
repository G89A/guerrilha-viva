import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  FileText,
  Inbox,
  LayoutDashboard,
  Megaphone,
  Settings,
  Users,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * Sections whose backend does not exist yet are rendered disabled with the
   * sprint that delivers them. Showing a clickable link to a screen that cannot
   * work would be exactly the kind of fake feature this product must not ship.
   */
  availableFrom?: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Painel', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Contatos', href: '/contacts', icon: Users },
  { label: 'Templates', href: '/templates', icon: FileText, availableFrom: 'Sprint 2' },
  { label: 'Campanhas', href: '/campaigns', icon: Megaphone, availableFrom: 'Sprint 4' },
  { label: 'Inbox', href: '/inbox', icon: Inbox, availableFrom: 'Sprint 6' },
  { label: 'Analytics', href: '/analytics', icon: BarChart3, availableFrom: 'Sprint 7' },
  { label: 'Configurações', href: '/settings/workspace', icon: Settings },
] as const;
