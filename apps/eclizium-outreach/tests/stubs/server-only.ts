/**
 * `server-only` throws when imported outside the React Server Component
 * condition. Vitest runs plain Node, so the marker is aliased to this no-op.
 * The guarantee it provides (build-time failure if a client component imports a
 * server module) still holds for `next build`, which is where it matters.
 */
export {};
