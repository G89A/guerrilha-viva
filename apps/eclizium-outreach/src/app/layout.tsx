import type { Metadata, Viewport } from 'next';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'ECLIZIUM Outreach',
    template: '%s · ECLIZIUM Outreach',
  },
  description:
    'Plataforma multi-tenant de CRM, campanhas e mensageria WhatsApp Business para operações de outreach.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#111318' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <a href="#conteudo" className="skip-link">
          Pular para o conteúdo
        </a>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
