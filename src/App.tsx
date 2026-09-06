import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import type { CardRow, MessageRow, ProposalRow, ShotListRow, ShotRow, WorldRow } from './lib/supabase'
import { cardOrder, schemas } from './schemas'
import type { CardFields, CardType, Scene } from './schemas'
import { runAgentTurn, applyUpdates } from './agents/runner'
import type { LibraryList, SequenceSelection } from './agents/runner'
import { clearAgentConfigCache } from './agents/config'
import { useSettings } from './lib/settings'
import { describeError } from './lib/errors'
import { recordUsage, describeUsage } from './lib/usage'
import { Auth } from './components/Auth'
import { ResetPassword } from './components/ResetPassword'
import { Settings } from './components/Settings'
import { CardWorkspace } from './components/CardWorkspace'
import { ProposalPanel } from './components/ProposalPanel'
import { ShotLibrary } from './components/ShotLibrary'

type View = 'worlds' | 'shots'

function childType(t: CardType): CardType | null {
  const i = cardOrder.indexOf(t)
  return i >= 0 && i < cardOrder.length - 1 ? cardOrder[i + 1] : null
}

/** The field whose value names the card. */
const TITLE_KEY: Record<CardType, string> = {
  planet: 'planet_name',
  ecosystem: 'ecosystem_name',
  species: 'species_name',
  location: 'location_name',
  storyboard: 'storyboard_title',
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    // A recovery link arrives as a URL fragment. Read it before the client
    // strips it, so a reload mid-reset does not silently drop the user onto the
    // sign-in form with no explanation.
    if (window.location.hash.includes('type=recovery')) setRecovering(true)

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      setSession(s)
      clearAgentConfigCache()
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!ready) {
    return (
      <div className="min-h-screen grid place-items-center text-slate-600 text-sm">Yükleniyor…</div>
    )
  }
  if (recovering) {
    return (
      <ResetPassword
        onDone={() => {
          // Clear the recovery fragment so a refresh does not reopen this screen.
          window.history.replaceState(null, '', window.location.pathname)
          setRecovering(false)
        }}
      />
    )
  }
  if (!session) return <Auth />
  return <Studio session={session} />
}

function Studio({ session }: { session: Session }) {
  const { model, effort } = useSettings()
  const [worlds, setWorlds] = useState<WorldRow[]>([])
  const [worldId, setWorldId] = useState<string | null>(null)
  const [cards, setCards] = useState<CardRow[]>([])
  const [cardId, setCardId] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [busy, setBusy] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [lastUsage, setLastUsage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('worlds')

  const [proposals, setProposals] = useState<ProposalRow[]>([])
  const [shotLists, setShotLists] = useState<ShotListRow[]>([])
  const saveTimer = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const loadProposals = useCallback(async () => {
    const { data } = await supabase
      .from('dc_protocol_proposals')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setProposals((data ?? []) as ProposalRow[])
  }, [])

  useEffect(() => {
    void loadProposals()
  }, [loadProposals])

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('dc_shot_lists')
        .select('*')
        .order('created_at', { ascending: false })
      setShotLists((data ?? []) as ShotListRow[])
    })()
  }, [])

  async function decideProposal(p: ProposalRow, approve: boolean) {
    if (approve) {
      // Approval appends the rule to the agent's protocol as a new active
      // version; the previous one is retired rather than overwritten.
      const { data: current } = await supabase
        .from('dc_agents')
        .select('*')
        .eq('agent', p.agent)
        .eq('active', true)
        .order('owner', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()

      if (current) {
        await supabase
          .from('dc_agents')
          .update({ active: false })
          .eq('owner', session.user.id)
          .eq('agent', p.agent)

        const { error: insErr } = await supabase.from('dc_agents').insert({
          owner: session.user.id,
          agent: p.agent,
          version: (current.version ?? 1) + 1,
          active: true,
          role: current.role,
          knowledge: current.knowledge,
          protocol: `${current.protocol}\n\nEK KURAL (onaylanan iyileştirme)\n${p.proposed_protocol}`,
          note: p.rationale,
        })
        if (insErr) {
          setError(describeError(insErr))
          return
        }
        clearAgentConfigCache()
      }
    }

    await supabase
      .from('dc_protocol_proposals')
      .update({ status: approve ? 'approved' : 'rejected', decided_at: new Date().toISOString() })
      .eq('id', p.id)
    void loadProposals()
  }

  const loadWorlds = useCallback(async () => {
    const { data, error } = await supabase
      .from('dc_worlds')
      .select('*')
      .order('updated_at', { ascending: false })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setWorlds(data ?? [])
    setWorldId((prev) => prev ?? data?.[0]?.id ?? null)
  }, [])

  useEffect(() => {
    void loadWorlds()
  }, [loadWorlds])

  // Cards for the active world
  useEffect(() => {
    if (!worldId) {
      setCards([])
      setCardId(null)
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

  // Messages for the active card
  useEffect(() => {
    if (!cardId) {
      setMessages([])
      return
    }
    let alive = true
    void (async () => {
      const { data, error } = await supabase
        .from('dc_messages')
        .select('*')
        .eq('card_id', cardId)
        .order('created_at', { ascending: true })
      if (!alive) return
      if (error) {
        setError(error.message)
        return
      }
      setMessages((data ?? []) as MessageRow[])
    })()
    return () => {
      alive = false
    }
  }, [cardId])

  const card = useMemo(() => cards.find((c) => c.id === cardId) ?? null, [cards, cardId])

  /** Walk parent_id up the chain and collect each ancestor's fields. */
  const ancestors = useMemo(() => {
    const out: Partial<Record<CardType, CardFields>> = {}
    if (!card) return out
    let cur = card.parent_id ? cards.find((c) => c.id === card.parent_id) : undefined
    let guard = 0
    while (cur && guard++ < 8) {
      out[cur.type] = cur.fields
      const parentId: string | null = cur.parent_id
      cur = parentId ? cards.find((c) => c.id === parentId) : undefined
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
      if (error) {
        // A rejected write used to vanish silently, leaving the screen showing
        // values the database never accepted.
        setError(`Kaydedilemedi — ${describeError(error)}`)
        void reloadCard(id)
      }
    }
    clearTimeout(saveTimer.current[id])
    if (immediate) void run()
    else saveTimer.current[id] = setTimeout(run, 700)
  }

  function updateCardLocal(id: string, mut: (c: CardRow) => CardRow) {
    setCards((cs) => cs.map((c) => (c.id === id ? mut(c) : c)))
  }

  /** Pulls the stored row back after a failed write, so the UI tells the truth. */
  async function reloadCard(id: string) {
    const { data } = await supabase.from('dc_cards').select('*').eq('id', id).maybeSingle()
    if (data) setCards((cs) => cs.map((c) => (c.id === id ? (data as CardRow) : c)))
  }

  function onFieldChange(key: string, value: string) {
    if (!card) return
    const nextFields: CardFields = {
      ...card.fields,
      [key]: { value, state: 'confirmed' },
    }
    const title = key === TITLE_KEY[card.type] ? value : card.title
    updateCardLocal(card.id, (c) => ({ ...c, fields: nextFields, title }))
    persistCard(card.id, { fields: nextFields, title })
  }

  function onSceneChange(index: number, patch: Partial<Scene>) {
    if (!card) return
    const next = (card.scenes ?? []).map((s, i) => (i === index ? { ...s, ...patch } : s))
    updateCardLocal(card.id, (c) => ({ ...c, scenes: next }))
    persistCard(card.id, { scenes: next })
  }

  /** Manual override: pins a list, clears the agent's shot range. */
  function onShotListChange(id: string | null) {
    if (!card) return
    const patch = { shot_list_id: id, sequence_start: null, sequence_end: null }
    updateCardLocal(card.id, (c) => ({ ...c, ...patch }))
    persistCard(card.id, patch, true)
  }

  async function onSend(text: string) {
    if (!card) return
    setError(null)
    setBusy(true)
    setStreamText('')
    setStatus('Ajan düşünüyor')

    const optimistic: MessageRow = {
      id: `tmp-${Date.now()}`,
      card_id: card.id,
      owner: session.user.id,
      role: 'user',
      text,
      wrote: [],
      created_at: new Date().toISOString(),
    }
    setMessages((m) => [...m, optimistic])

    try {
      // History is text-only: the system prompt is rebuilt each turn with the
      // full current sheet state, so tool blocks need not persist.
      const history = messages.map((m) => ({ role: m.role, content: m.text }))

      // The storyboard adapts a real, measured sequence chosen from the WHOLE
      // library — every ready list, every shot — not from one user-picked list.
      // Without it the agent would have nothing to preserve and would invent.
      let shots: ShotRow[] = []
      let lists: LibraryList[] = []
      if (card.type === 'storyboard') {
        const { data: ls } = await supabase
          .from('dc_shot_lists')
          .select('id, title, duration_seconds')
          .in('status', ['ready', 'locked'])
          .order('created_at', { ascending: true })
        lists = (ls ?? []) as LibraryList[]
        if (lists.length) {
          const { data } = await supabase
            .from('dc_shots')
            .select('*')
            .in(
              'shot_list_id',
              lists.map((l) => l.id),
            )
            .order('shot_list_id', { ascending: true })
            .order('ordinal', { ascending: true })
          shots = (data ?? []) as ShotRow[]
        }
      }
      const selection: SequenceSelection | null =
        card.type === 'storyboard' &&
        card.shot_list_id &&
        card.sequence_start != null &&
        card.sequence_end != null
          ? { shot_list_id: card.shot_list_id, start: card.sequence_start, end: card.sequence_end }
          : null

      const startedAt = Date.now()
      const res = await runAgentTurn({
        model,
        type: card.type,
        fields: card.fields,
        shots,
        lists,
        selection,
        scenes: (card.scenes ?? []) as Scene[],
        ancestors,
        history,
        userMessage: text,
        locked: card.status === 'locked',
        effort,
        onText: (d) => setStreamText((t) => t + d),
        onStatus: setStatus,
      })

      const elapsed = Date.now() - startedAt
      recordUsage({
        kind: 'agent_turn',
        agent: card.type,
        cardId: card.id,
        model,
        effort,
        requests: res.requests,
        usage: res.usage,
        durationMs: elapsed,
      })
      setLastUsage(describeUsage(res.usage, res.requests, elapsed))

      if (res.proposal) {
        const { error: pErr } = await supabase.from('dc_protocol_proposals').insert({
          owner: session.user.id,
          agent: card.type,
          from_version: 0,
          proposed_protocol: res.proposal.proposed_change,
          rationale: res.proposal.rationale,
          expected_benefit: res.proposal.expected_benefit,
        })
        if (pErr) setError(describeError(pErr))
        else void loadProposals()
      }

      const nextFields = applyUpdates(card.fields, res.updates)
      const titleUpdate = res.updates.find((u) => u.key === TITLE_KEY[card.type])
      const title = titleUpdate ? titleUpdate.value : card.title
      const nextScenes = res.scenes ?? ((card.scenes ?? []) as Scene[])
      const seqPatch: Partial<CardRow> = res.sequence
        ? {
            shot_list_id: res.sequence.shot_list_id,
            sequence_start: res.sequence.start,
            sequence_end: res.sequence.end,
          }
        : {}

      updateCardLocal(card.id, (c) => ({ ...c, fields: nextFields, title, scenes: nextScenes, ...seqPatch }))
      persistCard(
        card.id,
        res.scenes
          ? { fields: nextFields, title, scenes: nextScenes, ...seqPatch }
          : { fields: nextFields, title, ...seqPatch },
        true,
      )

      const { data, error } = await supabase
        .from('dc_messages')
        // Every row must carry the same keys: in a multi-row insert PostgREST
        // builds one column list from the union of the objects and writes NULL
        // for any key a row omits, which a NOT NULL column then rejects.
        .insert([
          { card_id: card.id, owner: session.user.id, role: 'user', text, wrote: [] },
          {
            card_id: card.id,
            owner: session.user.id,
            role: 'assistant',
            text:
              res.text ||
              (res.updates.length
                ? `(Ajan ${res.updates.length} alanı güncelledi, ayrıca bir şey yazmadı.)`
                : card.status === 'locked'
                  ? '(Ajan bu turda ne bir şey yazdı ne de bir alan güncelledi. Kart kilitli — değişiklik için önce kilidi açın.)'
                  : '(Ajan bu turda ne bir şey yazdı ne de bir alan güncelledi. Lütfen tekrar deneyin; sorun sürerse isteği küçültün.)'),
            wrote: res.updates.map((u) => u.key),
          },
        ])
        .select()
      if (error) throw error

      // Swap the optimistic bubble for the persisted rows.
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), ...((data ?? []) as MessageRow[])])
    } catch (e) {
      setError(describeError(e))
      setMessages((m) => m.filter((x) => x.id !== optimistic.id))
    } finally {
      setBusy(false)
      setStreamText('')
      setStatus(null)
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

          <div className="flex gap-1">
            {([
              ['worlds', 'Dünyalar'],
              ['shots', 'Shot Library'],
            ] as [View, string][]).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  view === v
                    ? 'bg-white/10 text-slate-100'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {view === 'worlds' && (
            <>
              <select
                className="input py-1 w-auto max-w-[220px] text-xs"
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
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
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

      {view === 'shots' ? (
        <div className="flex-1 min-h-0">
          <ShotLibrary session={session} />
        </div>
      ) : (
      <div className="flex-1 min-h-0 flex">
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

        <main className="flex-1 min-w-0 min-h-0 flex flex-col">
          <ProposalPanel
            proposals={proposals.filter((p) => !card || p.agent === card.type)}
            onDecide={decideProposal}
          />
          {card ? (
            <CardWorkspace
              card={card}
              messages={messages}
              shotLists={shotLists}
              onSceneChange={onSceneChange}
              onShotListChange={onShotListChange}
              ancestors={ancestors}
              busy={busy}
              streamText={streamText}
              status={status}
              lastUsage={lastUsage}
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
      )}

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  )
}
