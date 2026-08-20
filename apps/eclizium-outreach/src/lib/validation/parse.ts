import type { ZodTypeAny, z } from 'zod';
import { AppError } from '@/lib/errors/app-error';

/**
 * Validates `input` or throws a VALIDATION_ERROR carrying per-field messages
 * ready for the form UI. All server entry points go through this — client-side
 * validation is a convenience, never the gate.
 */
export function parseOrThrow<Schema extends ZodTypeAny>(
  schema: Schema,
  input: unknown,
  message = 'Dados inválidos.',
): z.infer<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const flattened = result.error.flatten();
    throw AppError.validation(message, flattened.fieldErrors as Record<string, string[]>);
  }
  return result.data;
}

/** Converts a `FormData` into a plain object suitable for a Zod object schema. */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key in output) {
      const existing = output[key];
      output[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      output[key] = value;
    }
  }
  return output;
}
