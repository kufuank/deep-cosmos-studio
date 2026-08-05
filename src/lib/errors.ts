/**
 * Turns anything thrown into a message worth showing.
 *
 * Supabase returns plain objects for database failures, not Error instances, so
 * a bare `e instanceof Error` check silently collapses real messages — including
 * constraint violations — into "unexpected error".
 */
export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message

  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    const message = typeof o.message === 'string' ? o.message : ''
    const details = typeof o.details === 'string' ? o.details : ''
    const hint = typeof o.hint === 'string' ? o.hint : ''
    const code = typeof o.code === 'string' ? o.code : ''

    const main = message || details
    if (main) {
      const suffix = [hint, code && `kod: ${code}`].filter(Boolean).join(' · ')
      return suffix ? `${main} (${suffix})` : main
    }
  }

  if (typeof e === 'string' && e.trim()) return e
  return 'Beklenmeyen bir hata oluştu.'
}

/** True when the failure is a user-initiated cancellation rather than a fault. */
export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}
