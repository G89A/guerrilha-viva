import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** Authenticated visitors never see the sign-in screens. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (session) redirect('/dashboard');

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <main id="conteudo" className="w-full max-w-[26rem]">
        <div className="mb-7 text-center">
          <p className="text-lg font-semibold tracking-tight">
            ECLIZIUM <span className="text-muted-foreground">Outreach</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            CRM, campanhas e mensageria em um só lugar.
          </p>
        </div>
        {children}
      </main>
    </div>
  );
}
