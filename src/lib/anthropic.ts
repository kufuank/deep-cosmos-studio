/**
 * Minimal Anthropic Messages API client for the browser.
 *
 * The key is supplied by the operator and stored locally — this app has no
 * server, so requests go straight from the page to api.anthropic.com. That
 * requires the explicit browser-access opt-in header.
 */

const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'

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
  apiKey: string
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

export async function callAnthropic(opts: CallOptions): Promise<CallResult> {
  let res: Response
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
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
    throw new AnthropicError(
      'Anthropic API\'ye ulaşılamadı. İnternet bağlantınızı kontrol edin.',
    )
  }

  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      detail = body.error?.message ?? ''
    } catch {
      detail = await res.text().catch(() => '')
    }
    if (res.status === 401) {
      throw new AnthropicError('API anahtarı geçersiz. Ayarlardan kontrol edin.', 401)
    }
    if (res.status === 429) {
      throw new AnthropicError('Hız sınırına takıldınız. Biraz bekleyip tekrar deneyin.', 429)
    }
    throw new AnthropicError(detail || `Anthropic API hatası (${res.status})`, res.status)
  }

  const data = (await res.json()) as { content: ContentBlock[]; stop_reason: string | null }
  return { content: data.content ?? [], stopReason: data.stop_reason }
}
