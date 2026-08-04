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
  | {
      type: 'image'
      source: { type: 'base64'; media_type: string; data: string }
    }

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

export interface StreamHandlers {
  /** Fired for each chunk of assistant prose as it is produced. */
  onText?: (delta: string) => void
  /** Fired once the model commits to a tool call, before its input is complete. */
  onToolStart?: (name: string) => void
}

/**
 * Same call, streamed. A full agent turn regularly runs past a minute, so the
 * blocking form leaves the user staring at a spinner; this surfaces tokens as
 * they arrive and reconstructs the same content blocks at the end.
 */
export async function streamAnthropic(
  opts: CallOptions & StreamHandlers,
): Promise<CallResult> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) {
    throw new AnthropicError('Oturum bulunamadı. Lütfen tekrar giriş yapın.', 401)
  }

  let res: Response
  try {
    res = await fetch(functionUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 8000,
        system: opts.system,
        messages: opts.messages,
        stream: true,
        ...(opts.tools?.length ? { tools: opts.tools } : {}),
      }),
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new AnthropicError('Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.')
  }

  if (!res.ok || !res.body) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string | { message?: string } }
      detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? '')
    } catch {
      /* fall through to the status-based message */
    }
    if (res.status === 401) {
      throw new AnthropicError(detail || 'Oturumunuz sona ermiş. Tekrar giriş yapın.', 401)
    }
    if (res.status === 429) {
      throw new AnthropicError('Hız sınırına takıldınız. Biraz bekleyip tekrar deneyin.', 429)
    }
    throw new AnthropicError(detail || `Sunucu hatası (${res.status})`, res.status)
  }

  const acc = createStreamAccumulator(opts)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    acc.push(decoder.decode(value, { stream: true }))
  }
  return acc.finish()
}

/**
 * Reassembles Anthropic's SSE events into content blocks.
 *
 * Split out from the transport so it can be exercised directly: chunk
 * boundaries fall anywhere, including mid-event and mid-UTF-8, and tool input
 * arrives as JSON fragments that only become parseable once the block closes.
 */
export function createStreamAccumulator(handlers: StreamHandlers = {}) {
  const blocks: ContentBlock[] = []
  const partialJson: Record<number, string> = {}
  let stopReason: string | null = null
  let buffer = ''

  function handleEvent(raw: string) {
    // An event may carry comment and id lines too; only data matters here.
    const line = raw.split('\n').find((l) => l.startsWith('data:'))
    if (!line) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return

    let evt: Record<string, any>
    try {
      evt = JSON.parse(payload)
    } catch {
      return // a malformed event is skipped rather than killing the turn
    }

    switch (evt.type) {
      case 'content_block_start': {
        const i = evt.index as number
        if (evt.content_block?.type === 'text') {
          blocks[i] = { type: 'text', text: '' }
        } else if (evt.content_block?.type === 'tool_use') {
          blocks[i] = {
            type: 'tool_use',
            id: evt.content_block.id,
            name: evt.content_block.name,
            input: {},
          }
          partialJson[i] = ''
          handlers.onToolStart?.(evt.content_block.name)
        }
        break
      }
      case 'content_block_delta': {
        const i = evt.index as number
        if (evt.delta?.type === 'text_delta') {
          const b = blocks[i]
          if (b?.type === 'text') {
            b.text += evt.delta.text
            handlers.onText?.(evt.delta.text)
          }
        } else if (evt.delta?.type === 'input_json_delta') {
          partialJson[i] = (partialJson[i] ?? '') + (evt.delta.partial_json ?? '')
        }
        break
      }
      case 'content_block_stop': {
        const i = evt.index as number
        const b = blocks[i]
        if (b?.type === 'tool_use') {
          try {
            b.input = partialJson[i] ? JSON.parse(partialJson[i]) : {}
          } catch {
            // A truncated tool call is dropped rather than half-applied.
            b.input = {}
          }
        }
        break
      }
      case 'message_delta':
        stopReason = evt.delta?.stop_reason ?? stopReason
        break
      case 'error':
        throw new AnthropicError(evt.error?.message ?? 'Akış sırasında hata oluştu.')
    }
  }

  return {
    push(chunk: string) {
      buffer += chunk
      // SSE events are separated by a blank line.
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        handleEvent(buffer.slice(0, idx))
        buffer = buffer.slice(idx + 2)
      }
    },
    finish(): CallResult {
      if (buffer.trim()) handleEvent(buffer)
      buffer = ''
      return { content: blocks.filter(Boolean), stopReason }
    },
  }
}
