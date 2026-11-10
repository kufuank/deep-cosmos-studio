import { streamAnthropic, EMPTY_USAGE, addUsage } from '../lib/anthropic'
import type { ApiMessage, ContentBlock, ToolDef, SystemBlock, Effort, Usage } from '../lib/anthropic'
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
  /** The sequence chosen this turn, when select_sequence was called. */
  sequence: SequenceSelection | null
  /** Present when the agent produced a protocol improvement proposal. */
  proposal: ProtocolProposal | null
  /** Raw blocks appended to history so the next turn keeps tool context. */
  history: ApiMessage[]
  /** Summed over every request the turn made. */
  usage: Usage
  /** How many upstream requests the turn took. */
  requests: number
}

export const setFieldsTool: ToolDef = {
  name: 'set_fields',
  description:
    'Write one or more resolved fields onto the identity sheet. Use this for every value you establish — never write field values into your chat text. Batch related updates together, but keep each call to at most 15 fields: when resolving a large sheet, make several set_fields calls in sequence rather than one huge call, so no single call is cut off by the output token limit.',
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

/** One shot list of the library, as the index needs it. */
export interface LibraryList {
  id: string
  title: string
  duration_seconds: number | null
}

/** The sequence the storyboard adapts: a list plus an inclusive ordinal range. */
export interface SequenceSelection {
  shot_list_id: string
  /** 0-based ordinals, inclusive. */
  start: number
  end: number
  rationale?: string
}

export interface ShotContext {
  shot_list_id: string
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

function fmtDur(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return '?'
  const m = Math.floor(sec / 60)
  const r = sec - m * 60
  return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`
}

/**
 * The whole Shot Library as a compact index — every list, every shot, one
 * line each. The protocol treats the library as a collection of sequences to
 * search, so the agent must see all of it, not one user-picked list. Full
 * detail of the chosen shots is handed over by select_sequence instead, which
 * keeps this block small enough to cache.
 */
export function libraryBlock(lists: LibraryList[], shots: ShotContext[]): string {
  if (!lists.length || !shots.length) {
    return `PRODUCTION SHOT LIBRARY — INDEX\nThe library is empty. Tell the user a shot list must be analysed in the Shot Library first, and do not invent shots.`
  }
  const byList = new Map<string, ShotContext[]>()
  for (const s of shots) {
    const arr = byList.get(s.shot_list_id) ?? []
    arr.push(s)
    byList.set(s.shot_list_id, arr)
  }
  const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
  const sections = lists
    .filter((l) => byList.has(l.id))
    .map((l) => {
      const rows = (byList.get(l.id) ?? []).sort((a, b) => a.ordinal - b.ordinal)
      const total = rows.length ? rows[rows.length - 1].end_seconds : (l.duration_seconds ?? 0)
      const lines = rows.map(
        (s) =>
          `  ${String(s.ordinal + 1).padStart(3, ' ')} | ${s.timecode_start}–${s.timecode_end} (${(s.end_seconds - s.start_seconds).toFixed(2)}s) | ${s.shot_type} | ${s.camera_angle} | ${clip(s.camera_movement, 40)} | ${clip(s.main_subject, 50)} — ${clip(s.primary_action, 90)}`,
      )
      return `LIST "${l.title}" — shot_list_id: ${l.id} — ${rows.length} shots, ${fmtDur(total)} total\n${lines.join('\n')}`
    })
  return `PRODUCTION SHOT LIBRARY — INDEX (${sections.length} lists, ${shots.length} shots), measured from real footage
Each line: shot number | timecode (duration) | shot type | camera angle | camera movement | subject — action.
The library is a collection of documentary sequences. A sequence is any continuous run of shots inside ONE list. Candidate sequences exist anywhere in a list — the opening shots of a list are not privileged over its middle or end. Scan every list end to end, find the continuous run whose biological event, environment and documentary purpose best match the objective and whose total duration is closest to the target, then call select_sequence. That call returns the full cinematographic detail of the chosen shots.

${sections.join('\n\n')}`
}

/** Full detail of the chosen shots, in the format the adaptation works from. */
export function selectedSequenceBlock(
  sel: SequenceSelection | null | undefined,
  lists: LibraryList[],
  shots: ShotContext[],
): string {
  if (!sel) {
    return `SELECTED SEQUENCE\nNone yet. Writing scenes is not possible until a sequence has been selected with select_sequence.`
  }
  const rows = shots
    .filter((s) => s.shot_list_id === sel.shot_list_id && s.ordinal >= sel.start && s.ordinal <= sel.end)
    .sort((a, b) => a.ordinal - b.ordinal)
  const title = lists.find((l) => l.id === sel.shot_list_id)?.title ?? sel.shot_list_id
  if (!rows.length) {
    return `SELECTED SEQUENCE\nThe stored selection (list "${title}", shots ${sel.start + 1}–${sel.end + 1}) no longer matches the library. Select again with select_sequence.`
  }
  const total = rows[rows.length - 1].end_seconds - rows[0].start_seconds
  return `SELECTED SEQUENCE — list "${title}", shots ${rows[0].ordinal + 1}–${rows[rows.length - 1].ordinal + 1} (${rows[0].timecode_start} – ${rows[rows.length - 1].timecode_end}, ${total.toFixed(2)}s, ${rows.length} shots)${sel.rationale ? `\nWhy: ${sel.rationale}` : ''}
One source shot becomes exactly one scene, in this order, with these durations.

${shotListBlock(rows)}`
}

export const selectSequenceTool: ToolDef = {
  name: 'select_sequence',
  description:
    'Choose the continuous documentary sequence the storyboard will adapt: one shot list from the index and an inclusive range of shot numbers inside it. Call this BEFORE set_scenes, after scanning every list in the index end to end. The result returns the full detail of the chosen shots. Call again to change the selection.',
  input_schema: {
    type: 'object',
    properties: {
      shot_list_id: { type: 'string', description: 'The shot_list_id of the list, copied from the index.' },
      first_shot: { type: 'integer', description: 'First shot number of the sequence (1-based, as printed in the index).' },
      last_shot: { type: 'integer', description: 'Last shot number of the sequence, inclusive.' },
      rationale: {
        type: 'string',
        description:
          'In Turkish: which other candidates were considered, and why this run best matches the documentary objective, species behaviour, location and target duration.',
      },
    },
    required: ['shot_list_id', 'first_shot', 'last_shot', 'rationale'],
  },
}

function sceneStateBlock(scenes: unknown[]): string {
  if (!scenes.length) return 'CURRENT SCENES\nNone yet.'
  // Compact JSON: the pretty-printed form was ~40% more tokens for no gain.
  return `CURRENT SCENES (${scenes.length})\n${JSON.stringify(scenes)}`
}

const SEP = '\n\n────────────────────\n\n'

/**
 * Rules about the turn itself rather than the domain. They live in code, not in
 * the database protocol, so they hold for every agent whatever protocol
 * version is served. Free-tier models announced actions ("şimdi çağırıyorum")
 * and ended the turn, declared a sheet complete with fields still empty, and
 * skipped announced questions without a word.
 */
export const TURN_DISCIPLINE = `TURN DISCIPLINE — HONEST NARRATION
Your turn ends the moment you stop writing. There is no later step in which you get to finish what you announced.
- Never announce an action you do not perform in this same response. If you write that you will fill fields, ask questions or call a tool, do it right away in this response; otherwise do not announce it.
- If you change course mid-response — for example you said you would ask questions, then saw the answers already follow from what is confirmed — say so in one sentence, with the reason, before acting (e.g. "Soru sormaya gerek kalmadığını fark ettim, çünkü …; alanları dolduruyorum.").
- Report only what tool results confirm. Never say something was saved, processed, called or written unless you called the tool in this response and its result said so.
- Never call the sheet complete while the sheet state shown to you or the latest set_fields result still lists missing fields. Name the fields that are still missing instead.
- If you cannot finish everything in this response, say plainly what is done and what remains.`

/** Keys of the sheet fields that still have no value. */
export function missingFieldKeys(type: CardType, fields: CardFields): string[] {
  return allFields(schemas[type])
    .filter((f) => !fields[f.key]?.value?.trim())
    .map((f) => f.key)
}

// Turkish first-person future / progressive / optative forms of the verbs an
// agent uses to announce work ("dolduracağım", "çağırıyorum", "düzelteyim").
const ACTION_VERB =
  /(?:çağır|doldur|yaz|güncelle|kaydet|oluştur|sor|seç|başla|devam ed|üret|tamamla|düzelt|ekle|analiz ed|belirl|ilerl|geç)\p{L}*?(?:acağım|eceğim|acağız|eceğiz|ıyorum|iyorum|uyorum|üyorum|ıyoruz|iyoruz|uyoruz|üyoruz|ayım|eyim|alım|elim)(?!\p{L})/iu
const ACTION_EN = /\b(?:I(?:'ll| will| am going to)|let me|now (?:calling|writing|filling|asking))\b/i

/**
 * Whether a reply ends by promising work it did not do.
 *
 * Judged on the closing sentences only: an announcement mid-reply that was
 * followed by its result is fine, one that is the last thing said is not. A
 * reply that ends on a question is waiting for the user, not stalling.
 */
export function announcesAction(text: string): boolean {
  const t = text.trim()
  if (!t || t.endsWith('?')) return false
  if (/:\s*$/.test(t)) return true // "…şu çağrı ile belirliyorum:" and then nothing
  const sentences = t.split(/(?<=[.!…])\s+|\n+/).filter((s) => s.trim())
  const tail = sentences.slice(-2).join(' ')
  return ACTION_VERB.test(tail) || ACTION_EN.test(tail)
}

/** Whether a reply tells the user the sheet is done. */
export function claimsComplete(text: string): boolean {
  return /(?:kart|card|sheet)\p{L}*\s+(?:\p{L}+\s+)?(?:tamam|doldurul|complete)|(?:tüm|bütün|all)\s+(?:\d+\s+)?(?:alan|field)\p{L}*\s+(?:\p{L}+\s+)?(?:doldurul|tamamlan|filled|complete)/iu.test(
    text,
  )
}

/** Sent once when a reply announced an action and then ended without it. */
const FOLLOW_THROUGH_NUDGE =
  'Your reply ended by announcing an action, but you called no tool, and nothing was done. ' +
  'If you intend to do it, do it now by calling the tool. If you decided not to, tell the user in Turkish, in one or two sentences, what you decided and why. ' +
  'If nothing is actually pending, reply with exactly: DONE'

export const MAX_STEPS = 8

/** Why a turn stopped, when it stopped short of finishing. */
export type TurnCutoff = 'truncated' | 'truncated_empty' | 'step_limit' | 'stalled'

/** The note shown to the user when a turn stopped short — the cause, said plainly. */
export function cutoffNotice(cut: TurnCutoff): string {
  switch (cut) {
    case 'truncated_empty':
      return '(Cevap çok uzun olduğu için model çıktı sınırına takıldı ve hiçbir şey yazamadan durdu; bu turda hiçbir işlem yapılmadı. "devam et" yazarsanız daha küçük parçalarla sürdürmesi istenir.)'
    case 'truncated':
      return '(Cevap çok uzun olduğu için model çıktı sınırına takıldı ve burada kesildi; söylediklerinin devamı ve yapacağını söylediği işlemler gerçekleşmedi. Kaldığı yerden sürdürmesi için "devam et" yazın.)'
    case 'step_limit':
      return `(Ajan bu tur için izin verilen ${MAX_STEPS} adımın hepsini kullandı ve işi bitiremeden durdu. Kaldığı yerden sürdürmesi için "devam et" yazın.)`
    case 'stalled':
      return '(Ajan yapacağını söylediği adımı gerçekleştirmeden turu bitirdi; o işlem bu turda yapılmadı. Tekrar istemek için "devam et" yazın.)'
  }
}

/** Appended when the agent called the sheet complete while fields are still empty. */
export function incompleteNotice(type: CardType, missing: string[]): string {
  const labels = new Map(allFields(schemas[type]).map((f) => [f.key, f.label]))
  const names = missing.map((k) => labels.get(k) ?? k)
  const shown = names.length > 8 ? `${names.slice(0, 8).join(', ')} ve ${names.length - 8} alan daha` : names.join(', ')
  return `(Not: Ajan kartın tamamlandığını söyledi, ancak ${missing.length} alan hâlâ boş: ${shown}.)`
}

/**
 * The system prompt in two halves, so the stable half can be prompt-cached.
 *
 * Role, knowledge, protocol, inherited constraints and the shot list do not
 * change while a card is being worked on — that is 2k–7k tokens re-sent on
 * every request. Only the sheet state (and scenes) changes as fields are
 * written, so it goes last, after the cache breakpoint.
 */
export function buildSystemBlocks(
  type: CardType,
  fields: CardFields,
  ancestors: Partial<Record<CardType, CardFields>>,
  config: AgentConfig,
  extra: {
    shots?: ShotContext[]
    lists?: LibraryList[]
    selection?: SequenceSelection | null
    scenes?: unknown[]
    locked?: boolean
  } = {},
): SystemBlock[] {
  const stable = [config.role, `CORE KNOWLEDGE\n${config.knowledge}`, config.protocol, TURN_DISCIPLINE]

  const anc = ancestorBlock(type, ancestors)
  if (anc) {
    stable.push(
      `INHERITED CONSTRAINTS\nThe following cards are already locked. Treat every property as fixed and immutable — your card must emerge naturally from them and may never contradict them.\n\n${anc}`,
    )
  }
  // The index is stable across turns (cached); the chosen sequence changes
  // when the agent re-selects, so it lives in the dynamic half.
  if (type === 'storyboard') stable.push(libraryBlock(extra.lists ?? [], extra.shots ?? []))

  const dynamic: string[] = []
  if (extra.locked) {
    dynamic.push(
      `CARD STATE — LOCKED
This card is locked, so its values are frozen and you have no tools to change them. Do not claim to have written anything. If the user asks for a change, tell them to unlock the card first using the Kilidi aç button. You may still discuss the card and produce a protocol improvement proposal.`,
    )
  } else {
    // The proposal tool is offered only once locked. An agent told by its
    // protocol to propose "once approved" was asked to approve in chat, had no
    // tool to call, and announced the proposal as processed anyway.
    dynamic.push(
      `CARD STATE — UNLOCKED
The propose_protocol_improvement tool is not available while the card is unlocked; it appears only after the user presses the Kartı kilitle button. If the user approves the card in chat, do not say a proposal was made, sent or processed. Tell them to lock the card with the Kartı kilitle button and then send any message; you will write the proposal in that turn.`,
    )
  }
  if (type === 'storyboard') {
    dynamic.push(selectedSequenceBlock(extra.selection, extra.lists ?? [], extra.shots ?? []))
    dynamic.push(
      `CURRENT BRIEF AND COMMON ATTRIBUTES\nUse the exact keys shown with set_fields.\n${fieldStateBlock(type, fields)}`,
    )
    dynamic.push(sceneStateBlock(extra.scenes ?? []))
  } else {
    dynamic.push(
      `CURRENT SHEET STATE\nThese are the fields you must resolve. Use the exact keys shown with set_fields.\n${fieldStateBlock(type, fields)}`,
    )
  }

  return [
    { text: stable.join(SEP), cache: true },
    { text: SEP.trim() + '\n\n' + dynamic.join(SEP) },
  ]
}

/** The same prompt as one string — what the model reads, joined in order. */
export function buildSystemPrompt(
  type: CardType,
  fields: CardFields,
  ancestors: Partial<Record<CardType, CardFields>>,
  config: AgentConfig,
  extra: {
    shots?: ShotContext[]
    lists?: LibraryList[]
    selection?: SequenceSelection | null
    scenes?: unknown[]
    locked?: boolean
  } = {},
): string {
  return buildSystemBlocks(type, fields, ancestors, config, extra)
    .map((b) => b.text)
    .join('\n\n')
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
  /** Storyboard only: the whole library, the current selection, the scenes so far. */
  shots?: ShotContext[]
  lists?: LibraryList[]
  selection?: SequenceSelection | null
  scenes?: Scene[]
  /** Thinking depth — the main cost dial. Defaults to medium. */
  effort?: Effort
  signal?: AbortSignal
  /** Assistant prose as it streams in. */
  onText?: (delta: string) => void
  /** Coarse status for the UI: the model is writing fields, or answering. */
  onStatus?: (status: string) => void
}): Promise<AgentTurnResult> {
  const config = await loadAgentConfig(params.type)
  const system = buildSystemBlocks(params.type, params.fields, params.ancestors, config, {
    shots: params.shots,
    lists: params.lists,
    selection: params.selection,
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
  let sequence: SequenceSelection | null = null
  let selection: SequenceSelection | null = params.selection ?? null
  let proposal: ProtocolProposal | null = null
  let text = ''
  let usage: Usage = { ...EMPTY_USAGE }
  let requests = 0
  // Stays 'step_limit' unless the loop ends on its own; every early exit sets it.
  let cutoff: TurnCutoff | null = 'step_limit'
  let nudged = false

  // The model may call set_fields several times before answering; cap the loop
  // so a misbehaving turn cannot spin.
  for (let i = 0; i < MAX_STEPS; i++) {
    params.onStatus?.(i === 0 ? 'Ajan düşünüyor' : 'Ajan devam ediyor')
    requests++
    const res = await streamAnthropic({
      model: params.model,
      system,
      messages,
      effort: params.effort ?? 'medium',
      // The second and later requests of a turn re-read the conversation from
      // cache instead of paying for the whole prefix again.
      cacheMessages: true,
      // A locked card is frozen, so the writing tools are withdrawn entirely —
      // offering them let the agent attempt writes that the database rejected
      // while it was told they had succeeded. The proposal tool appears only
      // once locked, so mid-conversation is never mistaken for reflection time.
      tools: params.locked
        ? [proposeTool]
        : [setFieldsTool, ...(sceneCard ? [selectSequenceTool, setScenesTool] : [])],
      signal: params.signal,
      onText: params.onText,
      onToolStart: () => params.onStatus?.('Alanlar yazılıyor'),
      // The model thinks by default and nothing visible streams while it does.
      // Without this status the UI reads as a hang for a minute or more.
      onThinking: () => params.onStatus?.('Ajan derin düşünüyor — bu bir dakikayı bulabilir'),
      onRetry: (n, ms) =>
        params.onStatus?.(
          `Anthropic aşırı yüklü — ${Math.round(ms / 1000)} sn sonra yeniden deneniyor (${n}/3)`,
        ),
    })

    usage = addUsage(usage, res.usage)
    // The API rejects an echoed assistant turn that carries an empty text
    // block or no content at all ("text content blocks must be non-empty").
    // A turn cut off right after a text block opened can produce exactly that.
    const echo = res.content.filter((b) => !(b.type === 'text' && !b.text.trim()))
    const assistantMsg: ApiMessage = { role: 'assistant', content: echo }
    if (echo.length) {
      messages.push(assistantMsg)
      appended.push(assistantMsg)
    }

    const stepText = res.content
      .flatMap((b) => (b.type === 'text' && b.text.trim() ? [b.text] : []))
      .join('\n\n')
    // The answer to the follow-through nudge when nothing was pending.
    const nothingPending = nudged && /^\s*DONE\.?\s*$/i.test(stepText)
    if (stepText && !nothingPending) text += (text ? '\n\n' : '') + stepText

    // max_tokens caps thinking + output combined. A hard request can burn the
    // whole budget on thinking and end with no text and no tool call at all —
    // that turn once surfaced as "the agent wrote nothing" with no explanation.
    const truncated = res.stopReason === 'max_tokens'

    const toolUses = res.content.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    )
    if (!toolUses.length) {
      if (truncated) {
        cutoff = text ? 'truncated' : 'truncated_empty'
        break
      }
      // The model ended its turn on a promise ("şimdi çağırıyorum") without
      // the tool call. Ask once for the follow-through; the nudge is not
      // shown in the chat, only the result.
      if (!nothingPending && announcesAction(stepText)) {
        if (!nudged && i < MAX_STEPS - 1) {
          nudged = true
          params.onStatus?.('Ajan duyurduğu adımı atmadan durdu — sürdürmesi isteniyor')
          messages.push({ role: 'user', content: FOLLOW_THROUGH_NUDGE })
          continue
        }
        cutoff = 'stalled'
        break
      }
      // Nudged, and the answer was silence: the announced step still did not happen.
      cutoff = nudged && !stepText ? 'stalled' : null
      break
    }

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

      if (tu.name === 'select_sequence') {
        const inp = tu.input as {
          shot_list_id?: string
          first_shot?: number
          last_shot?: number
          rationale?: string
        }
        const lists = params.lists ?? []
        const shots = params.shots ?? []
        const list = lists.find((l) => l.id === inp?.shot_list_id)
        const inList = shots.filter((s) => s.shot_list_id === inp?.shot_list_id)
        const first = Number(inp?.first_shot)
        const last = Number(inp?.last_shot)
        const maxNo = inList.reduce((m, s) => Math.max(m, s.ordinal + 1), 0)
        if (!list || !inList.length) {
          results.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: `Unknown shot_list_id "${inp?.shot_list_id ?? ''}". Copy the id exactly from the index.`,
          })
          continue
        }
        if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > maxNo) {
          results.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: `Invalid range ${first}–${last}: list "${list.title}" has shots 1–${maxNo}, and last_shot must be ≥ first_shot.`,
          })
          continue
        }
        selection = {
          shot_list_id: list.id,
          start: first - 1,
          end: last - 1,
          rationale: typeof inp?.rationale === 'string' ? inp.rationale : undefined,
        }
        sequence = selection
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: `Sequence selected and saved. ${selectedSequenceBlock(selection, lists, shots)}`,
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
        // One source shot → one scene is the protocol's hardest rule; a count
        // mismatch is the clearest sign the agent drifted from the selection.
        const sel = selection
        const expected = sel
          ? (params.shots ?? []).filter(
              (s) => s.shot_list_id === sel.shot_list_id && s.ordinal >= sel.start && s.ordinal <= sel.end,
            ).length
          : 0
        const mismatch =
          parsed.length && expected && parsed.length !== expected
            ? ` WARNING: the selected sequence has ${expected} shots but you wrote ${parsed.length} scenes. One source shot must become exactly one scene, in order, with its measured duration — unless the user explicitly asked otherwise, fix this.`
            : ''
        const noSel =
          parsed.length && !sel
            ? ' WARNING: no sequence has been selected with select_sequence. Select one from the library index first; scenes must adapt a real, measured sequence.'
            : ''
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: parsed.length
            ? `Wrote ${parsed.length} scene(s).${mismatch}${noSel}`
            : truncated
              ? 'This call was cut off by the output token limit before its input arrived — nothing was written. Re-send the scene list with tighter visual_prompt wording so the full call fits.'
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
        : accepted.length === 0 && truncated
          ? 'This call was cut off by the output token limit before its input arrived — nothing was written. Re-send the fields in smaller batches of at most 10 per call.'
          : `Wrote ${accepted.length} field(s).`
      // The sheet state in the system prompt is from the start of the turn, so
      // without this the agent cannot tell which fields are still empty — and
      // declared sheets complete with whole sections missing.
      const missing = sceneCard ? [] : missingFieldKeys(params.type, applyUpdates(params.fields, updates))
      const remaining = sceneCard
        ? ''
        : missing.length
          ? ` Still missing (${missing.length}): ${missing.join(', ')}. The sheet is not complete.`
          : ' No field is missing now.'
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: summary + remaining })
    }

    const resultMsg: ApiMessage = { role: 'user', content: results }
    messages.push(resultMsg)
    appended.push(resultMsg)
  }

  // Say why the turn stopped short, in the chat, instead of leaving an
  // announcement hanging or a generic "try again".
  const notes: string[] = []
  if (cutoff) notes.push(cutoffNotice(cutoff))
  if (!sceneCard && !params.locked && claimsComplete(text)) {
    const missing = missingFieldKeys(params.type, applyUpdates(params.fields, updates))
    if (missing.length) notes.push(incompleteNotice(params.type, missing))
  }
  if (notes.length) text = [text.trim(), ...notes].filter(Boolean).join('\n\n')

  return { text: text.trim(), updates, scenes, sequence, proposal, history: appended, usage, requests }
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
