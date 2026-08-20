'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Loader2, Upload } from 'lucide-react';
import { ConsentStatus } from '@prisma/client';
import { toast } from 'sonner';
import {
  importContactsAction,
  type ImportActionState,
} from '@/app/(dashboard)/contacts/import/actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CSV_MAX_BYTES,
  CSV_MAX_ROWS,
  parseCsv,
  type CsvDocument,
} from '@/features/contacts/csv/parse';
import {
  FIELD_LABELS,
  MAPPABLE_FIELDS,
  suggestMapping,
  type ColumnMapping,
  type MappableField,
} from '@/features/contacts/csv/mapping';
import {
  classifyRows,
  ROW_STATUS_LABELS,
  type ClassifiedRow,
} from '@/features/contacts/csv/validate';
import { toCsv } from '@/features/contacts/csv/export';

const STEPS = [
  'Upload',
  'Preview',
  'Mapeamento',
  'Validação',
  'Origem e consentimento',
  'Resultado',
] as const;

const ACCEPTED_TYPES = ['text/csv', 'application/vnd.ms-excel', 'text/plain', ''];

function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="mb-6 flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Etapas da importação">
      {STEPS.map((label, index) => (
        <li
          key={label}
          aria-current={index === current ? 'step' : undefined}
          className={
            index === current
              ? 'font-medium text-foreground'
              : index < current
                ? 'text-muted-foreground line-through'
                : 'text-muted-foreground/60'
          }
        >
          {index + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

export function ImportWizard({ phoneRegion }: { phoneRegion: string }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [rawCsv, setRawCsv] = useState('');
  const [document, setDocument] = useState<CsvDocument | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [source, setSource] = useState('');
  const [consent, setConsent] = useState<ConsentStatus>(ConsentStatus.UNKNOWN);
  const [report, setReport] = useState<ImportActionState>(null);
  const [isPending, startTransition] = useTransition();

  /**
   * Classificação local, só para a experiência do usuário. A duplicidade
   * contra o banco não é conhecida aqui — quem decide isso é o servidor.
   */
  const classification = useMemo(() => {
    if (!document || mapping.phone === undefined) return null;
    return classifyRows({ rows: document.rows, mapping, phoneRegion });
  }, [document, mapping, phoneRegion]);

  async function handleFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;

    if (file.size > CSV_MAX_BYTES) {
      setFileError(`Arquivo maior que ${CSV_MAX_BYTES / (1024 * 1024)} MB.`);
      return;
    }
    // Extensão e MIME são pistas fracas: o veredito vem de conseguir parsear.
    const looksCsv =
      file.name.toLowerCase().endsWith('.csv') || ACCEPTED_TYPES.includes(file.type);
    if (!looksCsv) {
      setFileError('Envie um arquivo .csv.');
      return;
    }

    const text = await file.text();
    const parsed = parseCsv(text);
    if (!parsed.ok) {
      setFileError(parsed.error.message);
      return;
    }

    setRawCsv(text);
    setDocument(parsed.document);
    setMapping(suggestMapping(parsed.document.headers));
    setStep(1);
  }

  function submitImport() {
    if (!document || mapping.phone === undefined || !source.trim()) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.set('csv', rawCsv);
      formData.set('mapping', JSON.stringify(mapping));
      formData.set('source', source.trim());
      formData.set('whatsappConsent', consent);

      const result = await importContactsAction(null, formData);
      setReport(result);
      setStep(5);

      if (result?.ok) {
        toast.success(`${result.data.imported} contato(s) importado(s).`);
        router.refresh();
      } else if (result) {
        toast.error('Importação não concluída', { description: result.error.message });
      }
    });
  }

  function downloadRejected(rows: ClassifiedRow[]) {
    const csv = toCsv(
      ['linha', 'status', 'motivo', 'telefone', 'nome', 'email'],
      rows.map((row) => [
        row.lineNumber,
        ROW_STATUS_LABELS[row.status],
        row.reason ?? '',
        row.values.phone ?? '',
        [row.values.firstName, row.values.lastName].filter(Boolean).join(' '),
        row.values.email ?? '',
      ]),
    );

    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = 'linhas-rejeitadas.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-5xl">
      <StepIndicator current={step} />

      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>1. Enviar arquivo</CardTitle>
            <CardDescription>
              CSV de até {CSV_MAX_BYTES / (1024 * 1024)} MB e {CSV_MAX_ROWS} linhas, com cabeçalho
              na primeira linha. Vírgula, ponto e vírgula ou tabulação.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {fileError ? (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>Arquivo recusado</AlertTitle>
                <AlertDescription>{fileError}</AlertDescription>
              </Alert>
            ) : null}
            <Input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              aria-label="Arquivo CSV"
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
            <p className="text-xs text-muted-foreground">
              O conteúdo é lido como texto. Nada do arquivo é executado.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {step === 1 && document ? (
        <Card>
          <CardHeader>
            <CardTitle>2. Conferir o conteúdo</CardTitle>
            <CardDescription>
              {document.rows.length} linha(s) e {document.headers.length} coluna(s). Separador
              detectado: {document.delimiter === '\t' ? 'tabulação' : `"${document.delimiter}"`}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {document.ragged.length > 0 ? (
              <Alert variant="warning">
                <AlertTitle>Linhas com número de colunas diferente</AlertTitle>
                <AlertDescription>
                  {document.ragged.length} linha(s) foram ajustadas ao cabeçalho (faltando colunas
                  viram vazio). Ex.: linha {document.ragged.slice(0, 5).join(', ')}.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {document.headers.map((header) => (
                      <TableHead key={header}>{header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {document.rows.slice(0, 5).map((row, index) => (
                    <TableRow key={index}>
                      {row.map((cell, cellIndex) => (
                        <TableCell key={cellIndex} className="max-w-48 truncate">
                          {cell}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex gap-2">
              <Button onClick={() => setStep(2)}>Continuar</Button>
              <Button variant="ghost" onClick={() => setStep(0)}>
                Trocar arquivo
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 && document ? (
        <Card>
          <CardHeader>
            <CardTitle>3. Mapear colunas</CardTitle>
            <CardDescription>
              Relacione cada campo do contato a uma coluna do arquivo. O telefone é obrigatório.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {MAPPABLE_FIELDS.map((field: MappableField) => (
                <div key={field} className="space-y-1">
                  <Label htmlFor={`map-${field}`}>
                    {FIELD_LABELS[field]}
                    {field === 'phone' ? ' *' : ''}
                  </Label>
                  <select
                    id={`map-${field}`}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={mapping[field] ?? ''}
                    onChange={(event) =>
                      setMapping((previous) => {
                        const next = { ...previous };
                        if (event.target.value === '') delete next[field];
                        else next[field] = Number(event.target.value);
                        return next;
                      })
                    }
                  >
                    <option value="">— não importar —</option>
                    {document.headers.map((header, index) => (
                      <option key={header} value={index}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {mapping.phone === undefined ? (
              <Alert variant="warning">
                <AlertDescription>
                  Escolha a coluna de telefone para continuar.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex gap-2">
              <Button disabled={mapping.phone === undefined} onClick={() => setStep(3)}>
                Validar
              </Button>
              <Button variant="ghost" onClick={() => setStep(1)}>
                Voltar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 && classification ? (
        <Card>
          <CardHeader>
            <CardTitle>4. Validação</CardTitle>
            <CardDescription>
              Conferência feita no navegador. A duplicidade contra a base é verificada no servidor,
              na importação.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-4">
              <Summary label="Total" value={classification.summary.total} />
              <Summary label="Válidas" value={classification.summary.valid} tone="success" />
              <Summary label="Inválidas" value={classification.summary.invalid} tone="destructive" />
              <Summary
                label="Duplicadas no arquivo"
                value={classification.summary.duplicateInFile}
                tone="warning"
              />
            </div>

            {classification.summary.valid === 0 ? (
              <Alert variant="destructive">
                <AlertTitle>Nenhuma linha importável</AlertTitle>
                <AlertDescription>
                  Revise o mapeamento ou o arquivo: nenhuma linha passou na validação.
                </AlertDescription>
              </Alert>
            ) : null}

            <RejectedTable
              rows={classification.rows.filter((row) => row.status !== 'VALID')}
              onDownload={downloadRejected}
            />

            <div className="flex gap-2">
              <Button disabled={classification.summary.valid === 0} onClick={() => setStep(4)}>
                Continuar
              </Button>
              <Button variant="ghost" onClick={() => setStep(2)}>
                Ajustar mapeamento
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 4 ? (
        <Card>
          <CardHeader>
            <CardTitle>5. Origem e consentimento</CardTitle>
            <CardDescription>
              Toda linha importada recebe estes valores. O consentimento não é presumido.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5 sm:max-w-md">
              <Label htmlFor="import-source">Origem *</Label>
              <Input
                id="import-source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                maxLength={120}
                placeholder="Ex.: planilha evento março"
                required
              />
            </div>

            <div className="space-y-1.5 sm:max-w-md">
              <Label htmlFor="import-consent">Consentimento WhatsApp *</Label>
              <select
                id="import-consent"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={consent}
                onChange={(event) => setConsent(event.target.value as ConsentStatus)}
              >
                <option value={ConsentStatus.UNKNOWN}>Desconhecido</option>
                <option value={ConsentStatus.GRANTED}>Concedido</option>
                <option value={ConsentStatus.REVOKED}>Revogado</option>
              </select>
            </div>

            <Alert variant="warning">
              <AlertTitle>Não marque &ldquo;Concedido&rdquo; por conveniência</AlertTitle>
              <AlertDescription>
                Só declare consentimento concedido se houver registro real de opt-in para estes
                contatos. O padrão é &ldquo;Desconhecido&rdquo;.
              </AlertDescription>
            </Alert>

            <div className="flex gap-2">
              <Button disabled={!source.trim() || isPending} onClick={submitImport}>
                {isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Upload aria-hidden="true" />
                )}
                {isPending ? 'Importando…' : 'Importar'}
              </Button>
              <Button variant="ghost" disabled={isPending} onClick={() => setStep(3)}>
                Voltar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 5 ? (
        <Card>
          <CardHeader>
            <CardTitle>6. Resultado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {report?.ok ? (
              <>
                <Alert variant="info">
                  <CheckCircle2 aria-hidden="true" />
                  <AlertTitle>Importação concluída</AlertTitle>
                  <AlertDescription>
                    Contagens apuradas no servidor, após revalidar o arquivo inteiro.
                  </AlertDescription>
                </Alert>

                <div className="grid gap-2 sm:grid-cols-5">
                  <Summary label="Importados" value={report.data.imported} tone="success" />
                  <Summary label="Ignorados" value={report.data.skipped} tone="warning" />
                  <Summary label="Inválidos" value={report.data.summary.invalid} tone="destructive" />
                  <Summary
                    label="Duplicados"
                    value={
                      report.data.summary.duplicateInFile + report.data.summary.duplicateInDatabase
                    }
                    tone="warning"
                  />
                  <Summary label="Erros" value={report.data.failed} tone="destructive" />
                </div>

                {report.data.rejectedTruncated ? (
                  <p className="text-xs text-muted-foreground">
                    Exibindo as primeiras {report.data.rejected.length} linhas rejeitadas.
                  </p>
                ) : null}

                <RejectedTable rows={report.data.rejected} onDownload={downloadRejected} />
              </>
            ) : report ? (
              <Alert variant="destructive">
                <AlertTitle>Importação não concluída</AlertTitle>
                <AlertDescription>{report.error.message}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex gap-2">
              <Button asChild>
                <Link href="/contacts">Ver contatos</Link>
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setStep(0);
                  setDocument(null);
                  setRawCsv('');
                  setMapping({});
                  setReport(null);
                  setSource('');
                  if (fileInput.current) fileInput.current.value = '';
                }}
              >
                Importar outro arquivo
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'warning' | 'destructive';
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {tone && value > 0 ? (
        <Badge variant={tone} className="mt-1">
          {tone === 'success' ? 'ok' : 'atenção'}
        </Badge>
      ) : null}
    </div>
  );
}

function RejectedTable({
  rows,
  onDownload,
}: {
  rows: ClassifiedRow[];
  onDownload: (rows: ClassifiedRow[]) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma linha rejeitada.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{rows.length} linha(s) não importada(s)</p>
        <Button size="sm" variant="outline" onClick={() => onDownload(rows)}>
          Baixar relatório
        </Button>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Linha</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead>Telefone</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 200).map((row) => (
              <TableRow key={row.lineNumber}>
                <TableCell className="tabular-nums">{row.lineNumber}</TableCell>
                <TableCell>{ROW_STATUS_LABELS[row.status]}</TableCell>
                <TableCell className="text-muted-foreground">{row.reason ?? '—'}</TableCell>
                <TableCell className="font-mono text-xs">{row.values.phone ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
