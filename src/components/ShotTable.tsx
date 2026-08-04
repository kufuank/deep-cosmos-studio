import type { ShotRow } from '../lib/supabase'
import { CopyButton } from './CopyButton'

const COLUMNS: { key: keyof ShotRow; label: string; badge?: boolean; wide?: boolean }[] = [
  { key: 'shot_type', label: 'Shot Type', badge: true },
  { key: 'camera_angle', label: 'Camera Angle', badge: true },
  { key: 'camera_movement', label: 'Camera Movement', wide: true },
  { key: 'lens', label: 'Lens', badge: true },
  { key: 'dof', label: 'DOF', badge: true },
  { key: 'main_subject', label: 'Main Subject' },
  { key: 'primary_action', label: 'Primary Action', wide: true },
  { key: 'foreground', label: 'Foreground' },
  { key: 'background', label: 'Background' },
  { key: 'composition', label: 'Composition', wide: true },
  { key: 'lighting', label: 'Lighting', badge: true },
  { key: 'camera_purpose', label: 'Camera Purpose' },
  { key: 'continuity_notes', label: 'Continuity Notes', wide: true },
  { key: 'technical_notes', label: 'Technical Notes', wide: true },
  { key: 'audio_notes', label: 'Audio Notes' },
]

function toMarkdown(shots: ShotRow[]): string {
  const head = ['#', 'Timecode', ...COLUMNS.map((c) => c.label)]
  const sep = head.map(() => '---')
  const rows = shots.map((s) => [
    String(s.ordinal + 1),
    `${s.timecode_start} – ${s.timecode_end}`,
    ...COLUMNS.map((c) => String(s[c.key] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')),
  ])
  return [head, sep, ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n')
}

function toCsv(shots: ShotRow[]): string {
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['#', 'Timecode Start', 'Timecode End', ...COLUMNS.map((c) => c.label)]
  const lines = [head.map(cell).join(',')]
  for (const s of shots) {
    lines.push(
      [
        s.ordinal + 1,
        s.timecode_start,
        s.timecode_end,
        ...COLUMNS.map((c) => s[c.key]),
      ]
        .map(cell)
        .join(','),
    )
  }
  // BOM so Excel reads UTF-8 correctly.
  return '﻿' + lines.join('\n')
}

export function ShotTable({
  shots,
  onSeek,
}: {
  shots: ShotRow[]
  onSeek?: (seconds: number) => void
}) {
  if (!shots.length) return null

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="nums text-xs text-slate-500">{shots.length} plan</span>
        <div className="flex-1" />
        <CopyButton text={toMarkdown(shots)} label="Markdown kopyala" className="btn-ghost text-xs py-1" />
        <CopyButton text={toCsv(shots)} label="CSV kopyala" className="btn-ghost text-xs py-1" />
      </div>

      <div className="overflow-auto border border-edge rounded-lg max-h-[65vh]">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr>
              <th className="sticky top-0 z-10 bg-panel text-left px-3 py-2 border-b border-edge text-sky-300 font-medium">
                #
              </th>
              <th className="sticky top-0 z-10 bg-panel text-left px-3 py-2 border-b border-edge text-sky-300 font-medium whitespace-nowrap">
                Timecode
              </th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className="sticky top-0 z-10 bg-panel text-left px-3 py-2 border-b border-edge text-sky-300 font-medium whitespace-nowrap"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shots.map((s) => (
              <tr
                key={s.id}
                className={`hover:bg-white/[0.03] ${onSeek ? 'cursor-pointer' : ''}`}
                onClick={() => onSeek?.(s.start_seconds)}
              >
                <td className="px-3 py-2 border-b border-edge align-top text-slate-500">
                  {s.ordinal + 1}
                </td>
                <td className="px-3 py-2 border-b border-edge align-top font-mono text-sky-400 whitespace-nowrap">
                  {s.timecode_start}
                  <br />
                  {s.timecode_end}
                </td>
                {COLUMNS.map((c) => {
                  const v = String(s[c.key] ?? '')
                  return (
                    <td
                      key={c.key}
                      className={`px-3 py-2 border-b border-edge align-top text-slate-300 ${
                        c.wide ? 'min-w-[220px]' : 'min-w-[120px]'
                      }`}
                    >
                      {c.badge && v ? (
                        <span className="inline-block rounded border border-edge bg-black/30 px-1.5 py-0.5 text-[11px]">
                          {v}
                        </span>
                      ) : (
                        v
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onSeek && (
        <p className="mt-2 text-[11px] text-slate-600">
          Bir satıra tıklayınca oynatıcı o planın başına gider.
        </p>
      )}
    </div>
  )
}
