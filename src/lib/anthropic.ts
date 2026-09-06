import { supabase } from './supabase'

/**
 * Calls Anthropic through the `anthropic` edge function.
 *
 * The key lives on the server. This page is a public static site, so it only
 * ever forwards the caller's own Supabase session token.
 */

/**
 * The edge function speaks the Anthropic shape for every entry here; NVIDIA
 * models are translated server-side, so nothing in the client changes when one
 * is selected. NVIDIA NIM is free but rate limited to roughly 40 requests per
 * minute across the whole key.
 */
export const MODELS = [
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — hızlı, günlük kullanım', vision: true },
  { id: 'claude-opus-5', label: 'Opus 5 — daha derin akıl yürütme', vision: true },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b',
    label: 'NVIDIA · Nemotron 3 Super 120B — ücretsiz, metin',
    vision: false,
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b',
    label: 'NVIDIA · Nemotron 3 Ultra 550B — ücretsiz, metin',
    vision: false,
  },
  {
    id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    label: 'NVIDIA · Nemotron Ultra 253B — ücretsiz, metin',
    vision: false,
  },
  {
    id: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    label: 'NVIDIA · Nemotron 3.5 Lightning 30B — ücretsiz, en hızlı',
    vision: false,
  },
  {
    id: 'nvidia/nemotron-nano-3-30b-a3b',
    label: 'NVIDIA · Nemotron Nano 3 30B — ücretsiz, hızlı',
    vision: false,
  },
  { id: 'openai/gpt-oss-20b', label: 'NVIDIA · GPT-OSS 20B — ücretsiz, metin', vision: false },
  { id: 'moonshotai/kimi-k3', label: 'NVIDIA · Kimi K3 — ücretsiz, metin', vision: false },
  {
    id: 'deepseek-ai/deepseek-v4-pro-0813',
    label: 'NVIDIA · DeepSeek V4 Pro — ücretsiz, metin',
    vision: false,
  },
  {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    label: 'NVIDIA · Nemotron 3 Omni 30B — ücretsiz, görsel',
    vision: true,
  },
  {
    id: 'meta/llama-3.2-90b-vision-instruct',
    label: 'NVIDIA · Llama 3.2 90B Vision — ücretsiz, görsel',
    vision: true,
  },
  {
    id: 'meta/llama-3.2-11b-vision-instruct',
    label: 'NVIDIA · Llama 3.2 11B Vision — ücretsiz, görsel',
    vision: true,
  },
  { id: 'google/gemma-3-12b-it', label: 'NVIDIA · Gemma 3 12B — ücretsiz, görsel', vision: true },
] as const

/**
 * Whether a model can read Shot Library frames.
 *
 * This was a substring test on the model name until the name it keyed off
 * stopped existing. A frame sent to a text model is not refused — it is
 * dropped, and the analysis then describes nothing — so the answer has to come
 * from the table above rather than from how an id happens to be spelled.
 */
export function supportsVision(model: string): boolean {
  const known = MODELS.find((m) => m.id === model)
  if (known) return known.vision
  return model.startsWith('claude-')
}

export function isFreeProvider(model: string): boolean {
  return !model.startsWith('claude-')
}

/**
 * NIM's vision model, used whenever the chosen chat model cannot see.
 *
 * Shot analysis returns its 16 columns through a tool call, so this model has
 * to do images *and* tool calls — a plain VLM is not enough. Verify a
 * replacement with `npm run check:nvidia` before changing it.
 */
export const NVIDIA_VISION_MODEL = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'

/**
 * The model that must handle a frame-carrying request.
 *
 * The chat model and the vision model are not the same choice: most NIM models
 * cannot read images, and sending frames to one drops them silently. Shot
 * analysis therefore always resolves its own model rather than inheriting
 * whatever is selected for conversation.
 */
export function visionModelFor(chatModel: string): string {
  return supportsVision(chatModel) ? chatModel : NVIDIA_VISION_MODEL
}

/**
 * NIM's free tier allows roughly 40 requests per minute across the whole key.
 * Shot analysis is one request per shot, so it must pace itself or a long video
 * ends in 429s partway through.
 */
export const FREE_TIER_MIN_GAP_MS = 1600

export interface ToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }
  // Claude Sonnet 5 / Opus 5 think by default even when the request carries no
  // thinking parameter. The blocks must be captured — both so the turn is not
  // mistaken for empty, and so they can be echoed back unchanged in the tool
  // loop. With the default display they arrive with empty text but still
  // consume output tokens.
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | {
      type: 'image'
      source: { type: 'base64'; media_type: string; data: string }
    }

export interface ApiMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

/**
 * A system prompt block. Marking a block `cache: true` places a prompt-cache
 * breakpoint after it: everything up to and including that block (tools render
 * first, then system) is served from cache on the next request at ~10% of the
 * input price. Caching is a prefix match, so stable content must come first and
 * anything that changes per turn must follow the last cached block.
 */
export interface SystemBlock {
  text: string
  cache?: boolean
}

/** Thinking depth. Thinking is billed as output tokens, so this is the main cost dial. */
export type Effort = 'low' | 'medium' | 'high'
export const EFFORTS: { id: Effort; label: string; hint: string }[] = [
  { id: 'low', label: 'Düşük — hızlı ve ucuz', hint: 'Kısa sohbet turları, tek alan düzeltmeleri.' },
  { id: 'medium', label: 'Orta — önerilen', hint: 'Alan doldurma ve çıkarım için yeterli derinlik, makul maliyet.' },
  { id: 'high', label: 'Yüksek — en derin', hint: 'Zor fizik/biyoloji tutarlılık sorularında; birkaç kat daha pahalı.' },
]

export interface CallOptions {
  model: string
  /** A plain string is sent as-is; blocks enable prompt caching. */
  system: string | SystemBlock[]
  messages: ApiMessage[]
  tools?: ToolDef[]
  maxTokens?: number
  effort?: Effort
  /**
   * Also cache the conversation so far. Within a multi-request agent turn the
   * second and later requests then re-read the whole history from cache
   * instead of re-billing it in full.
   */
  cacheMessages?: boolean
  signal?: AbortSignal
}

/** Token accounting for one request, straight from the API's usage fields. */
export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export const EMPTY_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}

export interface CallResult {
  content: ContentBlock[]
  stopReason: string | null
  usage: Usage
}

/**
 * Builds the wire-format request body. Shared by both transports so the cache
 * breakpoints, effort and limits are identical whether or not we stream.
 */
export function buildRequestBody(opts: CallOptions, stream: boolean): Record<string, unknown> {
  const system =
    typeof opts.system === 'string'
      ? opts.system
      : opts.system
          .filter((b) => b.text.trim())
          .map((b) => ({
            type: 'text',
            text: b.text,
            ...(b.cache ? { cache_control: { type: 'ephemeral' } } : {}),
          }))

  let messages: unknown[] = opts.messages
  if (opts.cacheMessages && opts.messages.length) {
    // Breakpoint on the last block of the last message: the whole conversation
    // prefix becomes cache-readable for the next request in this turn.
    const last = opts.messages[opts.messages.length - 1]
    const blocks: unknown[] =
      typeof last.content === 'string'
        ? [{ type: 'text', text: last.content }]
        : last.content.map((b) => ({ ...b }))
    if (blocks.length) {
      const tail = blocks[blocks.length - 1] as Record<string, unknown>
      blocks[blocks.length - 1] = { ...tail, cache_control: { type: 'ephemeral' } }
      messages = [...opts.messages.slice(0, -1), { role: last.role, content: blocks }]
    }
  }

  return {
    model: opts.model,
    // max_tokens caps thinking + visible output combined. The model thinks by
    // default, and a hard sheet can burn 8k tokens of thinking alone — a low
    // cap ends the turn at stop_reason "max_tokens" before any field is
    // written. 24000 leaves room for thinking plus a large batched tool call.
    max_tokens:
      opts.maxTokens ??
      // Anthropic's budget has to cover thinking as well as visible output; NIM
      // models do not think, and several cap output well below 24k.
      (isFreeProvider(opts.model) ? 8000 : 24000),
    system,
    messages,
    ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
    ...(opts.tools?.length ? { tools: opts.tools } : {}),
    ...(stream ? { stream: true } : {}),
  }
}

/**
 * Pulls a human message out of an error response.
 *
 * The providers disagree about where it lives — Anthropic uses
 * `{error: {type, message}}`, NIM variously `{detail}`, `{message}` or
 * `{title}`. Reading only Anthropic's shape meant a NIM failure arrived with
 * nothing to show, and a retired model reported itself as 'Sunucu hatası
 * (410)'. The server normalises this too; the client reads both shapes so an
 * older deployment still explains itself.
 */
async function errorDetail(res: Response): Promise<{ detail: string; kind?: string }> {
  try {
    const b = (await res.json()) as Record<string, any>
    if (typeof b?.error === 'string') return { detail: b.error }
    if (b?.error && typeof b.error === 'object') {
      const detail = String(b.error.message ?? b.error.detail ?? '')
      if (detail) return { detail, kind: b.error.type ? String(b.error.type) : undefined }
    }
    const d = b?.detail
    const detail =
      typeof d === 'string'
        ? d
        : Array.isArray(d)
          ? d.map((x: any) => x?.msg ?? x?.message ?? '').filter(Boolean).join('; ')
          : String(b?.message ?? b?.title ?? '')
    return { detail }
  } catch {
    return { detail: '' }
  }
}

/** A model that the provider has withdrawn — the commonest free-tier breakage. */
function goneMessage(model: string, detail: string): string {
  const base =
    'Seçili model (' +
    model +
    ") sağlayıcının kataloğundan kaldırılmış. Ayarlar bölümünden başka bir model seçin."
  return detail ? base + ' Sağlayıcı: ' + detail : base
}

export class AnthropicError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Anthropic's error type, e.g. 'overloaded_error', when known. */
    readonly kind?: string,
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

/** Blocking variant with the same transient-failure retry as the stream. */
export async function callAnthropic(
  opts: CallOptions & { onRetry?: (attempt: number, waitMs: number) => void },
): Promise<CallResult> {
  let attempt = 0
  for (;;) {
    try {
      return await callOnce(opts)
    } catch (e) {
      if (!isTransient(e) || attempt >= RETRY_DELAYS_MS.length) throw e
      const wait = RETRY_DELAYS_MS[attempt++]
      opts.onRetry?.(attempt, wait)
      await sleep(wait, opts.signal)
    }
  }
}

async function callOnce(opts: CallOptions): Promise<CallResult> {
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
      body: JSON.stringify(buildRequestBody(opts, false)),
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new AnthropicError('Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.')
  }

  if (!res.ok) {
    const { detail, kind } = await errorDetail(res)
    if (res.status === 401) {
      throw new AnthropicError(detail || 'Oturumunuz sona ermiş. Tekrar giriş yapın.', 401)
    }
    if (res.status === 410 || res.status === 404) {
      throw new AnthropicError(goneMessage(opts.model, detail), res.status, 'model_gone')
    }
    if (res.status === 429) {
      throw new AnthropicError('Hız sınırına takıldınız. Biraz bekleyip tekrar deneyin.', 429)
    }
    if (res.status === 529 || kind === 'overloaded_error') {
      throw new AnthropicError(OVERLOADED_MESSAGE, 529, 'overloaded_error')
    }
    throw new AnthropicError(detail || `Sunucu hatası (${res.status})`, res.status, kind)
  }

  const body = (await res.json()) as {
    content: ContentBlock[]
    stop_reason: string | null
    usage?: Record<string, number>
  }
  return { content: body.content ?? [], stopReason: body.stop_reason, usage: readUsage(body.usage) }
}

function readUsage(u: Record<string, number> | undefined): Usage {
  return {
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    cacheWrite: u?.cache_creation_input_tokens ?? 0,
  }
}

export interface StreamHandlers {
  /** Fired for each chunk of assistant prose as it is produced. */
  onText?: (delta: string) => void
  /** Fired once the model commits to a tool call, before its input is complete. */
  onToolStart?: (name: string) => void
  /** Fired when a thinking block opens — nothing visible streams during it. */
  onThinking?: () => void
  /** Fired before a retry of a transient upstream failure. */
  onRetry?: (attempt: number, waitMs: number) => void
}

/**
 * Errors worth retrying: Anthropic capacity/transient failures. Anything else
 * (auth, validation, our own edge function refusing) is surfaced immediately.
 */
export function isTransient(e: unknown): boolean {
  if (!(e instanceof AnthropicError)) return false
  // 429 is expected traffic on the free tier rather than a fault, so it retries
  // like an overload instead of surfacing as an error.
  if (e.status === 429) return true
  if (e.status === 529 || e.status === 500 || e.status === 502 || e.status === 503) return true
  return e.kind === 'overloaded_error' || e.kind === 'api_error'
}

const RETRY_DELAYS_MS = [2000, 5000, 12000]

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

/**
 * Same call, streamed. A full agent turn regularly runs past a minute, so the
 * blocking form leaves the user staring at a spinner; this surfaces tokens as
 * they arrive and reconstructs the same content blocks at the end.
 *
 * Retries transient upstream failures. Under load Anthropic opens the stream
 * with HTTP 200 and then writes an `error` event (overloaded_error) a few
 * seconds in — so the retry has to wrap the whole read, not just the fetch.
 * A retry only happens while nothing user-visible has streamed yet; once text
 * is on screen a retry would duplicate it, so the error is surfaced instead.
 */
export async function streamAnthropic(
  opts: CallOptions & StreamHandlers,
): Promise<CallResult> {
  let attempt = 0
  for (;;) {
    let textStreamed = false
    try {
      return await streamOnce({
        ...opts,
        onText: (d) => {
          textStreamed = true
          opts.onText?.(d)
        },
      })
    } catch (e) {
      if (textStreamed || !isTransient(e) || attempt >= RETRY_DELAYS_MS.length) throw e
      const wait = RETRY_DELAYS_MS[attempt++]
      opts.onRetry?.(attempt, wait)
      await sleep(wait, opts.signal)
    }
  }
}

async function streamOnce(opts: CallOptions & StreamHandlers): Promise<CallResult> {
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
      body: JSON.stringify(buildRequestBody(opts, true)),
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new AnthropicError('Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.')
  }

  if (!res.ok || !res.body) {
    const { detail, kind } = await errorDetail(res)
    if (res.status === 401) {
      throw new AnthropicError(detail || 'Oturumunuz sona ermiş. Tekrar giriş yapın.', 401)
    }
    if (res.status === 410 || res.status === 404) {
      throw new AnthropicError(goneMessage(opts.model, detail), res.status, 'model_gone')
    }
    if (res.status === 429) {
      throw new AnthropicError('Hız sınırına takıldınız. Biraz bekleyip tekrar deneyin.', 429)
    }
    if (res.status === 529 || kind === 'overloaded_error') {
      throw new AnthropicError(OVERLOADED_MESSAGE, 529, 'overloaded_error')
    }
    throw new AnthropicError(detail || `Sunucu hatası (${res.status})`, res.status, kind)
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

export const OVERLOADED_MESSAGE =
  'Anthropic sunucuları şu an aşırı yüklü (overloaded). Otomatik olarak birkaç kez yeniden denendi ama yer açılmadı — bir-iki dakika sonra tekrar deneyin. Bu bir uygulama hatası değil, sağlayıcı tarafında kapasite sorunu.'

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
  let usage: Usage = { ...EMPTY_USAGE }
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
        } else if (evt.content_block?.type === 'thinking') {
          // Dropping these once made a whole turn look empty: the model spent
          // its entire token budget thinking, and the client saw no blocks at
          // all. They must be kept so the turn can be judged and echoed back.
          blocks[i] = { type: 'thinking', thinking: '', signature: '' }
          handlers.onThinking?.()
        } else if (evt.content_block?.type === 'redacted_thinking') {
          blocks[i] = { type: 'redacted_thinking', data: evt.content_block.data ?? '' }
          handlers.onThinking?.()
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
        } else if (evt.delta?.type === 'thinking_delta') {
          const b = blocks[i]
          if (b?.type === 'thinking') b.thinking += evt.delta.thinking ?? ''
        } else if (evt.delta?.type === 'signature_delta') {
          // The signature must survive byte-for-byte — the API rejects echoed
          // thinking blocks whose content or signature was altered.
          const b = blocks[i]
          if (b?.type === 'thinking') b.signature += evt.delta.signature ?? ''
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
      case 'message_start': {
        // Input-side accounting arrives up front; cache_read tells us whether
        // the prompt-cache breakpoints are actually landing.
        const u = evt.message?.usage as Record<string, number> | undefined
        if (u) usage = { ...usage, ...readUsage(u), output: usage.output }
        break
      }
      case 'message_delta':
        stopReason = evt.delta?.stop_reason ?? stopReason
        // Output count is cumulative in message_delta — thinking included.
        if (typeof evt.usage?.output_tokens === 'number') usage.output = evt.usage.output_tokens
        // Anthropic reports input in message_start; NIM only knows it once the
        // stream ends, so it arrives here. Reading it only from message_start
        // recorded every free-tier turn as zero input — which hid the one cost
        // we control, the prompt we send.
        if (typeof evt.usage?.input_tokens === 'number' && evt.usage.input_tokens > 0) {
          usage.input = evt.usage.input_tokens
        }
        break
      case 'error': {
        // Under load the API returns 200, opens the stream, and then writes
        // this event instead of content. Classify it so the caller can retry.
        const kind = evt.error?.type as string | undefined
        if (kind === 'overloaded_error') {
          throw new AnthropicError(OVERLOADED_MESSAGE, 529, kind)
        }
        throw new AnthropicError(
          evt.error?.message ?? 'Akış sırasında hata oluştu.',
          kind === 'api_error' ? 500 : undefined,
          kind,
        )
      }
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
      return { content: blocks.filter(Boolean), stopReason, usage }
    },
  }
}
