import { useMemo, useState } from 'react'
import { buildPrompts } from '../lib/prompt'
import type { PromptContext, PromptKind } from '../lib/prompt'
import { CopyButton } from './CopyButton'

const TABS: { kind: PromptKind; label: string }[] = [
  { kind: 'sheet', label: 'Kimlik Sayfası' },
  { kind: 'still', label: 'Tek Kare Görsel' },
  { kind: 'video', label: 'Video' },
]

export function PromptPanel({ ctx }: { ctx: PromptContext }) {
  const prompts = useMemo(() => buildPrompts(ctx), [ctx])
  const [active, setActive] = useState<PromptKind>('sheet')
  const current = prompts.find((p) => p.kind === active)!

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 p-2 border-b border-edge shrink-0">
        {TABS.map((t) => (
          <button
            key={t.kind}
            onClick={() => setActive(t.kind)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              active === t.kind
                ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                : 'text-slate-400 border border-transparent hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-4 py-3 border-b border-edge shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200">{current.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">{current.note}</p>
          </div>
          <CopyButton text={current.text} label="Prompt'u kopyala" />
        </div>
        {current.missing.length > 0 && (
          <p className="mt-2 text-xs text-amber-400/90">
            {current.missing.length} alan hâlâ boş — prompt kullanılabilir ama eksik.{' '}
            <span className="text-amber-500/60">
              ({current.missing.slice(0, 4).join(', ')}
              {current.missing.length > 4 ? '…' : ''})
            </span>
          </p>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        <pre className="text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap font-mono">
          {current.text}
        </pre>
      </div>
    </div>
  )
}
