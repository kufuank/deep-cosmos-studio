import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import type { CardRow, ChatEntry, WorldRow } from './lib/supabase'
import { cardOrder, schemas } from './schemas'
import type { CardFields, CardType } from './schemas'
import { runAgentTurn, applyUpdates } from './agents/runner'
import { useSettings } from './lib/settings'
import { AnthropicError } from './lib/anthropic'
import { Auth } from './components/Auth'
import { Settings } from './components/Settings'
import { CardWorkspace } from './components/CardWorkspace'

function childType(t: CardType): CardType | null {
  const i = cardOrder.indexOf(t)
  return i >= 0 && i < cardOrder.length - 1 ? cardOrder[i + 1] : null
}

/** Best-guess title for a card, taken from its name field. */
const TITLE_KEY: Record<CardType, string> = {
  planet: 'planet_name',
  ecosystem: 'ecosystem_name',
  species: 'species_name',
  location: 'location_name',
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!ready) {
    return <div className="min-h-screen grid place-items-center text-slate-600 text-sm">Yükleniyor…</div>
  }
  if (!session) return <Auth />
  return <Studio session={session} />
}

function Studio({ session }: { session: Session }) {
  const { apiKey, model } = useSettings()
  const [worlds, setWorlds] = useState<WorldRow[]>([])
  const [worldId, setWorldId] = useState<string | null>(null)
  const [cards, setCards] = useState<CardRow[]>([])
  const [cardId, setCardId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [loading, setLoading] = useState(true)

  const saveTimer = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const loadWorlds = useCallback(async () => {
    const { data, error } = await supabase
      .from('dc_worlds')
      .select('*')
      .order('updated_at', { ascending: false })
    if (error) {
      setError(error.message)
      return
    }
    setWorlds(data ?? [])
    setLoading(false)
    if (!worldId && data?.length) setWorldId(data[0].id)
  }, [worldId])

  useEffect(() => {
    void loadWorlds()
    // Intentionally once — worlds reload explicitly after mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!worldId) {
      setCards([])
      return
    }
    void (async () => {
      const { data, error } = await supabase
        .from('dc_cards')
        .select('*')
        .eq('world_id', worldId)
        .order('created_at', { ascending: true })
      if (error) {
        setError(error.message)
        return
      }
      const rows = (data ?? []) as CardRow[]
      setCards(rows)
      setCardId((prev) => (rows.some((c) => c.id === prev) ? prev : (rows[0]?.id ?? null)))
    })()
  }, [worldId])

  const card = useMemo(() => cards.find((c) => c.id === cardId) ?? null, [cards, cardId])

  /** Walk parent_id up the chain and collect each ancestor's fields. */
  const ancestors = useMemo(() => {
    const out: Partial<Record<CardType, CardFields>> = {}
    if (!card) return out
    let cur = card.parent_id ? cards.find((c) => c.id === card.parent_id) : undefined
    let guard = 0
    while (cur && guard++ < 8) {
      out[cur.type] = cur.fields
      cur = cur.parent_id ? cards.find((c) => c.id === cur!.parent_id) : undefined
    }
    return out
  }, [card, cards])

  async function createWorld() {
    const { data, error } = await supabase
      .from('dc_worlds')
      .insert({ owner: session.user.id, name: 'Yeni Dünya' })
      .select()
      .single()
    if (error || !data) {
      setError(error?.message ?? 'Dünya oluşturulamadı.')
      return
    }
    setWorlds((w) => [data as WorldRow, ...w])
    setWorldId(data.id)
    await createCard('planet', null, data.id)
  }

  async function createCard(type: CardType, parentId: string | null, forWorld?: string) {
    const wid = forWorld ?? worldId
    if (!wid) return
    const { data, error } = await supabase
      .from('dc_cards')
      .insert({ world_id: wid, owner: session.user.id, type, parent_id: parentId })
      .select()
      .single()
    if (error || !data) {
      setError(error?.message ?? 'Kart oluşturulamadı.')
      return
    }
    setCards((c) => [...c, data as CardRow])
    setCardId(data.id)
  }

  /** Debounced persistence — the field grid fires on every keystroke. */
  function persistCard(id: string, patch: Partial<CardRow>, immediate = false) {
    const run = async () => {
      setSaving(true)
      const { error } = await supabase.from('dc_cards').update(patch).eq('id', id)
      setSaving(false)
      if (error) setError(error.message)
    }
    clearTimeout(saveTimer.current[id])
    if (immediate) void run()
    else saveTimer.current[id] = setTimeout(run, 700)
  }

  function updateCardLocal(id: string, mut: (c: CardRow) => CardRow) {
    setCards((cs) => cs.map((c) => (c.id === id ? mut(c) : c)))
  }

  function onFieldChange(key: string, value: string) {
    if (!card) return
    const nextFields: CardRow['fields'] = {
      ...card.fields,
      [key]: { value, state: 'confirmed' },
    }
    const title = key === TITLE_KEY[card.type] ? value : card.title
    updateCardLocal(card.id, (c) => ({ ...c, fields: nextFields, title }))
    persistCard(card.id, { fields: nextFields, title })
  }

  async function onSend(text: string) {
    if (!card) return
    if (!apiKey) {
      setShowSettings(true)
      setError('Önce Anthropic API anahtarınızı girin.')
      return
    }
    setError(null)
    setBusy(true)

    const userEntry: ChatEntry = { role: 'user', text, at: new Date().toISOString() }
    updateCardLocal(card.id, (c) => ({ ...c, chat: [...c.chat, userEntry] }))

    try {
      // History is text-only: the system prompt is rebuilt each turn with the
      // full current sheet state, so tool blocks need not persist.
      const history = card.chat.map((m) => ({ role: m.role, content: m.text }))

      const res = await runAgentTurn({
        apiKey,
        model,
        type: card.type,
        fields: card.fields,
        ancestors,
        history,
        userMessage: text,
      })

      const nextFields = applyUpdates(card.fields, res.updates)
      const titleUpdate = res.updates.find((u) => u.key === TITLE_KEY[card.type])
      const title = titleUpdate ? titleUpdate.value : card.title

      const assistantEntry: ChatEntry = {
        role: 'assistant',
        text: res.text || '(Ajan yalnızca alanları güncelledi.)',
        wrote: res.updates.map((u) => u.key),
        at: new Date().toISOString(),
      }
      const nextChat = [...card.chat, userEntry, assistantEntry]

      updateCardLocal(card.id, (c) => ({ ...c, fields: nextFields, chat: nextChat, title }))
      persistCard(card.id, { fields: nextFields, chat: nextChat, title }, true)
    } catch (e) {
      setError(
        e instanceof AnthropicError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Beklenmeyen bir hata oluştu.',
      )
      // Drop the optimistic user bubble so the message can be retried cleanly.
      updateCardLocal(card.id, (c) => ({ ...c, chat: c.chat.slice(0, -1) }))
    } finally {
      setBusy(false)
    }
  }

  async function onToggleLock() {
    if (!card) return
    const next = card.status === 'locked' ? 'draft' : 'locked'
    updateCardLocal(card.id, (c) => ({ ...c, status: next }))
    const { error } = await supabase
      .from('dc_cards')
      .update({ status: next, locked_at: next === 'locked' ? new Date().toISOString() : null })
      .eq('id', card.id)
    if (error) setError(error.message)
  }

  async function deleteWorld(id: string) {
    const { error } = await supabase.from('dc_worlds').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    setWorlds((w) => w.filter((x) => x.id !== id))
    if (worldId === id) setWorldId(null)
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="shrink-0 flex items-center justify-between gap-4 px-4 h-14 border-b border-edge">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-semibold text-slate-100">Deep Cosmos Studio</span>
          <select
            className="input py-1 w-auto max-w-[240px] text-xs"
            value={worldId ?? ''}
            onChange={(e) => setWorldId(e.target.value || null)}
          >
            {worlds.length === 0 && <option value="">— dünya yok —</option>}
            {worlds.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button className="btn-ghost py-1 text-xs" onClick={createWorld}>
            + Dünya
          </button>
        </div>

        <div className="flex items-center gap-2">
          {!apiKey && (
            <span className="text-[11px] text-amber-400">API anahtarı gerekli</span>
          )}
          <button className="btn-ghost py-1 text-xs" onClick={() => setShowSettings(true)}>
            Ayarlar
          </button>
          <button
            className="btn-ghost py-1 text-xs"
            onClick={() => supabase.auth.signOut()}
            title={session.user.email ?? ''}
          >
            Çıkış
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* Card chain sidebar */}
        <aside className="w-60 shrink-0 border-r border-edge overflow-auto p-3">
          {loading ? (
            <p className="text-xs text-slate-600">Yükleniyor…</p>
          ) : !worldId ? (
            <div className="text-xs text-slate-500 leading-relaxed">
              <p className="mb-3">Henüz bir dünya yok.</p>
              <button className="btn-primary w-full text-xs" onClick={createWorld}>
                İlk dünyayı oluştur
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                {cardOrder.map((t) => {
                  const group = cards.filter((c) => c.type === t)
                  if (!group.length) return null
                  return (
                    <div key={t} className="mb-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-600 mb-1 px-1">
                        {schemas[t].label}
                      </p>
                      {group.map((c) => {
                        const ct = childType(c.type)
                        return (
                          <div key={c.id}>
                            <button
                              onClick={() => setCardId(c.id)}
                              className={`w-full text-left px-2 py-1.5 rounded text-xs truncate transition-colors ${
                                cardId === c.id
                                  ? 'bg-sky-500/15 text-sky-200'
                                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                              }`}
                            >
                              {c.status === 'locked' && <span className="text-emerald-400 mr-1">●</span>}
                              {c.title || `İsimsiz ${schemas[c.type].label}`}
                            </button>
                            {ct && (
                              <button
                                onClick={() => createCard(ct, c.id)}
                                className="ml-2 mt-0.5 mb-1 text-[10px] text-slate-600 hover:text-sky-400"
                              >
                                + {schemas[ct].label} ekle
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>

              {cards.length === 0 && (
                <button className="btn-ghost w-full text-xs" onClick={() => createCard('planet', null)}>
                  + Gezegen kartı
                </button>
              )}

              <button
                onClick={() => worldId && deleteWorld(worldId)}
                className="mt-6 w-full text-[11px] text-slate-700 hover:text-red-400"
              >
                Bu dünyayı sil
              </button>
            </>
          )}
        </aside>

        <main className="flex-1 min-w-0 min-h-0">
          {card ? (
            <CardWorkspace
              card={card}
              ancestors={ancestors}
              busy={busy}
              error={error}
              saving={saving}
              onFieldChange={onFieldChange}
              onSend={onSend}
              onToggleLock={onToggleLock}
            />
          ) : (
            <div className="h-full grid place-items-center text-sm text-slate-600">
              Soldan bir kart seçin veya yeni bir dünya oluşturun.
            </div>
          )}
        </main>
      </div>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  )
}
