import type { ProposalRow } from '../lib/supabase'
import { schemas } from '../schemas'

/**
 * Pending protocol improvements. The source documents are explicit that a
 * protocol only changes after the user approves, so nothing here applies itself.
 */
export function ProposalPanel({
  proposals,
  onDecide,
}: {
  proposals: ProposalRow[]
  onDecide: (p: ProposalRow, approve: boolean) => void
}) {
  if (!proposals.length) return null

  return (
    <div className="border-b border-edge bg-amber-500/[0.06] px-4 py-3 space-y-3">
      {proposals.map((p) => (
        <div key={p.id} className="space-y-1.5">
          <p className="text-xs font-medium text-amber-300">
            Protokol iyileştirme önerisi — {schemas[p.agent]?.label ?? p.agent} ajanı
          </p>
          <p className="text-sm text-slate-200 leading-relaxed">{p.proposed_protocol}</p>
          {p.rationale && (
            <p className="text-xs text-slate-400 leading-relaxed">
              <span className="text-slate-500">Gerekçe: </span>
              {p.rationale}
            </p>
          )}
          {p.expected_benefit && (
            <p className="text-xs text-slate-400 leading-relaxed">
              <span className="text-slate-500">Beklenen fayda: </span>
              {p.expected_benefit}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button className="btn-primary text-xs py-1" onClick={() => onDecide(p, true)}>
              Onayla ve protokole ekle
            </button>
            <button className="btn-ghost text-xs py-1" onClick={() => onDecide(p, false)}>
              Reddet
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
