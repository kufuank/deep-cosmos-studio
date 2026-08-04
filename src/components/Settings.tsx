import { useState } from 'react'
import { useSettings } from '../lib/settings'
import { MODELS } from '../lib/anthropic'

export function Settings({ onClose }: { onClose: () => void }) {
  const { apiKey, model, setApiKey, setModel } = useSettings()
  const [draft, setDraft] = useState(apiKey)

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div className="card w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-semibold text-slate-100">Ayarlar</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Anahtar yalnızca bu tarayıcıda saklanır, sunucuya gönderilmez.
          </p>
        </div>

        <div>
          <label className="label">Anthropic API anahtarı</label>
          <input
            className="input font-mono text-xs"
            type="password"
            placeholder="sk-ant-…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-slate-600">
            console.anthropic.com → API Keys üzerinden alabilirsiniz.
          </p>
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

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>
            Kapat
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              setApiKey(draft.trim())
              onClose()
            }}
          >
            Kaydet
          </button>
        </div>
      </div>
    </div>
  )
}
