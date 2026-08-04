/**
 * Logic smoke test: schema integrity, prompt assembly and inheritance.
 * Run with: npm run smoke
 */
import { schemas, cardOrder, allFields } from '../src/schemas'
import type { CardFields, CardType } from '../src/schemas'
import { buildPrompts } from '../src/lib/prompt'
import { buildSystemPrompt, applyUpdates } from '../src/agents/runner'
import { agentInstructions, protocolText } from '../src/agents/instructions'
import type { AgentConfig } from '../src/agents/config'
import { formatTimecode, dataUrlParts } from '../src/lib/video'
import { recordShotTool } from '../src/agents/deconstruct'
import { createStreamAccumulator } from '../src/lib/anthropic'

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

console.log(failures === 0 ? '\n✓ all checks passed\n' : `\n✗ ${failures} check(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
