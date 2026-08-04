/**
 * Authenticated Anthropic proxy.
 *
 * The frontend is a public static site, so it must never hold the API key.
 *
 * Supabase's own verify_jwt is not sufficient here: the publishable key is
 * published with the frontend and the gateway accepts it, so anyone could reach
 * this function and spend credits. Every request is therefore resolved to a real
 * signed-in user against the Auth API before anything is forwarded upstream.
 */

const ALLOWED_MODELS = new Set(['claude-sonnet-5', 'claude-opus-5'])
const MAX_TOKENS_CAP = 16000

const ALLOWED_ORIGINS = [
  'https://kufuank.github.io',
  'http://localhost:5173',
  'http://localhost:5178',
]

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'origin',
  }
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'content-type': 'application/json' },
  })
}

/** Resolves the bearer token to a user id, or null if it is not a user session. */
async function resolveUser(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!token) return null

  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anon) return null

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: anon },
    })
    if (!res.ok) return null
    const user = (await res.json()) as { id?: string }
    return user?.id ?? null
  } catch {
    return null
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  // Configuration check. Reports only whether the key exists, never its value or
  // any part of it, so it is safe to answer before resolving a user.
  if (req.method === 'GET') {
    return json({ ok: true, key_configured: Boolean(Deno.env.get('ANTHROPIC_API_KEY')) }, 200, origin)
  }

  if (req.method !== 'POST') {
    return json({ error: 'Yalnızca POST veya GET destekleniyor.' }, 405, origin)
  }

  const userId = await resolveUser(req)
  if (!userId) {
    return json({ error: 'Oturum gerekli. Lütfen giriş yapın.' }, 401, origin)
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json(
      {
        error:
          'Sunucuda ANTHROPIC_API_KEY tanımlı değil. Supabase panelinden Edge Function secret olarak ekleyin.',
      },
      503,
      origin,
    )
  }

  let payload: {
    model?: string
    system?: string
    messages?: unknown[]
    tools?: unknown[]
    max_tokens?: number
  }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Geçersiz JSON gövdesi.' }, 400, origin)
  }

  const model = payload.model ?? 'claude-sonnet-5'
  if (!ALLOWED_MODELS.has(model)) {
    return json({ error: `Desteklenmeyen model: ${model}` }, 400, origin)
  }
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return json({ error: 'messages alanı zorunlu.' }, 400, origin)
  }

  const body = {
    model,
    max_tokens: Math.min(payload.max_tokens ?? 8000, MAX_TOKENS_CAP),
    system: payload.system ?? '',
    messages: payload.messages,
    ...(Array.isArray(payload.tools) && payload.tools.length ? { tools: payload.tools } : {}),
  }

  let upstream: Response
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })
  } catch {
    return json({ error: 'Anthropic API\'ye ulaşılamadı.' }, 502, origin)
  }

  const text = await upstream.text()
  return new Response(text, {
    status: upstream.status,
    headers: { ...corsHeaders(origin), 'content-type': 'application/json' },
  })
})
