/**
 * Live capability probe against NVIDIA NIM.
 *
 * The offline smoke test proves the bridge translates correctly; it cannot
 * prove the model on the other end does what the app needs. Two of the app's
 * requirements are invisible from the catalogue:
 *
 *   1. The agent writes every field through a tool call. A model that answers
 *      in prose leaves the sheet empty and reads as a bug in the app.
 *   2. Shot analysis sends frames AND expects a tool call back. Most models
 *      that call tools cannot see, and several that see cannot call tools —
 *      the intersection is small and is not documented per model.
 *
 * So this asks each candidate directly, through the same translation the edge
 * function uses, and prints a table. The vision probe uses a frame that is red
 * on the left and blue on the right: a model that cannot see the image can
 * still return a well-formed tool call, and only the colours catch it out.
 *
 * Free tier, so this costs nothing but spends one request per candidate.
 * Reads NVIDIA_API_KEY from the environment and never writes it anywhere.
 *
 *   npm run check:nvidia
 */

import {
  toOpenAIRequest,
  toAnthropicMessage,
  createOpenAIToAnthropic,
  ALLOWED_MODELS,
} from '../supabase/functions/anthropic/bridge.ts'

const KEY = process.env.NVIDIA_API_KEY
const CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'
const CATALOG_URL = 'https://integrate.api.nvidia.com/v1/models'
const GAP_MS = 1600

const TEXT_CANDIDATES = [
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-nano-3-30b-a3b',
  'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'openai/gpt-oss-20b',
  'moonshotai/kimi-k3',
  'deepseek-ai/deepseek-v4-pro-0813',
]

const VISION_CANDIDATES = [
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'meta/llama-3.2-90b-vision-instruct',
  'meta/llama-3.2-11b-vision-instruct',
  'google/gemma-3-12b-it',
]

/** 64x64 PNG: red left half, blue right half. */
const FRAME =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAU0lEQVR42u3PMQ0AAAgDMGRMBv5VIAkJXHxNaqA1yav0vCoBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBgcsC3OXA8W3ADhYAAAAASUVORK5CYII='

const setFields = {
  name: 'set_fields',
  description:
    'Write one or more resolved fields onto the identity sheet. Use this for every value you establish — never write field values into your chat text.',
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

const recordFrame = {
  name: 'record_shot',
  description: 'Record what this frame shows. Call this once; do not answer in prose.',
  input_schema: {
    type: 'object',
    properties: {
      left_half_colour: { type: 'string', description: 'Dominant colour of the LEFT half.' },
      right_half_colour: { type: 'string', description: 'Dominant colour of the RIGHT half.' },
      shot_size: { type: 'string', description: 'Shot size, e.g. wide, medium, close.' },
    },
    required: ['left_half_colour', 'right_half_colour', 'shot_size'],
  },
}

const AGENT_SYSTEM = `You are the Planet Identity agent for Deep Cosmos, a studio that produces fictional wildlife documentaries set on invented planets.

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

const BRIEF =
  'Gezegen konsepti: kızıl cüce yıldızın etrafında gelgit kilitli dönen, yaşamın sürekli alacakaranlık kuşağında toplandığı bir dünya. Adı Vesperia olsun.'

interface Verdict {
  model: string
  ok: boolean
  note: string
  ms?: number
  tools?: number
  fields?: number
  tokens?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function post(body: unknown, stream: boolean): Promise<Response> {
  return fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${KEY}`,
      accept: stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(body),
  })
}

/** Reads the message out of whichever key this provider chose today. */
async function failureText(res: Response): Promise<string> {
  const raw = await res.text()
  try {
    const b = JSON.parse(raw) as Record<string, any>
    const msg =
      (typeof b.error === 'string' ? b.error : b.error?.message) ??
      (typeof b.detail === 'string' ? b.detail : undefined) ??
      b.message ??
      b.title
    if (msg) return String(msg).slice(0, 140)
  } catch {
    /* fall through to the raw body */
  }
  return raw.slice(0, 140).replace(/\s+/g, ' ')
}

async function probeText(model: string): Promise<Verdict> {
  const req = toOpenAIRequest(
    {
      model,
      system: AGENT_SYSTEM,
      messages: [{ role: 'user', content: BRIEF }],
      tools: [setFields],
      max_tokens: 8000,
    },
    8000,
  )
  const t0 = Date.now()
  let res: Response
  try {
    res = await post(req, false)
  } catch (e) {
    return { model, ok: false, note: `baglanilamadi: ${(e as Error).message}` }
  }
  const ms = Date.now() - t0
  if (!res.ok) {
    return { model, ok: false, ms, note: `HTTP ${res.status} — ${await failureText(res)}` }
  }

  const msg = toAnthropicMessage(await res.json()) as any
  const calls = msg.content.filter((c: any) => c.type === 'tool_use')
  const tokens = `${msg.usage.input_tokens}/${msg.usage.output_tokens}`
  if (!calls.length) {
    const text = msg.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('')
    return {
      model,
      ok: false,
      ms,
      tokens,
      tools: 0,
      note: `arac cagirmadi, duz metin yazdi (${text.length} karakter)`,
    }
  }

  let fields = 0
  let malformed = 0
  for (const c of calls) {
    const ups = (c.input as any)?.updates
    if (!Array.isArray(ups)) {
      malformed++
      continue
    }
    for (const u of ups) {
      if (u?.key && u?.value && u?.state) fields++
      else malformed++
    }
  }
  return {
    model,
    ok: fields > 0 && malformed === 0,
    ms,
    tokens,
    tools: calls.length,
    fields,
    note:
      malformed > 0
        ? `${fields} gecerli alan, ${malformed} bozuk`
        : `${fields} alan yazdi, stop=${msg.stop_reason}`,
  }
}

async function probeVision(model: string): Promise<Verdict> {
  const req = toOpenAIRequest(
    {
      model,
      system:
        'You analyse single frames from wildlife documentary footage. Report what you see using the record_shot tool. Never answer in prose.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: FRAME } },
            { type: 'text', text: 'Record this frame with the record_shot tool.' },
          ],
        },
      ],
      tools: [recordFrame],
      max_tokens: 2000,
    },
    2000,
  )
  const t0 = Date.now()
  let res: Response
  try {
    res = await post(req, false)
  } catch (e) {
    return { model, ok: false, note: `baglanilamadi: ${(e as Error).message}` }
  }
  const ms = Date.now() - t0
  if (!res.ok) {
    return { model, ok: false, ms, note: `HTTP ${res.status} — ${await failureText(res)}` }
  }

  const msg = toAnthropicMessage(await res.json()) as any
  const call = msg.content.find((c: any) => c.type === 'tool_use')
  if (!call) {
    const text = msg.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('')
    // A model that sees but will not call tools is still worth knowing about.
    const sawIt = /red|kirmizi|kırmızı/i.test(text) && /blue|mavi/i.test(text)
    return {
      model,
      ok: false,
      ms,
      note: sawIt
        ? 'goruyor ama arac cagirmiyor — analiz duz metne duser'
        : `arac cagirmadi (${text.length} karakter metin)`,
    }
  }

  const left = String((call.input as any)?.left_half_colour ?? '')
  const right = String((call.input as any)?.right_half_colour ?? '')
  const sawRed = /red|crimson|scarlet|kirmizi|kırmızı/i.test(left)
  const sawBlue = /blue|azure|cobalt|mavi/i.test(right)
  return {
    model,
    ok: sawRed && sawBlue,
    ms,
    tokens: `${msg.usage.input_tokens}/${msg.usage.output_tokens}`,
    note:
      sawRed && sawBlue
        ? `gordu ve arac cagirdi (sol=${left}, sag=${right})`
        : `arac cagirdi ama kareyi okumadi (sol=${left || '-'}, sag=${right || '-'})`,
  }
}

/** The streaming path is what the chat UI uses; it is translated separately. */
async function probeStream(model: string): Promise<string> {
  const req = toOpenAIRequest(
    {
      model,
      system: AGENT_SYSTEM,
      messages: [{ role: 'user', content: BRIEF }],
      tools: [setFields],
      max_tokens: 8000,
      stream: true,
    },
    8000,
  )
  const t0 = Date.now()
  const res = await post(req, true)
  if (!res.ok) return `HTTP ${res.status} — ${await failureText(res)}`

  const bridge = createOpenAIToAnthropic()
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let out = ''
  let firstByte = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!firstByte) firstByte = Date.now() - t0
    out += bridge.push(dec.decode(value, { stream: true }))
  }
  out += bridge.finish()

  // Reassemble exactly the way the client accumulator does.
  let text = ''
  const args = new Map<number, string>()
  let stop = ''
  for (const evt of out.split(SEP)) {
    const line = evt.split(LF).find((l) => l.startsWith('data:'))
    if (!line) continue
    const p = JSON.parse(line.slice(5))
    if (p.type === 'content_block_start' && p.content_block?.type === 'tool_use') args.set(p.index, '')
    if (p.type === 'content_block_delta' && p.delta?.type === 'text_delta') text += p.delta.text
    if (p.type === 'content_block_delta' && p.delta?.type === 'input_json_delta')
      args.set(p.index, (args.get(p.index) ?? '') + p.delta.partial_json)
    if (p.type === 'message_delta') stop = p.delta?.stop_reason
  }

  let parsed = 0
  let broken = 0
  for (const raw of args.values()) {
    try {
      const v = JSON.parse(raw)
      if (Array.isArray(v.updates)) parsed += v.updates.length
      else broken++
    } catch {
      broken++
    }
  }
  const verdict = broken === 0 && parsed > 0 ? 'OK  ' : 'HATA'
  return `${verdict} ilk bayt ${firstByte}ms, toplam ${Date.now() - t0}ms, ${args.size} arac cagrisi, ${parsed} alan${broken ? `, ${broken} cozulemedi` : ''}, ${text.length} karakter metin, stop=${stop}`
}

const LF = String.fromCharCode(10)
const SEP = LF + LF

function row(v: Verdict): string {
  const mark = v.ok ? 'OK  ' : 'HATA'
  const timing = v.ms ? ` ${String(v.ms).padStart(6)}ms` : ' '.repeat(9)
  const tok = v.tokens ? ` ${v.tokens.padStart(11)}` : ' '.repeat(12)
  return `  ${mark}${timing}${tok}  ${v.model.padEnd(46)} ${v.note}`
}

async function main() {
  // The catalogue is public, so the cheapest check needs no key at all.
  console.log('KATALOG (anahtar gerekmez)')
  const live = new Set<string>()
  try {
    const cat = (await (await fetch(CATALOG_URL)).json()) as { data: Array<{ id: string }> }
    for (const m of cat.data) live.add(m.id)
    let missing = 0
    for (const id of ALLOWED_MODELS) {
      if (id.startsWith('claude-')) continue
      if (!live.has(id)) {
        console.log(`  YOK  ${id} — katalogdan kaldirilmis, 410 doner`)
        missing++
      }
    }
    console.log(
      missing === 0
        ? `  OK   izin listesindeki NIM modellerinin hepsi katalogda (${live.size} model yayinda)`
        : `  ${missing} model artik yok — izin listesini guncelleyin`,
    )
  } catch (e) {
    console.log(`  katalog okunamadi: ${(e as Error).message}`)
  }

  if (!KEY) {
    console.log('')
    console.log('NVIDIA_API_KEY tanimli degil, canli yoklama atlandi. Anahtari verip tekrar calistirin:')
    console.log('  $env:NVIDIA_API_KEY = "nvapi-..."   (PowerShell)')
    console.log('  export NVIDIA_API_KEY=nvapi-...      (bash)')
    process.exit(1)
  }

  console.log('')
  console.log('METIN MODELLERI — semamizla arac cagirabiliyor mu?')
  const textResults: Verdict[] = []
  for (const m of TEXT_CANDIDATES) {
    const v = await probeText(m)
    textResults.push(v)
    console.log(row(v))
    await sleep(GAP_MS)
  }

  console.log('')
  console.log('GORSEL MODELLERI — kareyi okuyup arac cagirabiliyor mu?')
  const visionResults: Verdict[] = []
  for (const m of VISION_CANDIDATES) {
    const v = await probeVision(m)
    visionResults.push(v)
    console.log(row(v))
    await sleep(GAP_MS)
  }

  const bestText = textResults.find((v) => v.ok)
  const bestVision = visionResults.find((v) => v.ok)

  if (bestText) {
    console.log('')
    console.log(`AKIS YOLU — ${bestText.model}`)
    console.log(`  ${await probeStream(bestText.model)}`)
  }

  console.log('')
  console.log('SONUC')
  console.log(
    bestText
      ? `  Sohbet modeli : ${bestText.model} (${bestText.fields} alan, ${bestText.ms}ms)`
      : '  Sohbet modeli : hicbiri semamizla arac cagiramadi — sema sadelestirilmeli',
  )
  console.log(
    bestVision
      ? `  Gorsel modeli : ${bestVision.model} (${bestVision.ms}ms)`
      : '  Gorsel modeli : hicbiri hem gorup hem arac cagiramadi — Shot Library ucretsiz katmanda calismaz',
  )
  process.exit(bestText && bestVision ? 0 : 1)
}

await main()
