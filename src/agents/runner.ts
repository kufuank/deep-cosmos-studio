import { callAnthropic } from '../lib/anthropic'
import type { ApiMessage, ContentBlock, ToolDef } from '../lib/anthropic'
import { schemas, cardOrder, allFields } from '../schemas'
import type { CardFields, CardType, FieldValue } from '../schemas'
import { agentInstructions, protocolText } from './instructions'

export interface FieldUpdate {
  key: string
  value: string
  state: 'confirmed' | 'inferred'
  reasoning?: string
}

export interface AgentTurnResult {
  /** Assistant chat text to show the user. */
  text: string
  updates: FieldUpdate[]
  /** Raw blocks appended to history so the next turn keeps tool context. */
  history: ApiMessage[]
}

const setFieldsTool: ToolDef = {
  name: 'set_fields',
  description:
    'Write one or more resolved fields onto the identity sheet. Use this for every value you establish — never write field values into your chat text. Call once per turn with all updates batched.',
  input_schema: {
    type: 'object',
    properties: {
      updates: {
        type: 'array',
        description: 'The fields to write.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Exact field key from the schema listing.' },
            value: {
              type: 'string',
              description:
                'The value, written in English — it is pasted directly into image and video generation models.',
            },
            state: {
              type: 'string',
              enum: ['confirmed', 'inferred'],
              description:
                "'confirmed' when the user supplied or explicitly accepted it; 'inferred' when you derived it.",
            },
            reasoning: {
              type: 'string',
              description:
                'Required for inferred values. In Turkish: the assumption made and the causal chain behind it.',
            },
          },
          required: ['key', 'value', 'state'],
        },
      },
    },
    required: ['updates'],
  },
}

function fieldStateBlock(type: CardType, fields: CardFields): string {
  const schema = schemas[type]
  const lines: string[] = []
  for (const section of schema.sections) {
    lines.push(`\n[${section.title}]`)
    for (const f of section.fields) {
      const cur = fields[f.key]
      const v = cur?.value?.trim()
      if (v) {
        lines.push(`  ${f.key} (${cur.state}) = ${v}`)
      } else {
        const ex = f.examples?.length ? ` | e.g. ${f.examples.join(' / ')}` : ''
        lines.push(`  ${f.key} — MISSING — ${f.hint}${ex}`)
      }
    }
  }
  return lines.join('\n')
}

function ancestorBlock(type: CardType, ancestors: Partial<Record<CardType, CardFields>>): string {
  const idx = cardOrder.indexOf(type)
  const out: string[] = []
  for (const t of cardOrder.slice(0, idx)) {
    const anc = ancestors[t]
    if (!anc) continue
    const s = schemas[t]
    const lines = allFields(s)
      .map((f) => {
        const v = anc[f.key]?.value?.trim()
        return v ? `  ${f.label}: ${v}` : ''
      })
      .filter(Boolean)
    if (lines.length) {
      out.push(`${s.label.toUpperCase()} CARD — LOCKED, FIXED AND IMMUTABLE\n${lines.join('\n')}`)
    }
  }
  return out.join('\n\n')
}

export function buildSystemPrompt(
  type: CardType,
  fields: CardFields,
  ancestors: Partial<Record<CardType, CardFields>>,
): string {
  const inst = agentInstructions[type]
  const parts = [
    inst.role,
    `CORE KNOWLEDGE\n${inst.knowledge}`,
    protocolText(type),
  ]

  const anc = ancestorBlock(type, ancestors)
  if (anc) {
    parts.push(
      `INHERITED CONSTRAINTS\nThe following cards are already locked. Treat every property as fixed and immutable — your card must emerge naturally from them and may never contradict them.\n\n${anc}`,
    )
  }

  parts.push(
    `CURRENT SHEET STATE\nThese are the fields you must resolve. Use the exact keys shown with set_fields.\n${fieldStateBlock(type, fields)}`,
  )

  return parts.join('\n\n────────────────────\n\n')
}

/**
 * Runs one agent turn, resolving the tool loop until the model produces its
 * final text. Returns the chat text plus every field update it made.
 */
export async function runAgentTurn(params: {
  apiKey: string
  model: string
  type: CardType
  fields: CardFields
  ancestors: Partial<Record<CardType, CardFields>>
  history: ApiMessage[]
  userMessage: string
  signal?: AbortSignal
}): Promise<AgentTurnResult> {
  const system = buildSystemPrompt(params.type, params.fields, params.ancestors)
  const validKeys = new Set(allFields(schemas[params.type]).map((f) => f.key))

  const messages: ApiMessage[] = [
    ...params.history,
    { role: 'user', content: params.userMessage },
  ]
  const appended: ApiMessage[] = [{ role: 'user', content: params.userMessage }]

  const updates: FieldUpdate[] = []
  let text = ''

  // The model may call set_fields several times before answering; cap the loop
  // so a misbehaving turn cannot spin.
  for (let i = 0; i < 6; i++) {
    const res = await callAnthropic({
      apiKey: params.apiKey,
      model: params.model,
      system,
      messages,
      tools: [setFieldsTool],
      signal: params.signal,
    })

    const assistantMsg: ApiMessage = { role: 'assistant', content: res.content }
    messages.push(assistantMsg)
    appended.push(assistantMsg)

    for (const block of res.content) {
      if (block.type === 'text') text += (text ? '\n\n' : '') + block.text
    }

    const toolUses = res.content.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    )
    if (!toolUses.length) break

    const results: ContentBlock[] = []
    for (const tu of toolUses) {
      const input = tu.input as { updates?: FieldUpdate[] }
      const accepted: string[] = []
      const rejected: string[] = []
      for (const u of input.updates ?? []) {
        if (!u?.key || typeof u.value !== 'string') continue
        if (!validKeys.has(u.key)) {
          rejected.push(u.key)
          continue
        }
        updates.push({
          key: u.key,
          value: u.value,
          state: u.state === 'confirmed' ? 'confirmed' : 'inferred',
          reasoning: u.reasoning,
        })
        accepted.push(u.key)
      }
      const summary = rejected.length
        ? `Wrote ${accepted.length} field(s). Unknown keys ignored: ${rejected.join(', ')}. Use only the exact keys listed in CURRENT SHEET STATE.`
        : `Wrote ${accepted.length} field(s).`
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: summary })
    }

    const resultMsg: ApiMessage = { role: 'user', content: results }
    messages.push(resultMsg)
    appended.push(resultMsg)
  }

  return { text: text.trim(), updates, history: appended }
}

export function applyUpdates(fields: CardFields, updates: FieldUpdate[]): CardFields {
  const next: CardFields = { ...fields }
  for (const u of updates) {
    const fv: FieldValue = { value: u.value, state: u.state }
    if (u.reasoning) fv.reasoning = u.reasoning
    next[u.key] = fv
  }
  return next
}
