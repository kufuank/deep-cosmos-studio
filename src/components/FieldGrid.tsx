import { useState } from 'react'
import type { CardFields, CardSchema, FieldState } from '../schemas'

const STATE_STYLE: Record<FieldState, { dot: string; label: string }> = {
  confirmed: { dot: 'bg-emerald-400', label: 'onaylı' },
  inferred: { dot: 'bg-amber-400', label: 'çıkarım' },
  missing: { dot: 'bg-slate-700', label: 'boş' },
}

export function FieldGrid({
  schema,
  fields,
  locked,
  onChange,
}: {
  schema: CardSchema
  fields: CardFields
  locked: boolean
  onChange: (key: string, value: string) => void
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(schema.sections.map((s) => s.id)))

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="divide-y divide-edge">
      {schema.sections.map((section) => {
        const filled = section.fields.filter((f) => fields[f.key]?.value?.trim()).length
        const isOpen = open.has(section.id)
        return (
          <section key={section.id}>
            <button
              onClick={() => toggle(section.id)}
              className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-slate-600 text-xs">{isOpen ? '▾' : '▸'}</span>
                <span className="text-xs font-semibold tracking-wide text-slate-300 truncate">
                  {section.title}
                </span>
              </span>
              <span className="nums text-[11px] text-slate-500 shrink-0">
                {filled}/{section.fields.length}
              </span>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 space-y-3">
                {section.fields.map((f) => {
                  const cur = fields[f.key]
                  const state: FieldState = cur?.value?.trim() ? cur.state : 'missing'
                  const style = STATE_STYLE[state]
                  return (
                    <div key={f.key}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${style.dot}`} />
                        <label className="text-xs font-medium text-slate-400">{f.label}</label>
                        <span className="text-[10px] text-slate-600">{style.label}</span>
                      </div>
                      {f.multiline ? (
                        <textarea
                          className="input min-h-[72px] resize-y"
                          placeholder={f.hint}
                          value={cur?.value ?? ''}
                          disabled={locked}
                          onChange={(e) => onChange(f.key, e.target.value)}
                        />
                      ) : (
                        <input
                          className="input"
                          placeholder={f.hint}
                          value={cur?.value ?? ''}
                          disabled={locked}
                          onChange={(e) => onChange(f.key, e.target.value)}
                        />
                      )}
                      {cur?.reasoning && (
                        <p className="mt-1 text-[11px] text-amber-400/70 leading-relaxed">
                          {cur.reasoning}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
