import { supabase } from './supabase'
import type { Usage } from './anthropic'

/**
 * Persists one unit of spend to dc_usage. Fire-and-forget: accounting must
 * never break the turn that produced it, so failures are only logged.
 */
export function recordUsage(entry: {
  kind: 'agent_turn' | 'shot_analysis'
  agent: string
  cardId?: string | null
  model: string
  effort?: string
  requests: number
  usage: Usage
}): void {
  void supabase
    .from('dc_usage')
    .insert({
      kind: entry.kind,
      agent: entry.agent,
      card_id: entry.cardId ?? null,
      model: entry.model,
      effort: entry.effort ?? null,
      requests: entry.requests,
      input_tokens: entry.usage.input,
      output_tokens: entry.usage.output,
      cache_read: entry.usage.cacheRead,
      cache_write: entry.usage.cacheWrite,
    })
    .then(({ error }) => {
      if (error) console.warn('dc_usage insert failed', error)
    })
}

/**
 * Human-readable one-liner for the chat footer. Cache reads are shown because
 * they are the proof that the prompt-cache breakpoints are landing.
 */
export function describeUsage(u: Usage, requests: number): string {
  const fmt = (n: number) => n.toLocaleString('tr-TR')
  const cached = u.cacheRead > 0 ? `, ${fmt(u.cacheRead)} önbellekten` : ''
  return `Bu tur: ${requests} istek · ${fmt(u.input + u.cacheRead + u.cacheWrite)} giriş${cached} · ${fmt(u.output)} çıktı (düşünme dahil)`
}

/** Rough USD estimate at list price, for the settings panel only. */
export function estimateCostUsd(model: string, u: Usage): number {
  // $/M tokens. Sonnet 5 sticker 3/15 (intro 2/10 through Aug 2026); Opus 5 5/25.
  const [inP, outP] = model.includes('opus') ? [5, 25] : [3, 15]
  return (
    (u.input * inP + u.cacheWrite * inP * 1.25 + u.cacheRead * inP * 0.1 + u.output * outP) / 1_000_000
  )
}
