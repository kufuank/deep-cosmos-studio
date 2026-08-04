import { supabase } from './supabase'

/**
 * Calls Anthropic through the `anthropic` edge function.
 *
 * The key lives on the server. This page is a public static site, so it only
 * ever forwards the caller's own Supabase session token.
 */

export const MODELS = [
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — hızlı, günlük kullanım' },
  { id: 'claude-opus-5', label: 'Opus 5 — daha derin akıl yürütme' },
] as const

export interface ToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

export interface ApiMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface CallOptions {
  model: string
  system: string
  messages: ApiMessage[]
  tools?: ToolDef[]
  maxTokens?: number
  signal?: AbortSignal
}

export interface CallResult {
  content: ContentBlock[]
  stopReason: string | null
}

export class AnthropicError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'AnthropicError'
  }
}

function functionUrl(): string {
  const base =
    import.meta.env.VITE_SUPABASE_URL ?? 'https://fypbcazbdjtcrhkkfrtr.supabase.co'
  return `${base}/functions/v1/anthropic`
}

export async function callAnthropic(opts: CallOptions): Promise<CallResult> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) {
    throw new AnthropicError('Oturum bulunamadı. Lütfen tekrar giriş yapın.', 401)
  }

  let res: Response
  try {
    res = await fetch(functionUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 8000,
        system: opts.system,
        messages: opts.messages,
        ...(opts.tools?.length ? { tools: opts.tools } : {}),
      }),
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new AnthropicError('Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.')
  }

  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string | { message?: string } }
      detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? '')
    } catch {
      detail = ''
    }
    if (res.status === 401) {
      throw new AnthropicError(detail || 'Oturumunuz sona ermiş. Tekrar giriş yapın.', 401)
    }
    if (res.status === 429) {
      throw new AnthropicError('Hız sınırına takıldınız. Biraz bekleyip tekrar deneyin.', 429)
    }
    throw new AnthropicError(detail || `Sunucu hatası (${res.status})`, res.status)
  }

  const body = (await res.json()) as { content: ContentBlock[]; stop_reason: string | null }
  return { content: body.content ?? [], stopReason: body.stop_reason }
}
