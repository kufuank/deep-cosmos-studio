/**
 * Anthropic <-> OpenAI translation, so the app can run on NVIDIA NIM.
 *
 * The whole client — agent runner, tool plumbing, SSE accumulator, tests — speaks
 * the Anthropic shape. Rather than rewrite that, the edge function adapts: it
 * accepts an Anthropic request, calls whichever upstream the model belongs to,
 * and always streams Anthropic-shaped events back. Swapping providers therefore
 * touches only this file.
 *
 * Deliberately free of Deno APIs so the same code is exercised by `npm run smoke`.
 */

export interface AnthropicToolDef {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

export interface AnthropicRequest {
  model: string
  system?: string | Array<{ type?: string; text?: string }>
  messages: Array<{ role: string; content: unknown }>
  tools?: AnthropicToolDef[]
  max_tokens?: number
  stream?: boolean
}

/** NVIDIA NIM is OpenAI-compatible; anything not Anthropic routes there. */
export function providerFor(model: string): 'anthropic' | 'nvidia' {
  return model.startsWith('claude-') ? 'anthropic' : 'nvidia'
}

/** System prompt blocks carry cache_control breakpoints Anthropic-side; OpenAI
 *  has no equivalent, so the blocks collapse into one system message. */
function systemText(system: AnthropicRequest['system']): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  return system
    .map((b) => (typeof b?.text === 'string' ? b.text : ''))
    .filter(Boolean)
    .join('\n\n')
}

type OpenAIMessage =
  | { role: 'system' | 'user'; content: unknown }
  | { role: 'assistant'; content: string | null; tool_calls?: unknown[] }
  | { role: 'tool'; tool_call_id: string; content: string }

/**
 * Anthropic packs every tool result for a turn into one user message; OpenAI
 * wants one `tool` message per call. That fan-out is the main structural
 * difference between the two formats.
 */
export function toOpenAIMessages(req: AnthropicRequest): OpenAIMessage[] {
  const out: OpenAIMessage[] = []
  const sys = systemText(req.system)
  if (sys) out.push({ role: 'system', content: sys })

  for (const m of req.messages) {
    const content = m.content

    if (typeof content === 'string') {
      out.push(
        m.role === 'assistant'
          ? { role: 'assistant', content }
          : { role: 'user', content },
      )
      continue
    }
    if (!Array.isArray(content)) continue

    const blocks = content as Array<Record<string, any>>

    if (m.role === 'assistant') {
      const text = blocks
        .filter((b) => b.type === 'text')
        .map((b) => String(b.text ?? ''))
        .join('')
      const calls = blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({
          id: String(b.id ?? ''),
          type: 'function',
          function: { name: String(b.name ?? ''), arguments: JSON.stringify(b.input ?? {}) },
        }))
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length ? { tool_calls: calls } : {}),
      })
      continue
    }

    // A user turn may mix tool results with ordinary content. Tool results become
    // their own messages and must precede the remaining user content.
    const results = blocks.filter((b) => b.type === 'tool_result')
    for (const r of results) {
      const c = r.content
      out.push({
        role: 'tool',
        tool_call_id: String(r.tool_use_id ?? ''),
        content: typeof c === 'string' ? c : JSON.stringify(c ?? ''),
      })
    }

    const rest = blocks
      .filter((b) => b.type === 'text' || b.type === 'image')
      .map((b) => {
        if (b.type === 'text') return { type: 'text', text: String(b.text ?? '') }
        const src = b.source ?? {}
        return {
          type: 'image_url',
          image_url: { url: `data:${src.media_type ?? 'image/jpeg'};base64,${src.data ?? ''}` },
        }
      })
    if (rest.length) out.push({ role: 'user', content: rest })
  }

  return out
}

export function toOpenAIRequest(req: AnthropicRequest, maxTokens: number): Record<string, unknown> {
  return {
    model: req.model,
    messages: toOpenAIMessages(req),
    max_tokens: maxTokens,
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description ?? '',
              parameters: t.input_schema,
            },
          })),
        }
      : {}),
    ...(req.stream
      ? { stream: true, stream_options: { include_usage: true } }
      : {}),
  }
}

const STOP_REASON: Record<string, string> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  content_filter: 'refusal',
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * Rewrites an OpenAI delta stream as Anthropic events.
 *
 * OpenAI numbers tool calls independently of content, and sends a tool call's
 * arguments as a JSON string split across deltas — the same shape Anthropic
 * calls `input_json_delta`. Content block indices are therefore assigned here:
 * text takes index 0, each tool call the next free slot.
 */
export function createOpenAIToAnthropic() {
  let buffer = ''
  let started = false
  let textOpen = false
  let nextIndex = 0
  /** OpenAI tool-call index -> our content block index */
  const toolIndex = new Map<number, number>()
  let stopReason = 'end_turn'
  let usage: { input: number; output: number } | null = null
  let done = false

  function open(out: string[]) {
    if (started) return
    started = true
    out.push(sse('message_start', { type: 'message_start', message: { role: 'assistant' } }))
  }

  function handle(payload: string, out: string[]) {
    if (payload === '[DONE]') {
      done = true
      return
    }
    let evt: any
    try {
      evt = JSON.parse(payload)
    } catch {
      return // a malformed chunk is skipped rather than killing the turn
    }

    if (evt.error) {
      out.push(
        sse('error', {
          type: 'error',
          error: { message: String(evt.error?.message ?? 'upstream error') },
        }),
      )
      return
    }

    if (evt.usage) {
      usage = {
        input: Number(evt.usage.prompt_tokens ?? 0),
        output: Number(evt.usage.completion_tokens ?? 0),
      }
    }

    const choice = evt.choices?.[0]
    if (!choice) return
    open(out)

    const delta = choice.delta ?? {}

    if (typeof delta.content === 'string' && delta.content) {
      if (!textOpen) {
        textOpen = true
        nextIndex = Math.max(nextIndex, 1)
        out.push(
          sse('content_block_start', {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          }),
        )
      }
      out.push(
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: delta.content },
        }),
      )
    }

    for (const call of delta.tool_calls ?? []) {
      const oi = Number(call.index ?? 0)
      if (!toolIndex.has(oi)) {
        const idx = nextIndex === 0 ? 1 : nextIndex
        nextIndex = idx + 1
        toolIndex.set(oi, idx)
        out.push(
          sse('content_block_start', {
            type: 'content_block_start',
            index: idx,
            content_block: {
              type: 'tool_use',
              id: String(call.id ?? `call_${oi}`),
              name: String(call.function?.name ?? ''),
            },
          }),
        )
      }
      const args = call.function?.arguments
      if (typeof args === 'string' && args) {
        out.push(
          sse('content_block_delta', {
            type: 'content_block_delta',
            index: toolIndex.get(oi)!,
            delta: { type: 'input_json_delta', partial_json: args },
          }),
        )
      }
    }

    if (choice.finish_reason) {
      stopReason = STOP_REASON[choice.finish_reason] ?? 'end_turn'
    }
  }

  return {
    /** Feed raw upstream text; returns Anthropic-shaped SSE text to forward. */
    push(chunk: string): string {
      const out: string[] = []
      buffer += chunk
      let i: number
      while ((i = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, i)
        buffer = buffer.slice(i + 2)
        const line = raw.split('\n').find((l) => l.startsWith('data:'))
        if (line) handle(line.slice(5).trim(), out)
      }
      return out.join('')
    },
    /** Closes any open blocks and emits the terminal events. */
    finish(): string {
      const out: string[] = []
      if (!started) open(out)
      if (textOpen) {
        out.push(sse('content_block_stop', { type: 'content_block_stop', index: 0 }))
      }
      for (const idx of toolIndex.values()) {
        out.push(sse('content_block_stop', { type: 'content_block_stop', index: idx }))
      }
      out.push(
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: stopReason },
          ...(usage
            ? { usage: { input_tokens: usage.input, output_tokens: usage.output } }
            : {}),
        }),
      )
      out.push(sse('message_stop', { type: 'message_stop' }))
      return out.join('')
    },
    get finished() {
      return done
    },
  }
}

/**
 * Non-streaming OpenAI response -> Anthropic message.
 *
 * Shot analysis does not stream (it wants one complete tool call per frame set),
 * so this path matters as much as the streaming one.
 */
export function toAnthropicMessage(oa: any): Record<string, unknown> {
  const choice = oa?.choices?.[0] ?? {}
  const msg = choice.message ?? {}
  const content: unknown[] = []

  if (typeof msg.content === 'string' && msg.content.trim()) {
    content.push({ type: 'text', text: msg.content })
  }
  for (const call of msg.tool_calls ?? []) {
    let input: unknown = {}
    try {
      input = JSON.parse(call?.function?.arguments || '{}')
    } catch {
      input = {} // a truncated call is dropped rather than half-applied
    }
    content.push({
      type: 'tool_use',
      id: String(call?.id ?? ''),
      name: String(call?.function?.name ?? ''),
      input,
    })
  }

  return {
    id: String(oa?.id ?? ''),
    type: 'message',
    role: 'assistant',
    content,
    stop_reason: STOP_REASON[choice.finish_reason] ?? 'end_turn',
    usage: {
      input_tokens: Number(oa?.usage?.prompt_tokens ?? 0),
      output_tokens: Number(oa?.usage?.completion_tokens ?? 0),
    },
  }
}
