import { streamAnthropic } from '../lib/anthropic'
import type { ApiMessage, ContentBlock, ToolDef } from '../lib/anthropic'
import { schemas, cardOrder, allFields, isSceneCard, SCENE_FIELDS } from '../schemas'
import type { CardFields, CardType, FieldValue, Scene } from '../schemas'
import { loadAgentConfig } from './config'
import type { AgentConfig } from './config'

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
  /** Replacement scene list, when the storyboard agent rewrote it. */
  scenes: Scene[] | null
  /** Present when the agent produced a protocol improvement proposal. */
  proposal: ProtocolProposal | null
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

const proposeTool: ToolDef = {
  name: 'propose_protocol_improvement',
  description:
    'After the user has locked or approved the card, record a generalised improvement to this agent’s own protocol. Use only for reusable methodology — never for facts about this particular world. Call at most once.',
  input_schema: {
    type: 'object',
    properties: {
      proposed_change: {
        type: 'string',
        description:
          'The rule to add or amend, written so it applies to any future card, in Turkish.',
      },
      rationale: {
        type: 'string',
        description: 'What in this interaction revealed the gap, in Turkish.',
      },
      expected_benefit: {
        type: 'string',
        description: 'What improves in future runs if this is adopted, in Turkish.',
      },
    },
    required: ['proposed_change', 'rationale', 'expected_benefit'],
  },
}

const setScenesTool: ToolDef = {
  name: 'set_scenes',
  description:
    'Write the complete ordered scene list for the storyboard. One source shot becomes exactly one scene. Call once with every scene — this replaces any previous scene list.',
  input_schema: {
    type: 'object',
    properties: {
      scenes: {
        type: 'array',
        description: 'Scenes in playback order.',
        items: {
          type: 'object',
          properties: {
            timestamp_start: { type: 'string', description: 'Start of the scene, e.g. 00:00.0' },
            timestamp_end: { type: 'string', description: 'End of the scene, e.g. 00:03.2' },
            scene_description: {
              type: 'string',
              description: 'Short description of the shot, in English.',
            },
            camera_angle: { type: 'string', description: 'Low angle, eye level, aerial, overhead…' },
            shot_type: { type: 'string', description: 'Wide, medium, close-up, macro…' },
            camera_movement: {
              type: 'string',
              description: 'Static, pan, tilt, dolly, tracking, crane, drone, handheld…',
            },
            visual_prompt: {
              type: 'string',
              description:
                'A detailed production-ready visual description adapted to the fictional world, in English. This is pasted directly into an image or video model.',
            },
            audio: { type: 'string', description: 'Diegetic environmental sound only, in English.' },
            voice_over: {
              type: 'string',
              description:
                'Wildlife documentary narration for this scene, in English, belonging entirely to the fictional world.',
            },
            source_shot: {
              type: 'string',
              description:
                'Which shot of the source list this adapts, by number and timecode, for traceability.',
            },
          },
          required: [
            'timestamp_start',
            'timestamp_end',
            'scene_description',
            'camera_angle',
            'shot_type',
            'camera_movement',
            'visual_prompt',
            'audio',
            'voice_over',
            'source_shot',
          ],
        },
      },
    },
    required: ['scenes'],
  },
}

export interface ProtocolProposal {
  proposed_change: string
  rationale: string
  expected_benefit: string
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

/**
 * The measured shot list the storyboard adapts. Durations are given explicitly
 * because the protocol requires the adaptation to preserve them.
 */
export function shotListBlock(shots: ShotContext[]): string {
  if (!shots.length) {
    return `PRODUCTION SHOT LIBRARY\nNo shot list has been attached to this storyboard yet. Tell the user you need one before you can adapt a sequence, and do not invent shots.`
  }
  const rows = shots.map((s) => {
    const dur = (s.end_seconds - s.start_seconds).toFixed(2)
    return [
      `Shot ${s.ordinal + 1} | ${s.timecode_start} – ${s.timecode_end} (${dur}s)`,
      `  Type: ${s.shot_type} | Angle: ${s.camera_angle} | Movement: ${s.camera_movement}`,
      `  Lens: ${s.lens} | DOF: ${s.dof} | Lighting: ${s.lighting}`,
      `  Subject: ${s.main_subject}`,
      `  Action: ${s.primary_action}`,
      s.foreground ? `  Foreground: ${s.foreground}` : '',
      `  Background: ${s.background}`,
      `  Composition: ${s.composition}`,
      `  Purpose: ${s.camera_purpose}`,
      s.continuity_notes ? `  Continuity: ${s.continuity_notes}` : '',
      s.technical_notes ? `  Technical: ${s.technical_notes}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  })
  return `PRODUCTION SHOT LIBRARY — the cinematographic source, measured from real footage\n${rows.join('\n\n')}`
}

export interface ShotContext {
  ordinal: number
  start_seconds: number
  end_seconds: number
  timecode_start: string
  timecode_end: string
  shot_type: string
  camera_angle: string
  camera_movement: string
  lens: string
  dof: string
  main_subject: string
  primary_action: string
  foreground: string
  background: string
  composition: string
  lighting: string
  camera_purpose: string
  continuity_notes: string
  technical_notes: string
}

function sceneStateBlock(scenes: unknown[]): string {
  if (!scenes.length) return 'CURRENT SCENES\nNone yet.'
  return `CURRENT SCENES (${scenes.length})\n${JSON.stringify(scenes, null, 1)}`
}

export function buildSystemPrompt(
  type: CardType,
  fields: CardFields,
  ancestors: Partial<Record<CardType, CardFields>>,
  config: AgentConfig,
  extra: { shots?: ShotContext[]; scenes?: unknown[]; locked?: boolean } = {},
): string {
  const parts = [config.role, `CORE KNOWLEDGE\n${config.knowledge}`, config.protocol]

  const anc = ancestorBlock(type, ancestors)
  if (anc) {
    parts.push(
      `INHERITED CONSTRAINTS\nThe following cards are already locked. Treat every property as fixed and immutable — your card must emerge naturally from them and may never contradict them.\n\n${anc}`,
    )
  }

  if (extra.locked) {
    parts.push(
      `CARD STATE — LOCKED
This card is locked, so its values are frozen and you have no tools to change them. Do not claim to have written anything. If the user asks for a change, tell them to unlock the card first using the Kilidi aç button. You may still discuss the card and produce a protocol improvement proposal.`,
    )
  }

  if (type === 'storyboard') {
    parts.push(shotListBlock(extra.shots ?? []))
    parts.push(
      `CURRENT BRIEF AND COMMON ATTRIBUTES\nUse the exact keys shown with set_fields.\n${fieldStateBlock(type, fields)}`,
    )
    parts.push(sceneStateBlock(extra.scenes ?? []))
  } else {
    parts.push(
      `CURRENT SHEET STATE\nThese are the fields you must resolve. Use the exact keys shown with set_fields.\n${fieldStateBlock(type, fields)}`,
    )
  }

  return parts.join('\n\n────────────────────\n\n')
}

/**
 * Runs one agent turn, resolving the tool loop until the model produces its
 * final text. Returns the chat text plus every field update it made.
 */
export async function runAgentTurn(params: {
  model: string
  type: CardType
  fields: CardFields
  ancestors: Partial<Record<CardType, CardFields>>
  history: ApiMessage[]
  userMessage: string
  /** Locked cards are frozen, but the agent may still reflect on the protocol. */
  locked?: boolean
  /** Storyboard only: the shot list it adapts, and the scenes written so far. */
  shots?: ShotContext[]
  scenes?: Scene[]
  signal?: AbortSignal
  /** Assistant prose as it streams in. */
  onText?: (delta: string) => void
  /** Coarse status for the UI: the model is writing fields, or answering. */
  onStatus?: (status: string) => void
}): Promise<AgentTurnResult> {
  const config = await loadAgentConfig(params.type)
  const system = buildSystemPrompt(params.type, params.fields, params.ancestors, config, {
    shots: params.shots,
    scenes: params.scenes,
    locked: params.locked,
  })
  const validKeys = new Set(allFields(schemas[params.type]).map((f) => f.key))
  const sceneCard = isSceneCard(params.type)

  const messages: ApiMessage[] = [
    ...params.history,
    { role: 'user', content: params.userMessage },
  ]
  const appended: ApiMessage[] = [{ role: 'user', content: params.userMessage }]

  const updates: FieldUpdate[] = []
  let scenes: Scene[] | null = null
  let proposal: ProtocolProposal | null = null
  let text = ''

  // The model may call set_fields several times before answering; cap the loop
  // so a misbehaving turn cannot spin.
  for (let i = 0; i < 6; i++) {
    params.onStatus?.(i === 0 ? 'Ajan düşünüyor' : 'Ajan devam ediyor')
    const res = await streamAnthropic({
      model: params.model,
      system,
      messages,
      // A locked card is frozen, so the writing tools are withdrawn entirely —
      // offering them let the agent attempt writes that the database rejected
      // while it was told they had succeeded. The proposal tool appears only
      // once locked, so mid-conversation is never mistaken for reflection time.
      tools: params.locked
        ? [proposeTool]
        : [setFieldsTool, ...(sceneCard ? [setScenesTool] : [])],
      signal: params.signal,
      onText: params.onText,
      onToolStart: () => params.onStatus?.('Alanlar yazılıyor'),
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
      if (tu.name === 'propose_protocol_improvement') {
        const p = tu.input as Partial<ProtocolProposal>
        if (p?.proposed_change) {
          proposal = {
            proposed_change: String(p.proposed_change),
            rationale: String(p.rationale ?? ''),
            expected_benefit: String(p.expected_benefit ?? ''),
          }
        }
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: proposal
            ? 'Öneri kaydedildi ve kullanıcının onayına sunuldu.'
            : 'Öneri boştu, kaydedilmedi.',
        })
        continue
      }

      if (tu.name === 'set_scenes') {
        const raw = (tu.input as { scenes?: unknown[] })?.scenes
        const parsed = Array.isArray(raw)
          ? raw
              .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
              .map((s) => {
                const out = {} as Scene
                for (const k of SCENE_FIELDS) {
                  const v = s[k]
                  out[k] = typeof v === 'string' ? v : ''
                }
                return out
              })
              // A scene with no visual prompt cannot be rendered, so it is not a scene.
              .filter((s) => s.visual_prompt.trim())
          : []
        if (parsed.length) scenes = parsed
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: parsed.length
            ? `Wrote ${parsed.length} scene(s).`
            : 'No usable scenes received — every scene needs a visual_prompt.',
        })
        continue
      }

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

  return { text: text.trim(), updates, scenes, proposal, history: appended }
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
