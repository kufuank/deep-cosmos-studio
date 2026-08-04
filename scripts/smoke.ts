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

console.log(failures === 0 ? '\n✓ all checks passed\n' : `\n✗ ${failures} check(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
