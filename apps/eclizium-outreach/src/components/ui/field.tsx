import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  errors?: string[] | undefined;
  children: ReactNode;
  className?: string;
}

/**
 * Wraps a control with its label, hint and server-side error messages. Errors
 * are rendered in an `aria-live` region and wired to the control through
 * `aria-describedby` (set by the caller via `${id}-error`).
 */
export function Field({ id, label, hint, errors, children, className }: FieldProps) {
  const hasError = Boolean(errors && errors.length > 0);

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !hasError ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <div id={`${id}-error`} aria-live="polite" className="min-h-0">
        {hasError
          ? errors?.map((message) => (
              <p key={message} className="text-xs text-destructive">
                {message}
              </p>
            ))
          : null}
      </div>
    </div>
  );
}
