import type { ActionResult } from '@/lib/errors/result';

/**
 * Shape returned by the auth form actions. Kept out of the `'use server'`
 * module because those files may only export async functions.
 */
export type AuthActionState = ActionResult<{ redirectTo: string }> | null;
