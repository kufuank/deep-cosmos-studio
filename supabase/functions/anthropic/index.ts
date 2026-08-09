/**
 * Authenticated Anthropic proxy.
 *
 * The frontend is a public static site, so it must never hold the API key.
 *
 * Two gates, and both are needed:
 *
 * 1. Supabase's own verify_jwt is not sufficient — the publishable key ships in
 *    the public bundle and the gateway accepts it, so every request is resolved
 *    to a real signed-in user against the Auth API.
 *
 * 2. Being signed in is not the same as being allowed to spend. Signup was open
 *    on a public URL, and strangers registered and ran up real cost. Spend is
 *    therefore gated on an allowlist held in the database. It fails closed: if
 *    the list cannot be read, the request is denied rather than waved through.
 *    Because failing closed would lock out everyone if the service role key were
 *    missing, GET reports whether the list is readable.
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
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'vary': 'origin',
  }
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'content-type': 'application/json' },
  })
}

/** Resolves the bearer token to a real user, or null if it is not a user session. */
async function resolveUser(req: Request): Promise<{ id: string; email: string } | null> {
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
    const user = (await res.json()) as { id?: string; email?: string }
    if (!user?.id) return null
    return { id: user.id, email: (user.email ?? '').toLowerCase() }
  } catch {
    return null
  }
}

/** Reads the allowlist. Returns null when the list itself cannot be reached. */
async function allowlistLookup(email: string | null): Promise<boolean | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !service) return null

  const filter = email ? `&email=eq.${encodeURIComponent(email)}` : '&limit=1'
  try {
    const res = await fetch(`${url}/rest/v1/dc_allowed_users?select=email${filter}`, {
      headers: { apikey: service, authorization: `Bearer ${service}` },
    })
    if (!res.ok) return null
    const rows = (await res.json()) as unknown[]
    if (!Array.isArray(rows)) return null
    return email ? rows.length > 0 : true
  } catch {
    return null
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  // Configuration check. Booleans only — never a key, never an email.
  if (req.method === 'GET') {
    const reachable = await allowlistLookup(null)
    return json(
      {
        ok: true,
        key_configured: Boolean(Deno.env.get('ANTHROPIC_API_KEY')),
        allowlist_readable: reachable === true,
      },
      200,
      origin,
    )
  }

  if (req.method !== 'POST') {
    return json({ error: 'Yalnızca POST veya GET destekleniyor.' }, 405, origin)
  }

  const user = await resolveUser(req)
  if (!user) {
    return json({ error: 'Oturum gerekli. Lütfen giriş yapın.' }, 401, origin)
  }

  const allowed = await allowlistLookup(user.email)
  if (allowed !== true) {
    return json(
      {
        error:
          allowed === null
            ? 'Yetki listesi okunamadı, istek güvenlik gereği reddedildi. Sunucu yapılandırmasını kontrol edin.'
            : 'Bu hesap bu uygulamayı kullanmaya yetkili değil. Erişim için proje sahibiyle iletişime geçin.',
      },
      403,
      origin,
    )
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
    stream?: boolean
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

  const stream = payload.stream === true
  const body = {
    model,
    max_tokens: Math.min(payload.max_tokens ?? 8000, MAX_TOKENS_CAP),
    system: payload.system ?? '',
    messages: payload.messages,
    ...(Array.isArray(payload.tools) && payload.tools.length ? { tools: payload.tools } : {}),
    ...(stream ? { stream: true } : {}),
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

  // Streaming responses are piped straight through. A full turn can take well
  // over a minute, so the client needs tokens as they are produced rather than
  // a single blocking response.
  if (stream && upstream.ok && upstream.body) {
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders(origin),
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    })
  }

  const text = await upstream.text()
  return new Response(text, {
    status: upstream.status,
    headers: { ...corsHeaders(origin), 'content-type': 'application/json' },
  })
})
