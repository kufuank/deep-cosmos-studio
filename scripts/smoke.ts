/**
 * Logic smoke test: schema integrity, prompt assembly and inheritance.
 * Run with: npm run smoke
 */
import { schemas, cardOrder, allFields, isSceneCard, SCENE_FIELDS } from '../src/schemas'
import type { CardFields, CardType, Scene } from '../src/schemas'
import { buildPrompts, sceneVideoPrompt } from '../src/lib/prompt'
import {
  buildSystemPrompt,
  buildSystemBlocks,
  applyUpdates,
  setFieldsTool,
  libraryBlock,
  selectedSequenceBlock,
  selectSequenceTool,
} from '../src/agents/runner'
import type { ShotContext, LibraryList } from '../src/agents/runner'
import { buildRequestBody, isTransient, AnthropicError, MODELS, supportsVision } from '../src/lib/anthropic'
import { DEFAULT_MODEL } from '../src/lib/settings'
import { agentInstructions, protocolText } from '../src/agents/instructions'
import type { AgentConfig } from '../src/agents/config'
import {
  formatTimecode,
  dataUrlParts,
  findCutIndices,
  framesForSpan,
  lumaHistogram,
  histogramDistance,
  pixelDelta,
} from '../src/lib/video'
import { recordShotTool } from '../src/agents/deconstruct'
import { createStreamAccumulator } from '../src/lib/anthropic'
import { describeError, isAbort } from '../src/lib/errors'
import {
  providerFor,
  toOpenAIMessages,
  toOpenAIRequest,
  createOpenAIToAnthropic,
  toAnthropicError,
  ALLOWED_MODELS,
} from '../supabase/functions/anthropic/bridge'

/** Stands in for the database-backed config, using the transcribed constants. */
function cfg(type: CardType): AgentConfig {
  return {
    agent: type,
    version: 0,
    role: agentInstructions[type].role,
    knowledge: agentInstructions[type].knowledge,
    protocol: protocolText(type),
    fallback: true,
  }
}

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n== schema integrity ==')
for (const t of cardOrder) {
  const s = schemas[t]
  const keys = allFields(s).map((f) => f.key)
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
  check(`${t}: no duplicate keys`, dupes.length === 0, dupes.join(','))
  check(`${t}: has fields`, keys.length > 0)

  const missingInherited = s.inheritedKeys.filter((k) => !keys.includes(k))
  check(`${t}: inheritedKeys all exist`, missingInherited.length === 0, missingInherited.join(','))
  console.log(`       ${keys.length} fields, ${s.sections.length} sections`)
}

console.log('\n== parent chain ==')
check('planet is root', schemas.planet.parent === null)
for (const t of cardOrder.slice(1)) {
  const expected = cardOrder[cardOrder.indexOf(t) - 1]
  check(`${t} parent is ${expected}`, schemas[t].parent === expected)
}

console.log('\n== prompt assembly ==')
function fill(t: CardType, n: number): CardFields {
  const out: CardFields = {}
  for (const f of allFields(schemas[t]).slice(0, n)) {
    out[f.key] = { value: `TEST_${f.key.toUpperCase()}`, state: 'confirmed' }
  }
  return out
}

const planetFields = fill('planet', 60)
const ecoFields = fill('ecosystem', 60)
const speciesFields = fill('species', 60)

const prompts = buildPrompts({
  type: 'species',
  fields: speciesFields,
  ancestors: { planet: planetFields, ecosystem: ecoFields },
})

check('three prompts produced', prompts.length === 3, `got ${prompts.length}`)
check('kinds are sheet/still/video', prompts.map((p) => p.kind).join(',') === 'sheet,still,video')

for (const p of prompts) {
  check(`${p.kind}: non-trivial length`, p.text.length > 400, `${p.text.length} chars`)
  check(`${p.kind}: no unresolved [placeholder]`, !/\[[A-Z][^\]]*\]/.test(p.text))
  check(`${p.kind}: carries planet constraint`, p.text.includes('TEST_PLANET_NAME'))
  check(`${p.kind}: carries own subject`, p.text.includes('TEST_SPECIES_NAME'))
}

const video = prompts.find((p) => p.kind === 'video')!
check('video forbids narration', video.text.includes('No narration'))
check('video forbids music', video.text.includes('No music'))
check('video forbids Earth reference', video.text.includes('No references to Earth'))

const still = prompts.find((p) => p.kind === 'still')!
check('still has negative block', still.text.includes('NEGATIVE'))

console.log('\n== missing-field reporting ==')
const sparse = buildPrompts({ type: 'planet', fields: fill('planet', 3), ancestors: {} })
const total = allFields(schemas.planet).length
check('reports missing count', sparse[0].missing.length === total - 3, `${sparse[0].missing.length} vs ${total - 3}`)

console.log('\n== system prompt ==')
const sys = buildSystemPrompt(
  'species',
  speciesFields,
  { planet: planetFields, ecosystem: ecoFields },
  cfg('species'),
)
check('names the agent role', sys.includes('Species Agent'))
check('includes protocol', sys.includes('PROTOCOL'))
check('marks ancestors immutable', sys.includes('FIXED AND IMMUTABLE'))
check('lists current sheet state', sys.includes('CURRENT SHEET STATE'))
check('instructs Turkish conversation', sys.includes('Turkish'))

// A partially filled sheet must show both resolved values and MISSING markers.
const partial = buildSystemPrompt(
  'species',
  fill('species', 5),
  { planet: planetFields },
  cfg('species'),
)
const speciesTotal = allFields(schemas.species).length
check(
  'flags exactly the unfilled fields',
  (partial.match(/— MISSING —/g) ?? []).length === speciesTotal - 5,
)
check('shows resolved values with state', partial.includes('(confirmed) = TEST_SPECIES_NAME'))

const emptySys = buildSystemPrompt('planet', {}, {}, cfg('planet'))
check('root card has no inherited block', !emptySys.includes('INHERITED CONSTRAINTS'))
check('root card lists all fields missing', (emptySys.match(/— MISSING —/g) ?? []).length === total)

console.log('\n== prompt caching ==')
{
  // The stable half (role, knowledge, protocol, inherited constraints) must be
  // byte-identical across turns while fields change, or the cache never hits.
  const a = buildSystemBlocks('species', fill('species', 5), { planet: planetFields }, cfg('species'))
  const b = buildSystemBlocks('species', fill('species', 30), { planet: planetFields }, cfg('species'))
  check('two blocks: stable + dynamic', a.length === 2 && b.length === 2)
  check('stable block is cached', a[0].cache === true && !a[1].cache)
  check('stable block unchanged when fields change', a[0].text === b[0].text)
  check('dynamic block carries the sheet state', b[1].text.includes('CURRENT SHEET STATE'))
  check('sheet state is not in the cached half', !a[0].text.includes('CURRENT SHEET STATE'))
  check(
    'stable half is large enough to cache (>=1024 tokens ≈ 4k chars)',
    a[0].text.length > 4000,
    String(a[0].text.length),
  )
  // Locking must not perturb the cached prefix either.
  const l = buildSystemBlocks('species', fill('species', 5), { planet: planetFields }, cfg('species'), { locked: true })
  check('lock notice lives in the dynamic half', l[0].text === a[0].text && l[1].text.includes('LOCKED'))

  const body = buildRequestBody(
    {
      model: 'claude-sonnet-5',
      system: a,
      messages: [
        { role: 'user', content: 'merhaba' },
        { role: 'assistant', content: [{ type: 'text', text: 'selam' }] },
        { role: 'user', content: 'devam' },
      ],
      effort: 'medium',
      cacheMessages: true,
    },
    true,
  ) as any
  check('system sent as blocks', Array.isArray(body.system) && body.system.length === 2)
  check('cache_control on stable system block', body.system[0].cache_control?.type === 'ephemeral')
  check('no cache_control on dynamic block', !body.system[1].cache_control)
  const lastMsg = body.messages[2]
  check(
    'last message converted to blocks with breakpoint',
    Array.isArray(lastMsg.content) && lastMsg.content[0].cache_control?.type === 'ephemeral',
  )
  check('earlier messages untouched', body.messages[0].content === 'merhaba')
  check('effort forwarded in output_config', body.output_config?.effort === 'medium')
  check('stream flag set', body.stream === true)
  check('max_tokens default 24000', body.max_tokens === 24000)
  const plain = buildRequestBody({ model: 'm', system: 'x', messages: [{ role: 'user', content: 'y' }] }, false) as any
  check('string system passes through', plain.system === 'x')
  check('no effort → no output_config', !('output_config' in plain))
}

console.log('\n== applyUpdates ==')
const applied = applyUpdates(
  {},
  [
    { key: 'planet_name', value: 'Kepler-X', state: 'confirmed' },
    { key: 'mass', value: '1.4 M⊕', state: 'inferred', reasoning: 'yoğunluktan türetildi' },
  ],
)
check('writes confirmed value', applied.planet_name?.value === 'Kepler-X')
check('preserves state', applied.mass?.state === 'inferred')
check('preserves reasoning', applied.mass?.reasoning === 'yoğunluktan türetildi')

console.log('\n== timecode ==')
check('zero', formatTimecode(0) === '00:00:00.000', formatTimecode(0))
check('sub-second', formatTimecode(3.25) === '00:00:03.250', formatTimecode(3.25))
check('minutes', formatTimecode(75.5) === '00:01:15.500', formatTimecode(75.5))
check('hours', formatTimecode(3661.001) === '01:01:01.001', formatTimecode(3661.001))
check('negative clamps to zero', formatTimecode(-5) === '00:00:00.000', formatTimecode(-5))
check(
  'monotonic across a boundary',
  formatTimecode(59.999) < formatTimecode(60.0),
  `${formatTimecode(59.999)} vs ${formatTimecode(60.0)}`,
)

console.log('\n== data url parsing ==')
const parsed = dataUrlParts('data:image/jpeg;base64,AAECAw==')
check('media type', parsed.mediaType === 'image/jpeg', parsed.mediaType)
check('payload', parsed.base64 === 'AAECAw==', parsed.base64)
let threw = false
try {
  dataUrlParts('https://example.com/not-a-data-url.jpg')
} catch {
  threw = true
}
check('rejects non data URL', threw)

console.log('\n== shot list contract ==')
// Every column the agent fills must exist on the table, or rows silently lose data.
const DB_SHOT_COLUMNS = [
  'shot_type',
  'camera_angle',
  'camera_movement',
  'lens',
  'dof',
  'main_subject',
  'primary_action',
  'foreground',
  'background',
  'composition',
  'lighting',
  'camera_purpose',
  'continuity_notes',
  'technical_notes',
  'audio_notes',
]
const schemaProps = Object.keys(
  (recordShotTool.input_schema as { properties: Record<string, unknown> }).properties,
)
const required = (recordShotTool.input_schema as { required: string[] }).required
check('15 analysis fields', schemaProps.length === 15, String(schemaProps.length))
check(
  'tool fields match table columns',
  DB_SHOT_COLUMNS.every((c) => schemaProps.includes(c)) &&
    schemaProps.every((c) => DB_SHOT_COLUMNS.includes(c)),
  schemaProps.filter((c) => !DB_SHOT_COLUMNS.includes(c)).join(',') || 'ok',
)
check('all fields required', required.length === schemaProps.length)
check(
  'audio field states it cannot be determined',
  JSON.stringify(recordShotTool.input_schema).includes('Cannot be determined'),
)

console.log('\n== stream accumulator ==')
{
  // A realistic turn: prose, then a batched set_fields tool call.
  const events = [
    { type: 'message_start', message: { id: 'm1' } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Merhaba, ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'gezegeni kuruyorum.' } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'tu_1', name: 'set_fields' },
    },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"updates":[{"key":"planet_' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'name","value":"Vesper","state":"confirmed"}]}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' },
  ]
  const wire = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')

  // Feed it in awkward slices so event boundaries land mid-chunk.
  const text: string[] = []
  const tools: string[] = []
  const acc = createStreamAccumulator({
    onText: (d) => text.push(d),
    onToolStart: (n) => tools.push(n),
  })
  for (let i = 0; i < wire.length; i += 7) acc.push(wire.slice(i, i + 7))
  const result = acc.finish()

  check('text streamed in order', text.join('') === 'Merhaba, gezegeni kuruyorum.', text.join(''))
  check('tool start reported', tools.join(',') === 'set_fields', tools.join(','))
  check('two blocks rebuilt', result.content.length === 2, String(result.content.length))
  const textBlock = result.content.find((b) => b.type === 'text')
  check(
    'text block complete',
    textBlock?.type === 'text' && textBlock.text === 'Merhaba, gezegeni kuruyorum.',
  )
  const toolBlock = result.content.find((b) => b.type === 'tool_use')
  const input = toolBlock?.type === 'tool_use' ? (toolBlock.input as any) : null
  check('fragmented tool JSON reassembled', input?.updates?.[0]?.key === 'planet_name', JSON.stringify(input))
  check('tool value survived the split', input?.updates?.[0]?.value === 'Vesper')
  check('stop reason captured', result.stopReason === 'end_turn', String(result.stopReason))
}

{
  // A truncated tool call must not be applied half-written.
  const acc = createStreamAccumulator()
  acc.push(
    'data: ' +
      JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 't', name: 'set_fields' },
      }) +
      '\n\n',
  )
  acc.push(
    'data: ' +
      JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"updates":[{"key":"mass"' },
      }) +
      '\n\n',
  )
  acc.push('data: ' + JSON.stringify({ type: 'content_block_stop', index: 0 }) + '\n\n')
  const r = acc.finish()
  const b = r.content[0]
  check(
    'truncated tool input becomes empty, not partial',
    b?.type === 'tool_use' && JSON.stringify(b.input) === '{}',
    JSON.stringify(b),
  )
}

{
  // Regression: the empty-turn bug of 14 Aug 2026. The model thinks by default
  // and max_tokens caps thinking + output together, so a hard request can spend
  // the whole budget thinking and end at stop_reason "max_tokens" with nothing
  // but thinking blocks. The old accumulator ignored those blocks entirely, so
  // the turn looked empty and the UI blamed the card lock.
  const events = [
    { type: 'message_start', message: { id: 'm2' } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
    // display defaults to "omitted": thinking deltas may never arrive, or carry
    // empty text — the block itself must still be captured.
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-abc' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
    { type: 'message_stop' },
  ]
  const wire = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
  let thinkingSeen = 0
  const acc = createStreamAccumulator({ onThinking: () => thinkingSeen++ })
  for (let i = 0; i < wire.length; i += 11) acc.push(wire.slice(i, i + 11))
  const r = acc.finish()
  const b = r.content[0]
  check('thinking-only turn is not empty', r.content.length === 1, String(r.content.length))
  check('thinking block captured', b?.type === 'thinking', JSON.stringify(b))
  check('signature preserved verbatim', b?.type === 'thinking' && b.signature === 'sig-abc')
  check('onThinking fired once', thinkingSeen === 1, String(thinkingSeen))
  check('max_tokens stop reason surfaces', r.stopReason === 'max_tokens', String(r.stopReason))
}

{
  // Thinking text, when the display setting does return it, accumulates.
  const acc = createStreamAccumulator()
  const push = (e: unknown) => acc.push('data: ' + JSON.stringify(e) + '\n\n')
  push({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } })
  push({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'yörünge ' } })
  push({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hızı' } })
  push({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } })
  push({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Cevap.' } })
  const r = acc.finish()
  const think = r.content.find((b) => b.type === 'thinking')
  check(
    'thinking text accumulates across deltas',
    think?.type === 'thinking' && think.thinking === 'yörünge hızı',
  )
  const txt = r.content.find((b) => b.type === 'text')
  check('text after thinking still parsed', txt?.type === 'text' && txt.text === 'Cevap.')
}

{
  // 18 Aug 2026: under load Anthropic answers 200, opens the stream, then
  // writes an `error` event instead of content. That must surface as a
  // retryable overloaded error, not a generic stream failure.
  const acc = createStreamAccumulator()
  acc.push('data: ' + JSON.stringify({ type: 'message_start', message: { id: 'm3', usage: { input_tokens: 5 } } }) + '\n\n')
  let caught: unknown = null
  try {
    acc.push(
      'data: ' +
        JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }) +
        '\n\n',
    )
  } catch (e) {
    caught = e
  }
  check('in-stream overload throws AnthropicError', caught instanceof AnthropicError)
  check(
    'overload is classified transient',
    caught instanceof AnthropicError && caught.kind === 'overloaded_error' && isTransient(caught),
  )
  check(
    'overload message is Turkish and actionable',
    caught instanceof AnthropicError && caught.message.includes('aşırı yüklü'),
  )
  check('auth errors are not retried', !isTransient(new AnthropicError('x', 401)))
  check('validation errors are not retried', !isTransient(new AnthropicError('x', 400)))
  check('529 status is retried', isTransient(new AnthropicError('x', 529)))
}

check(
  'set_fields warns against oversized single calls',
  setFieldsTool.description.includes('at most 15 fields'),
)

{
  // Garbage on the wire should be skipped, not fatal.
  const acc = createStreamAccumulator()
  acc.push('data: not-json\n\n')
  acc.push(': a comment line\n\n')
  acc.push('data: ' + JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + '\n\n')
  acc.push('data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }) + '\n\n')
  const r = acc.finish()
  const b = r.content[0]
  check('malformed events skipped', b?.type === 'text' && b.text === 'ok', JSON.stringify(b))
}

console.log('\n== storyboard ==')
{
  const sbFields = fill('storyboard', 20)
  const scenes: Scene[] = [
    {
      timestamp_start: '00:00.0',
      timestamp_end: '00:04.2',
      scene_description: 'Wide establishing over the basin',
      camera_angle: 'Eye Level',
      shot_type: 'Wide',
      camera_movement: 'Slow pan right',
      visual_prompt: 'SCENE_ONE_VISUAL',
      audio: 'Wind over mineral spires',
      voice_over: 'At first light the basin stirs.',
      source_shot: 'Shot 4 | 00:00:12.000 – 00:00:16.200',
    },
    {
      timestamp_start: '00:04.2',
      timestamp_end: '00:09.0',
      scene_description: 'Close on the forager',
      camera_angle: 'Low Angle',
      shot_type: 'Close-Up',
      camera_movement: 'Static',
      visual_prompt: 'SCENE_TWO_VISUAL',
      audio: 'Feeding clicks',
      voice_over: 'It works the crevice methodically.',
      source_shot: 'Shot 5 | 00:00:16.200 – 00:00:21.000',
    },
  ]

  const ctx = {
    type: 'storyboard' as CardType,
    fields: sbFields,
    ancestors: { planet: planetFields, ecosystem: ecoFields, species: speciesFields },
    scenes,
  }
  const sb = buildPrompts(ctx)
  check('three storyboard prompts', sb.length === 3, String(sb.length))

  const board = sb.find((p) => p.kind === 'sheet')!
  check('board states the frame count', board.text.includes('containing **2** storyboard frames'))
  check('board follows the template opener', board.text.includes('during its natural daily life inside'))
  check('board lists every scene block', board.text.includes('SCENE 01') && board.text.includes('SCENE 02'))
  // Master prompt template: every scene carries all eight fields. A frame line
  // with only timestamp + description dropped the camera language (Mete, 19 Aug).
  for (const label of ['Timestamp:', 'Scene Description', 'Camera Angle', 'Shot Type', 'Camera Movement', 'Visual Prompt', 'Audio', 'Voice-over']) {
    check(`board scene block has "${label}"`, (board.text.match(new RegExp(`^${label.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'gm')) ?? []).length === 2)
  }
  check('board carries scene camera values', board.text.includes('Slow pan right') && board.text.includes('Low Angle'))
  check('board carries the voice-over', board.text.includes('At first light the basin stirs.'))
  check('board ends with the OUTPUT list', board.text.trim().endsWith('AAA film pre-production'))
  check('board carries planet constraint', board.text.includes('TEST_PLANET_NAME'))

  const seq = sb.find((p) => p.kind === 'video')!
  check('sequence includes both scenes', seq.text.includes('SCENE_ONE_VISUAL') && seq.text.includes('SCENE_TWO_VISUAL'))
  check('sequence forbids narration', seq.text.includes('No narration'))
  check('sequence forbids Earth reference', seq.text.includes('No references to Earth'))
  check(
    'narration kept out of the generation prompt',
    !seq.text.includes('At first light the basin stirs.'),
  )

  const narration = sb.find((p) => p.kind === 'still')!
  check('narration track carries the voice-over', narration.text.includes('At first light the basin stirs.'))

  // Per-scene prompts are what actually gets pasted into a video model.
  const one = sceneVideoPrompt(ctx, scenes[0])
  check('scene prompt is self-contained', one.includes('SCENE_ONE_VISUAL') && one.includes('WORLD RULES'))
  check('scene prompt carries its own camera work', one.includes('Slow pan right'))
  check('scene prompt excludes the other scene', !one.includes('SCENE_TWO_VISUAL'))
  check('scene prompt forbids voice-over', one.includes('No voice-over'))
  check('scene prompt inherits the planet', one.includes('TEST_PLANET_NAME'))

  // An empty storyboard must still be honest rather than emitting a broken prompt.
  const empty = buildPrompts({ ...ctx, scenes: [] })
  check('empty storyboard reports missing scenes', empty[0].missing.includes('Sahneler'))

  check('storyboard is last in the pipeline', cardOrder[cardOrder.length - 1] === 'storyboard')
  check('storyboard follows location', schemas.storyboard.parent === 'location')
  check('storyboard is a scene card', isSceneCard('storyboard') && !isSceneCard('planet'))
  check('scene contract has 10 fields', SCENE_FIELDS.length === 10, String(SCENE_FIELDS.length))
}

console.log('\n== shot library index ==')
{
  // The agent must see the WHOLE library and may pick a window anywhere in any
  // list — "always the first 15 seconds of the chosen list" was the bug.
  const mk = (list: string, i: number, t0: number, t1: number, subj: string): ShotContext => ({
    shot_list_id: list,
    ordinal: i,
    start_seconds: t0,
    end_seconds: t1,
    timecode_start: `00:00:${String(t0).padStart(2, '0')}.000`,
    timecode_end: `00:00:${String(t1).padStart(2, '0')}.000`,
    shot_type: 'Wide',
    camera_angle: 'High Angle',
    camera_movement: 'Static',
    lens: '24mm',
    dof: 'Deep',
    main_subject: subj,
    primary_action: `${subj} acts`,
    foreground: '',
    background: 'plain',
    composition: 'Thirds',
    lighting: 'Overcast',
    camera_purpose: 'Establish',
    continuity_notes: '',
    technical_notes: '',
  })
  const lists: LibraryList[] = [
    { id: 'L1', title: 'Arctic lead', duration_seconds: 9 },
    { id: 'L2', title: 'Reef dusk', duration_seconds: 6 },
  ]
  const shots = [
    mk('L1', 0, 0, 3, 'ice'), mk('L1', 1, 3, 6, 'seal'), mk('L1', 2, 6, 9, 'seal dives'),
    mk('L2', 0, 0, 2, 'coral'), mk('L2', 1, 2, 4, 'fish'), mk('L2', 2, 4, 6, 'shark'),
  ]
  const idx = libraryBlock(lists, shots)
  check('index names every list', idx.includes('LIST "Arctic lead"') && idx.includes('LIST "Reef dusk"'))
  check('index carries list ids for select_sequence', idx.includes('shot_list_id: L1') && idx.includes('shot_list_id: L2'))
  check('index lists every shot', (idx.match(/^ {2} +\d+ \| /gm) ?? []).length === 6)
  check('index says the opening is not privileged', idx.includes('not privileged'))
  check('index is compact (one line per shot)', !idx.includes('Lens:'))
  check('empty library is honest', libraryBlock([], []).includes('library is empty'))

  const none = selectedSequenceBlock(null, lists, shots)
  check('no selection blocks scene writing', none.includes('None yet'))
  const mid = selectedSequenceBlock({ shot_list_id: 'L2', start: 1, end: 2 }, lists, shots)
  check('selection can sit mid-list, not at its start', mid.includes('shots 2–3') && !mid.includes('coral'))
  check('selected block carries full detail', mid.includes('Lens: 24mm') && mid.includes('fish') && mid.includes('shark'))
  check('selected block states total duration', mid.includes('4.00s, 2 shots'))
  check('stale selection is flagged', selectedSequenceBlock({ shot_list_id: 'L9', start: 0, end: 1 }, lists, shots).includes('no longer matches'))

  // The index is stable across turns → cached half; the selection is dynamic.
  const blocks = buildSystemBlocks('storyboard', {}, {}, cfg('storyboard'), { lists, shots, selection: { shot_list_id: 'L1', start: 1, end: 2 } })
  check('library index lives in the cached half', blocks[0].text.includes('PRODUCTION SHOT LIBRARY — INDEX'))
  check('selected sequence lives in the dynamic half', blocks[1].text.includes('SELECTED SEQUENCE — list "Arctic lead"'))
  check('select_sequence requires a rationale', (selectSequenceTool.input_schema as any).required.includes('rationale'))
  check('protocol demands a whole-library search', protocolText('storyboard').includes('Search the WHOLE library'))
  check('protocol names select_sequence', protocolText('storyboard').includes('select_sequence'))
}

console.log('\n== locked cards ==')
{
  // A locked card is frozen at the database level. Offering the writing tools
  // anyway let the agent attempt writes that were rejected while it was told they
  // had succeeded — the sheet stayed empty and the chat went silent.
  const locked = buildSystemPrompt('planet', {}, {}, cfg('planet'), { locked: true })
  const open = buildSystemPrompt('planet', {}, {}, cfg('planet'), {})
  check('locked card announces its state', locked.includes('CARD STATE — LOCKED'))
  check(
    'locked card forbids claiming a write',
    locked.includes('Do not claim to have written anything'),
  )
  check('locked card points at the unlock control', locked.includes('Kilidi aç'))
  check('unlocked card carries no such block', !open.includes('CARD STATE — LOCKED'))
}

console.log('\n== protocol completeness ==')
// These sections come straight from the source PROTOCOL documents. Condensing
// them away once cost the approval loop and the improvement proposal entirely.
{
  // The four identity sheets share one protocol shape; the storyboard adapts a
  // sequence instead of resolving fields, so its sections differ by design.
  const SHEET_SECTIONS = [
    'USER INTERACTION',
    'INFERENCE RULES',
    'CONSISTENCY RULES',
    'OUTPUT VALIDATION',
    'REVISION AND APPROVAL',
    'LOCKING',
    'PROTOCOL IMPROVEMENT PROPOSAL',
    'LANGUAGE',
    'OUTPUT DISCIPLINE',
  ]
  const STORYBOARD_SECTIONS = [
    'THE WORLD IS REAL',
    'SEQUENCE SELECTION',
    'PRESERVE VERSUS ADAPT',
    'CONSISTENCY',
    'AUDIO AND NARRATION',
    'OUTPUT VALIDATION',
    'REVISION AND APPROVAL',
    'PROTOCOL IMPROVEMENT PROPOSAL',
    'LANGUAGE',
    'OUTPUT DISCIPLINE',
  ]
  for (const t of cardOrder) {
    const p = protocolText(t)
    const required = t === 'storyboard' ? STORYBOARD_SECTIONS : SHEET_SECTIONS
    const missing = required.filter((s) => !p.includes(s))
    check(`${t}: every protocol section present`, missing.length === 0, missing.join(', '))
  }

  const sb = protocolText('storyboard')
  check('storyboard forbids reordering shots', sb.includes('Do not reorder shots'))
  check('storyboard maps one shot to one scene', sb.includes('exactly one scene'))
  check('storyboard names the scene tool', sb.includes('set_scenes'))
  check('storyboard never breaks the fiction', sb.includes('Never reveal that the documentary is fictional'))
  const planet = protocolText('planet')
  check('names the proposal tool', planet.includes('propose_protocol_improvement'))
  check(
    'forbids self-declared approval',
    planet.includes('only the user does that'),
  )
  check(
    'forbids storing project-specific knowledge in proposals',
    planet.includes('Never store project-specific knowledge'),
  )
  check('domain word is substituted', protocolText('species').includes('biological consistency'))
}

console.log('\n== cut detection ==')
{
  /** Builds a delta series: quiet within-shot motion, spikes at cuts. */
  function series(nSamples: number, cutAt: number[], motion = 0.05, cut = 0.45): number[] {
    const d: number[] = []
    for (let i = 0; i < nSamples; i++) {
      // Deterministic wobble so the baseline is not perfectly flat.
      const wobble = motion * (0.6 + 0.8 * Math.abs(Math.sin(i * 1.7)))
      d.push(cutAt.includes(i) ? cut : wobble)
    }
    d[0] = 0
    return d
  }

  // Densely cut footage — a documentary montage, roughly a cut every 1.5s at
  // 0.25s sampling. This is the regime where the old statistic collapses.
  const cuts = Array.from({ length: 34 }, (_, k) => (k + 1) * 6)
  const deltas = series(210, cuts)

  // The statistic that shipped: cuts inflate the mean and the standard
  // deviation, lifting the threshold above the very spikes it should catch.
  const body = deltas.slice(1)
  const mean = body.reduce((a, b) => a + b, 0) / body.length
  const sd = Math.sqrt(body.reduce((a, b) => a + (b - mean) ** 2, 0) / body.length)
  const oldThreshold = Math.max(0.08, mean + 2.5 * sd)
  const oldFound = deltas.filter((d, i) => i > 0 && d >= oldThreshold).length
  check(
    'reproduces the old failure: mean+2.5sd misses every cut',
    oldFound === 0,
    `found ${oldFound} of ${cuts.length}, threshold ${oldThreshold.toFixed(3)}`,
  )

  const found = findCutIndices(deltas)
  check('finds every cut', found.length === cuts.length, `${found.length}/${cuts.length}`)
  check('finds them at the right samples', found.join(',') === cuts.join(','), found.join(','))

  // Density must not defeat it — this is what a fast-cut sequence looks like.
  const dense = Array.from({ length: 60 }, (_, i) => i)
    .filter((i) => i % 3 === 0 && i > 0)
  const denseFound = findCutIndices(series(60, dense))
  check('holds up when a third of samples are cuts', denseFound.length === dense.length,
    `${denseFound.length}/${dense.length}`)

  // Static footage must not dissolve into noise.
  const still = findCutIndices(Array.from({ length: 80 }, () => 0.004))
  check('no cuts in a locked-off static shot', still.length === 0, String(still.length))

  // Continuous handheld motion is not a cut.
  const handheld = Array.from({ length: 80 }, (_, i) => 0.14 + 0.03 * Math.sin(i))
  check('sustained camera motion is not mistaken for cuts', findCutIndices(handheld).length === 0,
    String(findCutIndices(handheld).length))

  // A gentle cut between similar scenes should still register.
  const subtle = findCutIndices(series(80, [20, 40, 60], 0.04, 0.22))
  check('catches a low-contrast cut', subtle.length === 3, String(subtle.length))

  // Sensitivity is a real dial in both directions.
  const loose = findCutIndices(series(80, [20, 40, 60], 0.05, 0.20), 0.5)
  const tight = findCutIndices(series(80, [20, 40, 60], 0.05, 0.20), 3)
  check('lower sensitivity finds at least as many', loose.length >= 3, String(loose.length))
  check('higher sensitivity finds fewer', tight.length < 3, String(tight.length))

  check('degenerate input is safe', findCutIndices([]).length === 0 && findCutIndices([0.5]).length === 0)
}

console.log('\n== error reporting ==')
// Supabase returns plain objects, not Errors. Collapsing those into a generic
// message once hid a NOT NULL violation for a whole debugging cycle.
check('Error instance', describeError(new Error('boom')) === 'boom')
check(
  'postgrest-shaped object surfaces its message',
  describeError({ message: 'null value in column "wrote"', code: '23502' }).startsWith(
    'null value in column "wrote"',
  ),
  describeError({ message: 'null value in column "wrote"', code: '23502' }),
)
check(
  'code is carried through',
  describeError({ message: 'x', code: '23502' }).includes('23502'),
)
check('falls back on details', describeError({ details: 'detay' }) === 'detay')
check('plain string', describeError('düz metin') === 'düz metin')
check(
  'truly unknown still has a message',
  describeError(undefined) === 'Beklenmeyen bir hata oluştu.',
)
check('abort detected', isAbort(new DOMException('x', 'AbortError')))
check('ordinary error is not an abort', !isAbort(new Error('x')))

console.log('\n== multi-row insert shape ==')
// Guards the PostgREST footgun: in a multi-row insert the column list is the
// union of the objects, and any key a row omits is written as NULL.
{
  const rows = [
    { card_id: 'c', owner: 'o', role: 'user', text: 'hi', wrote: [] },
    { card_id: 'c', owner: 'o', role: 'assistant', text: 'yo', wrote: ['planet_name'] },
  ]
  const keys = rows.map((r) => Object.keys(r).sort().join(','))
  check('every row declares the same columns', new Set(keys).size === 1, keys.join(' | '))
  check(
    'no row omits a NOT NULL column',
    rows.every((r) => Array.isArray(r.wrote)),
  )
}

console.log('\n== nvidia bridge: request translation ==')
{
  const req = {
    model: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    system: [
      { type: 'text', text: 'STABLE HALF', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'VARIABLE HALF' },
    ],
    messages: [
      { role: 'user', content: 'merhaba' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'yazıyorum' },
          { type: 'tool_use', id: 'tu_1', name: 'set_fields', input: { updates: [{ key: 'mass' }] } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: 'Wrote 1 field(s).' },
          { type: 'text', text: 'devam' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' },
          },
        ],
      },
    ],
    tools: [
      { name: 'set_fields', description: 'writes', input_schema: { type: 'object', properties: {} } },
    ],
    stream: true,
  }

  check('claude ids route to anthropic', providerFor('claude-opus-5') === 'anthropic')
  check('other ids route to nvidia', providerFor('nvidia/llama-3.3-nemotron-super-49b-v1.5') === 'nvidia')

  const msgs = toOpenAIMessages(req) as any[]
  check('cached system halves collapse into one message', msgs[0].role === 'system')
  check(
    'both halves survive the collapse',
    msgs[0].content.includes('STABLE HALF') && msgs[0].content.includes('VARIABLE HALF'),
  )

  const asst = msgs.find((m) => m.role === 'assistant')
  check('tool_use becomes an OpenAI tool_call', asst?.tool_calls?.[0]?.function?.name === 'set_fields')
  check(
    'tool arguments are serialised as a JSON string',
    typeof asst?.tool_calls?.[0]?.function?.arguments === 'string' &&
      JSON.parse(asst.tool_calls[0].function.arguments).updates[0].key === 'mass',
  )

  // The fan-out that actually differs between the two formats.
  const toolMsg = msgs.find((m) => m.role === 'tool')
  check('tool_result becomes its own tool message', toolMsg?.tool_call_id === 'tu_1')
  check(
    'tool message precedes the remaining user content',
    msgs.indexOf(toolMsg) < msgs.lastIndexOf(msgs.filter((m) => m.role === 'user').pop()),
  )

  const lastUser = msgs.filter((m) => m.role === 'user').pop() as any
  const img = lastUser.content.find((c: any) => c.type === 'image_url')
  check('image becomes a data URL', img?.image_url?.url === 'data:image/jpeg;base64,QUJD')

  const body = toOpenAIRequest(req, 24000) as any
  check('tools become OpenAI functions', body.tools[0].function.name === 'set_fields')
  check('schema is carried over as parameters', body.tools[0].function.parameters.type === 'object')
  check('usage is requested so cost stays measurable', body.stream_options?.include_usage === true)
}

console.log('\n== nvidia bridge: stream round-trip ==')
{
  // The real proof: an OpenAI stream, rewritten by the bridge, must parse in the
  // client's own accumulator and produce the same blocks Anthropic would.
  const chunks = [
    { choices: [{ index: 0, delta: { content: 'Gezegeni ' } }] },
    { choices: [{ index: 0, delta: { content: 'kuruyorum.' } }] },
    {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, id: 'call_a', function: { name: 'set_fields', arguments: '{"updates":[{"key":"planet_' } },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: 'name","value":"Vesper","state":"confirmed"}]}' } },
            ],
          },
        },
      ],
    },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    { usage: { prompt_tokens: 1234, completion_tokens: 567 }, choices: [] },
  ]
  const wire = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'

  const bridge = createOpenAIToAnthropic()
  let anthropicWire = ''
  // Feed in awkward slices so event boundaries land mid-chunk, as on a real socket.
  for (let i = 0; i < wire.length; i += 11) anthropicWire += bridge.push(wire.slice(i, i + 11))
  anthropicWire += bridge.finish()

  const text: string[] = []
  const tools: string[] = []
  const acc = createStreamAccumulator({
    onText: (d) => text.push(d),
    onToolStart: (n) => tools.push(n),
  })
  for (let i = 0; i < anthropicWire.length; i += 13) acc.push(anthropicWire.slice(i, i + 13))
  const result = acc.finish()

  check('text survives the round trip', text.join('') === 'Gezegeni kuruyorum.', text.join(''))
  check('tool start is reported', tools.join(',') === 'set_fields', tools.join(','))
  check('two blocks rebuilt', result.content.length === 2, String(result.content.length))

  const tb = result.content.find((b) => b.type === 'tool_use')
  const input = tb?.type === 'tool_use' ? (tb.input as any) : null
  check('split tool arguments reassemble', input?.updates?.[0]?.key === 'planet_name', JSON.stringify(input))
  check('value survives the split', input?.updates?.[0]?.value === 'Vesper')
  check('finish_reason maps to a stop reason', result.stopReason === 'tool_use', String(result.stopReason))
  check('usage is forwarded for cost tracking', anthropicWire.includes('"input_tokens":1234'))
}

// The free tier broke once because a model id in the UI no longer existed
// upstream, and once more because the server would have rejected it anyway.
// Both are offline-checkable.
{
  for (const m of MODELS) {
    check('server allows ' + m.id, ALLOWED_MODELS.has(m.id))
  }
  check('default model is offered in the UI', MODELS.some((m) => m.id === DEFAULT_MODEL), DEFAULT_MODEL)
  check('at least one vision model is offered', MODELS.some((m) => m.vision && m.id !== 'claude-sonnet-5' && m.id !== 'claude-opus-5'))
  check('vision is read from the table, not the name', supportsVision('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'))
  check('a text model is not treated as sighted', !supportsVision('nvidia/nemotron-3-super-120b-a12b'))

  // NIM hides its message under a different key for every failure mode; each
  // of these once reduced to a bare status code on screen.
  const gone = toAnthropicError(410, JSON.stringify({ detail: 'Model is no longer available' })) as any
  check('NIM detail becomes a message', gone.error.message === 'Model is no longer available', JSON.stringify(gone))
  check('410 is labelled as a retired model', gone.error.type === 'model_gone', gone.error.type)

  const problem = toAnthropicError(404, JSON.stringify({ title: 'Not Found', status: 404 })) as any
  check('problem documents surface their title', problem.error.message === 'Not Found', JSON.stringify(problem))

  const nested = toAnthropicError(400, JSON.stringify({ error: { message: 'bad tool schema', type: 'invalid_request_error' } })) as any
  check('Anthropic-shaped errors pass through', nested.error.message === 'bad tool schema')
  check('and keep their type', nested.error.type === 'invalid_request_error')

  const validation = toAnthropicError(422, JSON.stringify({ detail: [{ msg: 'max_tokens too large' }] })) as any
  check('validation arrays are joined', validation.error.message === 'max_tokens too large', JSON.stringify(validation))

  const html = toAnthropicError(502, '<html>Bad Gateway</html>') as any
  check('unparseable bodies keep their text', html.error.message.includes('Bad Gateway'), html.error.message)

  const empty = toAnthropicError(500, '') as any
  check('an empty body still says something', empty.error.message.length > 0, empty.error.message)
}

// Motion only exists between frames. Three stills across an eight-second take
// is what made the model answer with two contradictory camera movements.
{
  check('a one-second shot still gets the floor', framesForSpan(1) === 3, String(framesForSpan(1)))
  check('four seconds gets at least three', framesForSpan(4) >= 3, String(framesForSpan(4)))
  check('eight seconds gets six', framesForSpan(8) === 6, String(framesForSpan(8)))
  check('ten seconds gets seven', framesForSpan(10) === 7, String(framesForSpan(10)))
  check('a long take is capped', framesForSpan(600) === 10, String(framesForSpan(600)))
  check(
    'coverage never thins as a shot grows',
    [1, 2, 4, 8, 12, 30, 90].every((sp, i, a) => i === 0 || framesForSpan(sp) >= framesForSpan(a[i - 1])),
  )
}

// A synthetic clip shaped like the footage that failed: three shots in eight
// seconds, heavy motion inside each, and cuts between scenes that share a
// palette. Frames are built rather than decoded so the measurement can be
// tested without a browser.
{
  const W = 32,
    H = 18
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

  /** One frame: a flat background with a bright object sitting at objX. */
  function frame(bg: number, obj: number, objX: number, objW: number): Uint8ClampedArray {
    const d = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inside = x >= objX && x < objX + objW
        // Jitter stands in for grain and sparkle: it moves pixels without
        // moving the distribution much.
        // Heavy jitter stands in for sparkle and grain: it moves a lot of",
        // pixels without moving the distribution much.
        const l = Math.max(0, Math.min(255, (inside ? obj : bg) + (rnd() - 0.5) * 70))
        const i = (y * W + x) * 4
        d[i] = d[i + 1] = d[i + 2] = l
        d[i + 3] = 255
      }
    }
    return d
  }

  // Three shots, eight samples each. Inside a shot the object sweeps across
  // frame — the motion that used to read larger than the cuts.
  // The hard case, and the real one: consecutive shots on the same set, at the
  // same exposure. Only the framing changes, so the palette barely moves.
  const shots = [
    { bg: 60, obj: 225, objW: 8 },
    { bg: 66, obj: 215, objW: 15 },
    { bg: 58, obj: 230, objW: 4 },
  ]
  // Motion in real footage is not uniform: it stalls and bursts. That variance
  // is what lifts a spread-based threshold above the cuts when the measure
  // counts moving pixels.
  const sweep = [0, 1, 1, 12, 13, 13, 24, 2]
  const frames: Uint8ClampedArray[] = []
  for (const sh of shots) {
    for (let k = 0; k < sweep.length; k++) {
      // Keep the object wholly in frame: letting it run off the edge changes
      // how much of it is visible, which is a genuine content change and not
      // the motion this is meant to model.
      frames.push(frame(sh.bg, sh.obj, Math.min(sweep[k], W - sh.objW), sh.objW))
    }
  }
  const cutsAt = [8, 16]

  const histDeltas = [0]
  const pixDeltas = [0]
  for (let i = 1; i < frames.length; i++) {
    histDeltas.push(histogramDistance(lumaHistogram(frames[i - 1]), lumaHistogram(frames[i])))
    pixDeltas.push(pixelDelta(frames[i - 1], frames[i]))
  }
  const inShot = (xs: number[]) => xs.filter((_, i) => i > 0 && !cutsAt.includes(i))
  const atCut = (xs: number[]) => cutsAt.map((i) => xs[i])
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

  const histMotion = mean(inShot(histDeltas))
  const histCut = Math.min(...atCut(histDeltas))
  const pixMotion = mean(inShot(pixDeltas))
  const pixCut = Math.min(...atCut(pixDeltas))
  const found = findCutIndices(histDeltas)
  const foundOld = findCutIndices(pixDeltas)

  check(
    'histogram separates a cut from motion',
    histCut / histMotion > 2.5,
    `${histMotion.toFixed(3)} motion vs ${histCut.toFixed(3)} cut`,
  )
  check(
    'counting changed pixels does not',
    pixCut / pixMotion < 1.5,
    `${pixMotion.toFixed(3)} motion vs ${pixCut.toFixed(3)} cut`,
  )
  check('finds both cuts and nothing else', found.join(',') === cutsAt.join(','), found.join(',') || 'none')
  // The regression itself: on this clip the old measure found no cut at all,
  // and mistook the fastest motion for one. Every video came back as a single
  // shot, which is what was reported.
  check(
    'the replaced measure could not do this',
    foundOld.join(',') !== cutsAt.join(','),
    foundOld.join(',') || 'none',
  )
}

console.log(failures === 0 ? '\n✓ all checks passed\n' : `\n✗ ${failures} check(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
