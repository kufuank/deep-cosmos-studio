import { useMemo, useState } from 'react'
import { schemas, fieldStats, isSceneCard } from '../schemas'
import type { CardFields, CardType, Scene } from '../schemas'
import type { ShotListRow } from '../lib/supabase'
import { SceneList } from './SceneList'
import type { CardRow, MessageRow } from '../lib/supabase'
import { FieldGrid } from './FieldGrid'
import { ChatPanel } from './ChatPanel'
import { PromptPanel } from './PromptPanel'

type Pane = 'chat' | 'fields' | 'prompts'

export function CardWorkspace({
  card,
  messages,
  ancestors,
  busy,
  streamText,
  status,
  lastUsage,
  error,
  saving,
  shotLists,
  onFieldChange,
  onSceneChange,
  onShotListChange,
  onSend,
  onToggleLock,
}: {
  card: CardRow
  shotLists: ShotListRow[]
  onSceneChange: (index: number, patch: Partial<Scene>) => void
  onShotListChange: (id: string | null) => void
  messages: MessageRow[]
  ancestors: Partial<Record<CardType, CardFields>>
  busy: boolean
  streamText: string
  status: string | null
  lastUsage: string | null
  error: string | null
  saving: boolean
  onFieldChange: (key: string, value: string) => void
  onSend: (text: string) => void
  onToggleLock: () => void
}) {
  const schema = schemas[card.type]
  const locked = card.status === 'locked'
  const stats = useMemo(() => fieldStats(schema, card.fields), [schema, card.fields])
  const [pane, setPane] = useState<Pane>('chat')

  const scenes = (card.scenes ?? []) as Scene[]
  const sceneCard = isSceneCard(card.type)

  const ctx = useMemo(
    () => ({ type: card.type, fields: card.fields, ancestors, scenes }),
    [card.type, card.fields, ancestors, scenes],
  )

  const pct = Math.round((stats.resolved / stats.total) * 100)

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <header className="shrink-0 border-b border-edge px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-100 truncate">
                {card.title || `İsimsiz ${schema.label}`}
              </h2>
              {locked && (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                  kilitli
                </span>
              )}
            </div>
            <p className="nums text-xs text-slate-500 mt-0.5">
              {stats.resolved}/{stats.total} alan · {stats.confirmed} onaylı · {stats.inferred} çıkarım
              {sceneCard && <span className="ml-2">· {scenes.length} sahne</span>}
              {saving && <span className="ml-2 text-slate-600">kaydediliyor…</span>}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {sceneCard && (
              <span className="text-[11px] text-slate-500 nums" title="Ajan, Shot Library'deki tüm listeleri tarayıp sekansı kendisi seçer">
                {card.shot_list_id && card.sequence_start != null && card.sequence_end != null
                  ? `Seçilen sekans: ${shotLists.find((l) => l.id === card.shot_list_id)?.title ?? '?'} · plan ${card.sequence_start + 1}–${card.sequence_end + 1}`
                  : card.shot_list_id
                    ? `Liste sabitlendi: ${shotLists.find((l) => l.id === card.shot_list_id)?.title ?? '?'} · sekans henüz seçilmedi`
                    : 'Sekans henüz seçilmedi — ajan tüm kütüphaneyi tarar'}
              </span>
            )}
            {sceneCard && (
              <select
                className="input py-1 w-auto max-w-[220px] text-xs"
                value={card.shot_list_id ?? ''}
                disabled={locked}
                onChange={(e) => onShotListChange(e.target.value || null)}
                title="İsteğe bağlı: ajanı tek bir listeyle sınırlamak için seçin; boş bırakırsanız tüm kütüphane taranır"
              >
                <option value="">— tüm kütüphane —</option>
                {shotLists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
            )}
            <button
              className="btn-ghost"
              onClick={() => {
                // Locking an empty sheet freezes it before the agent can fill it,
                // and then every turn is silently rejected.
                if (!locked && stats.resolved === 0) {
                  const ok = window.confirm(
                    'Bu kartta hiç dolu alan yok. Kilitlerseniz ajan alan yazamaz ve sohbet ilerlemez. Yine de kilitlensin mi?',
                  )
                  if (!ok) return
                }
                onToggleLock()
              }}
              title={locked ? 'Alanları yeniden düzenlemek için açın' : 'Onayladığınızda alanları dondurur'}
            >
              {locked ? 'Kilidi aç' : 'Kartı kilitle'}
            </button>
          </div>
        </div>

        <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full bg-sky-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </header>

      {/* Pane switcher — single column below xl, three columns above */}
      <div className="shrink-0 flex gap-1 px-4 py-2 border-b border-edge xl:hidden">
        {(['chat', 'fields', 'prompts'] as Pane[]).map((p) => (
          <button
            key={p}
            onClick={() => setPane(p)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${
              pane === p ? 'bg-white/10 text-slate-100' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {p === 'chat' ? 'Sohbet' : p === 'fields' ? (sceneCard ? 'Sahneler' : 'Alanlar') : 'Promptlar'}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)] xl:divide-x xl:divide-edge">
        <div className={`h-full min-h-0 ${pane === 'chat' ? 'block' : 'hidden'} xl:block`}>
          <ChatPanel
            type={card.type}
            chat={messages}
            busy={busy}
            streamText={streamText}
            status={status}
            lastUsage={lastUsage}
            error={error}
            locked={locked}
            onSend={onSend}
          />
        </div>

        <div className={`h-full min-h-0 overflow-auto ${pane === 'fields' ? 'block' : 'hidden'} xl:block`}>
          <FieldGrid schema={schema} fields={card.fields} locked={locked} onChange={onFieldChange} />
          {sceneCard && (
            <div className="border-t border-edge">
              <SceneList scenes={scenes} ctx={ctx} locked={locked} onChange={onSceneChange} />
            </div>
          )}
        </div>

        <div className={`h-full min-h-0 ${pane === 'prompts' ? 'block' : 'hidden'} xl:block`}>
          <PromptPanel ctx={ctx} />
        </div>
      </div>
    </div>
  )
}
