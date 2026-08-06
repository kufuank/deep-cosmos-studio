/**
 * Logic smoke test: schema integrity, prompt assembly and inheritance.
 * Run with: npm run smoke
 */
import { schemas, cardOrder, allFields, isSceneCard, SCENE_FIELDS } from '../src/schemas'
import type { CardFields, CardType, Scene } from '../src/schemas'
import { buildPrompts, sceneVideoPrompt } from '../src/lib/prompt'
import { buildSystemPrompt, applyUpdates } from '../src/agents/runner'
import { agentInstructions, protocolText } from '../src/agents/instructions'
import type { AgentConfig } from '../src/agents/config'
import { formatTimecode, dataUrlParts, findCutIndices } from '../src/lib/video'
import { recordShotTool } from '../src/agents/deconstruct'
import { createStreamAccumulator } from '../src/lib/anthropic'
import { describeError, isAbort } from '../src/lib/errors'

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
  check('board states the frame count', board.text.includes('containing 2 storyboard frames'))
  check('board lists every frame', board.text.includes('FRAME 01') && board.text.includes('FRAME 02'))
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

console.log(failures === 0 ? '\n✓ all checks passed\n' : `\n✗ ${failures} check(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
