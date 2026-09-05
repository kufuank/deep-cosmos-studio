/**
 * Live check against NVIDIA NIM — the one thing the offline smoke test cannot
 * cover: whether the model actually returns well-formed tool calls for our
 * schemas, on both the streaming and non-streaming paths.
 *
 * Costs nothing (free tier) but does spend two of the ~40 requests/minute.
 * Reads NVIDIA_API_KEY from the environment; the key is never written to disk.
 *
 *   npm run check:nvidia
 */
import {
  toOpenAIRequest,
  toAnthropicMessage,
  createOpenAIToAnthropic,
} from '../supabase/functions/anthropic/bridge.ts'

const KEY = process.env.NVIDIA_API_KEY
if (!KEY) {
  console.error('NVIDIA_API_KEY tanimli degil. Once anahtari ortam degiskeni olarak verin:')
  console.error('  $env:NVIDIA_API_KEY = "nvapi-..."   (PowerShell)')
  console.error('  export NVIDIA_API_KEY=nvapi-...      (bash)')
  process.exit(1)
}
const MODEL = 'nvidia/llama-3.3-nemotron-super-49b-v1.5'
const URL = 'https://integrate.api.nvidia.com/v1/chat/completions'

const setFields = {
  name: 'set_fields',
  description:
    'Write one or more resolved fields onto the identity sheet. Use this for every value you establish — never write field values into your chat text. Batch related updates together, but keep each call to at most 15 fields.',
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
            value: { type: 'string', description: 'The value, written in English.' },
            state: { type: 'string', enum: ['confirmed', 'inferred'] },
            reasoning: { type: 'string', description: 'Required for inferred values. In Turkish.' },
          },
          required: ['key', 'value', 'state'],
        },
      },
    },
    required: ['updates'],
  },
}

const system = `You are the Planet Identity agent for Deep Cosmos, a studio that produces fictional wildlife documentaries set on invented planets.

You resolve a planet identity sheet field by field. Every value you establish MUST be written with the set_fields tool — never write field values into your chat text.

FIELD SCHEMA (excerpt):
- planet_name — The planet's proper name.
- star_type — Spectral class of the host star, e.g. "K-type orange dwarf".
- orbital_distance_au — Distance from star in AU.
- day_length_hours — Length of one rotation in Earth hours.
- surface_gravity_g — Surface gravity relative to Earth.
- atmosphere_composition — Primary gases and proportions.
- dominant_biome — The planet's principal biome.
- ambient_light_quality — How light reads on camera: colour temperature, softness, shadow character.

Mark a value 'confirmed' only when the user supplied it. Otherwise 'inferred', with Turkish reasoning giving the causal chain.

Reply in Turkish.`

const messages = [
  {
    role: 'user',
    content:
      'Gezegen konsepti: kızıl cüce yıldızın etrafında kilitlenmiş dönen, sürekli alacakaranlık kuşağında yaşamın toplandığı bir dünya. Adı Vesperia olsun.',
  },
]

async function nonStreaming() {
  const oa = toOpenAIRequest({ model: MODEL, system, messages, tools: [setFields], max_tokens: 8000 }, 8000)
  const t0 = Date.now()
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}`, accept: 'application/json' },
    body: JSON.stringify(oa),
  })
  const ms = Date.now() - t0
  if (!res.ok) {
    console.log(`NON-STREAM  HTTP ${res.status}\n${(await res.text()).slice(0, 600)}`)
    return
  }
  const msg: any = toAnthropicMessage(await res.json())
  const tools = msg.content.filter((c: any) => c.type === 'tool_use')
  const text = msg.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
  console.log(`NON-STREAM  ${ms}ms  stop=${msg.stop_reason}  in=${msg.usage.input_tokens} out=${msg.usage.output_tokens}`)
  console.log(`  text blocks: ${text.length} chars`)
  console.log(`  tool calls : ${tools.length}`)
  for (const t of tools) {
    const ups = (t.input as any)?.updates
    console.log(`   - ${t.name}: ${Array.isArray(ups) ? ups.length + ' updates' : 'MALFORMED ' + JSON.stringify(t.input).slice(0, 200)}`)
    if (Array.isArray(ups)) {
      for (const u of ups.slice(0, 4)) console.log(`       ${u.key} = ${String(u.value).slice(0, 60)}  [${u.state}]`)
      const bad = ups.filter((u: any) => !u.key || !u.value || !u.state)
      if (bad.length) console.log(`       !! ${bad.length} update(s) missing required fields`)
    }
  }
  if (text) console.log(`  text: ${text.slice(0, 300).replace(/\n/g, ' ')}`)
}

async function streaming() {
  const oa = toOpenAIRequest({ model: MODEL, system, messages, tools: [setFields], max_tokens: 8000, stream: true }, 8000)
  const t0 = Date.now()
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}`, accept: 'text/event-stream' },
    body: JSON.stringify(oa),
  })
  if (!res.ok) {
    console.log(`STREAM      HTTP ${res.status}\n${(await res.text()).slice(0, 600)}`)
    return
  }
  const bridge = createOpenAIToAnthropic()
  let out = ''
  let firstByte = 0
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!firstByte) firstByte = Date.now() - t0
    out += bridge.push(dec.decode(value, { stream: true }))
  }
  out += bridge.finish()

  // Replay our own SSE the way the client accumulator does.
  const events = out.split('\n\n').filter(Boolean)
  let text = ''
  const toolJson = new Map<number, string>()
  const toolName = new Map<number, string>()
  let stop = ''
  for (const e of events) {
    const d = e.split('\n').find((l) => l.startsWith('data:'))
    if (!d) continue
    const p = JSON.parse(d.slice(5))
    if (p.type === 'content_block_start' && p.content_block?.type === 'tool_use') {
      toolName.set(p.index, p.content_block.name)
      toolJson.set(p.index, '')
    }
    if (p.type === 'content_block_delta' && p.delta?.type === 'text_delta') text += p.delta.text
    if (p.type === 'content_block_delta' && p.delta?.type === 'input_json_delta')
      toolJson.set(p.index, (toolJson.get(p.index) ?? '') + p.delta.partial_json)
    if (p.type === 'message_delta') stop = p.delta?.stop_reason
  }
  console.log(`\nSTREAM      ${Date.now() - t0}ms  first byte ${firstByte}ms  ${events.length} events  stop=${stop}`)
  console.log(`  text blocks: ${text.length} chars`)
  console.log(`  tool calls : ${toolJson.size}`)
  for (const [i, raw] of toolJson) {
    try {
      const parsed = JSON.parse(raw)
      const ups = parsed.updates
      console.log(`   - ${toolName.get(i)}: ${Array.isArray(ups) ? ups.length + ' updates' : 'no updates array'}`)
      if (Array.isArray(ups)) for (const u of ups.slice(0, 3)) console.log(`       ${u.key} = ${String(u.value).slice(0, 60)}`)
    } catch (err) {
      console.log(`   - ${toolName.get(i)}: JSON DID NOT PARSE (${raw.length} chars) ${raw.slice(0, 200)}`)
    }
  }
  if (text) console.log(`  text: ${text.slice(0, 300).replace(/\n/g, ' ')}`)
}

await nonStreaming()
await streaming()
