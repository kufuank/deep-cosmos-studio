import { useEffect, useState } from 'react'
import { useSettings } from '../lib/settings'
import { MODELS, EFFORTS } from '../lib/anthropic'
import type { Effort } from '../lib/anthropic'
import { loadAgentConfig } from '../agents/config'
import { cardOrder, schemas } from '../schemas'
import type { CardType } from '../schemas'

export function Settings({ onClose }: { onClose: () => void }) {
  const { model, setModel, effort, setEffort } = useSettings()
  const [versions, setVersions] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const entries = await Promise.all(
        cardOrder.map(async (t: CardType) => {
          const c = await loadAgentConfig(t)
          return [t, c.fallback ? 'yerel kopya' : `v${c.version}`] as const
        }),
      )
      if (alive) setVersions(Object.fromEntries(entries))
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div className="card w-full max-w-md p-5 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-semibold text-slate-100">Ayarlar</h2>
        </div>

        <div>
          <label className="label">Model</label>
          <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Düşünme derinliği</label>
          <select
            className="input"
            value={effort}
            onChange={(e) => setEffort(e.target.value as Effort)}
          >
            {EFFORTS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-600">
            {EFFORTS.find((o) => o.id === effort)?.hint} Model her turda kendi kendine düşünür
            ve bu düşünme çıktı token’ı olarak ücretlendirilir; en büyük maliyet kalemi budur.
          </p>
        </div>

        <div>
          <label className="label">Protokol sürümleri</label>
          <div className="rounded-md border border-edge divide-y divide-edge">
            {cardOrder.map((t) => (
              <div key={t} className="flex items-center justify-between px-3 py-1.5">
                <span className="text-xs text-slate-400">{schemas[t].label}</span>
                <span className="text-xs text-slate-500 nums">
                  {versions ? versions[t] : '…'}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-600">
            Protokoller veritabanında tutulur. “yerel kopya”, veritabanına ulaşılamadığında
            kaynak dokümanlardan aktarılan yedeğin kullanıldığı anlamına gelir.
          </p>
        </div>

        <div>
          <label className="label">API anahtarı</label>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Anahtar sunucuda tutuluyor, tarayıcınızda saklanmıyor. Değiştirmek için Supabase
            panelinden <code className="text-slate-400">ANTHROPIC_API_KEY</code> secret’ını
            güncelleyin.
          </p>
        </div>

        <div className="flex justify-end pt-1">
          <button className="btn-primary" onClick={onClose}>
            Kapat
          </button>
        </div>
      </div>
    </div>
  )
}
