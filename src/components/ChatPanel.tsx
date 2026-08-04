import { useEffect, useRef, useState } from 'react'
import type { ChatEntry } from '../lib/supabase'
import { OPENING_HINT } from '../agents/instructions'
import type { CardType } from '../schemas'

export function ChatPanel({
  type,
  chat,
  busy,
  error,
  locked,
  onSend,
}: {
  type: CardType
  chat: ChatEntry[]
  busy: boolean
  error: string | null
  locked: boolean
  onSend: (text: string) => void
}) {
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat.length, busy])

  function submit() {
    const t = draft.trim()
    if (!t || busy || locked) return
    setDraft('')
    onSend(t)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {chat.length === 0 && (
          <div className="text-sm text-slate-500 leading-relaxed">
            <p className="text-slate-400 mb-2">{OPENING_HINT[type]}</p>
            <p className="text-xs">
              Ajan eksik alanları size sorarak dolduracak. Hazır olduğunuzda{' '}
              <span className="text-slate-400">“kalanları sen tamamla”</span> derseniz, geri kalan
              alanları gerekçeleriyle birlikte kendisi çıkarır.
            </p>
          </div>
        )}

        {chat.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[85%] rounded-lg bg-sky-500/15 border border-sky-500/25 px-3 py-2'
                  : 'max-w-[95%]'
              }
            >
              <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{m.text}</p>
              {m.wrote && m.wrote.length > 0 && (
                <p className="mt-2 text-[11px] text-emerald-400/80">
                  ✎ {m.wrote.length} alan yazıldı
                </p>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <p className="text-sm text-slate-500 animate-pulse">Ajan düşünüyor…</p>
        )}
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-edge p-3 shrink-0">
        {locked ? (
          <p className="text-xs text-slate-500 text-center py-2">
            Kart kilitli. Değişiklik için önce kilidi açın.
          </p>
        ) : (
          <div className="flex gap-2">
            <textarea
              className="input resize-none h-[76px]"
              placeholder="Mesajınızı yazın… (Enter ile gönder, Shift+Enter yeni satır)"
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
            />
            <button className="btn-primary self-end" onClick={submit} disabled={busy || !draft.trim()}>
              Gönder
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
