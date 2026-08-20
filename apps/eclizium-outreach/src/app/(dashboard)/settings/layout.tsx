import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';

const TABS = [
  { href: '/settings/workspace', label: 'Workspace' },
  { href: '/settings/integrations', label: 'Integrações' },
] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Configurações" description="Preferências do workspace e integrações." />
      <nav aria-label="Seções de configuração" className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
