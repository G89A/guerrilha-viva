import Link from 'next/link';
import { AlertTriangle, Check, CircleAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ReadinessCheck, ReadinessReport } from '@/features/readiness/service';

/**
 * Prontidão para disparo.
 *
 * A tela não diz "tudo certo" por otimismo: cada linha reflete uma leitura do
 * banco ou do ambiente. Quando falta algo, aparece o que falta e o caminho para
 * resolver — nunca um "configure a integração" genérico.
 */
export function SendReadiness({ report }: { report: ReadinessReport }) {
  const faltando = report.checks.filter((check) => check.state === 'FALTA').length;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Prontidão para disparo</CardTitle>
          <CardDescription>
            {report.readyToSend
              ? 'Tudo que trava um disparo real está resolvido.'
              : `${faltando} item(ns) impedem um disparo real neste workspace.`}
          </CardDescription>
        </div>
        <Badge variant={report.readyToSend ? 'default' : 'destructive'}>
          {report.readyToSend ? 'Pronto' : 'Bloqueado'}
        </Badge>
      </CardHeader>

      <CardContent>
        <ul className="divide-y divide-border">
          {report.checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CheckRow({ check }: { check: ReadinessCheck }) {
  const Icon = check.state === 'OK' ? Check : check.state === 'FALTA' ? CircleAlert : AlertTriangle;

  return (
    <li className="flex items-start gap-3 py-3">
      <Icon
        aria-hidden="true"
        className={cn(
          'mt-0.5 size-4 shrink-0',
          check.state === 'OK' && 'text-primary',
          check.state === 'FALTA' && 'text-destructive',
          check.state === 'ATENCAO' && 'text-muted-foreground',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {check.label}
          <span className="sr-only">
            {check.state === 'OK' ? ': pronto' : check.state === 'FALTA' ? ': falta' : ': atenção'}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{check.detail}</p>
        {check.state !== 'OK' && check.action ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {check.action}
            {check.href ? (
              <>
                {' '}
                <Link href={check.href} className="underline">
                  Ir para a tela
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </li>
  );
}
