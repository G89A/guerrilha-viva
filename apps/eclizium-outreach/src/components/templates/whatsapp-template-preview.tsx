import { TemplateHeaderFormat } from '@prisma/client';

export interface TemplateButton {
  type: string;
  text: string | null;
  url: string | null;
  phoneNumber: string | null;
}

export interface TemplatePreviewProps {
  headerFormat: TemplateHeaderFormat | null;
  headerText: string | null;
  body: string;
  footerText: string | null;
  buttons: TemplateButton[];
}

const HEADER_MEDIA_LABEL: Partial<Record<TemplateHeaderFormat, string>> = {
  [TemplateHeaderFormat.IMAGE]: 'Imagem',
  [TemplateHeaderFormat.VIDEO]: 'Vídeo',
  [TemplateHeaderFormat.DOCUMENT]: 'Documento',
  [TemplateHeaderFormat.LOCATION]: 'Localização',
};

/**
 * Aproximação visual da mensagem no WhatsApp.
 *
 * Não busca ser pixel-perfect: busca deixar claro o que o destinatário vai
 * receber — cabeçalho, corpo, rodapé, botões e onde as variáveis entram.
 *
 * Todo texto é renderizado como conteúdo React, nunca via HTML cru: o conteúdo
 * vem do provider e não pode virar marcação.
 */
export function WhatsAppTemplatePreview({
  headerFormat,
  headerText,
  body,
  footerText,
  buttons,
}: TemplatePreviewProps) {
  const mediaLabel = headerFormat ? HEADER_MEDIA_LABEL[headerFormat] : undefined;

  return (
    <div className="rounded-lg bg-[#e5ded8] p-4 dark:bg-muted">
      <div className="ml-auto max-w-sm rounded-lg rounded-tr-none bg-[#d9fdd3] p-3 shadow-sm dark:bg-background">
        {mediaLabel ? (
          <div className="mb-2 flex h-20 items-center justify-center rounded bg-black/10 text-xs font-medium text-foreground/60">
            {mediaLabel}
          </div>
        ) : null}

        {headerText ? (
          <p className="mb-1 text-sm font-semibold text-foreground">{headerText}</p>
        ) : null}

        <p className="whitespace-pre-wrap text-sm text-foreground">{body}</p>

        {footerText ? (
          <p className="mt-2 text-xs text-muted-foreground">{footerText}</p>
        ) : null}
      </div>

      {buttons.length > 0 ? (
        <div className="ml-auto mt-1 flex max-w-sm flex-col gap-1">
          {buttons.map((button, index) => (
            <div
              key={`${button.type}-${index}`}
              className="rounded-lg bg-white p-2 text-center text-sm font-medium text-[#0a7cff] shadow-sm dark:bg-background dark:text-primary"
            >
              {button.text ?? button.type}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Lê com segurança o JSON de botões vindo do banco. */
export function parseButtons(value: unknown): TemplateButton[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Record<string, unknown>;
    return [
      {
        type: typeof record.type === 'string' ? record.type : 'UNKNOWN',
        text: typeof record.text === 'string' ? record.text : null,
        url: typeof record.url === 'string' ? record.url : null,
        phoneNumber: typeof record.phoneNumber === 'string' ? record.phoneNumber : null,
      },
    ];
  });
}
