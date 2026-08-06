import type { Scene } from '../schemas'
import type { PromptContext } from '../lib/prompt'
import { sceneVideoPrompt } from '../lib/prompt'
import { CopyButton } from './CopyButton'

/**
 * The storyboard's scenes. Each one carries its own production-ready video
 * prompt, because scenes are generated one at a time in practice.
 */
export function SceneList({
  scenes,
  ctx,
  locked,
  onChange,
}: {
  scenes: Scene[]
  ctx: PromptContext
  locked: boolean
  onChange: (index: number, patch: Partial<Scene>) => void
}) {
  if (!scenes.length) {
    return (
      <div className="p-4 text-sm text-slate-500 leading-relaxed">
        Henüz sahne yok. Ajana ne göstermek istediğinizi söyleyin; Shot Library’den uygun
        sekansı seçip sahneleri kuracak.
      </div>
    )
  }

  return (
    <div className="divide-y divide-edge">
      {scenes.map((s, i) => (
        <section key={i} className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-sky-300">
                SAHNE {String(i + 1).padStart(2, '0')}
                <span className="nums ml-2 font-mono text-slate-500">
                  {s.timestamp_start} – {s.timestamp_end}
                </span>
              </p>
              {s.source_shot && (
                <p className="text-[11px] text-slate-600 mt-0.5">Kaynak: {s.source_shot}</p>
              )}
            </div>
            <CopyButton
              text={sceneVideoPrompt(ctx, s)}
              label="Sahne promptunu kopyala"
              className="btn-ghost text-xs py-1"
            />
          </div>

          <div className="flex flex-wrap gap-1">
            {[s.shot_type, s.camera_angle, s.camera_movement].filter(Boolean).map((b, k) => (
              <span
                key={k}
                className="inline-block rounded border border-edge bg-black/30 px-1.5 py-0.5 text-[11px] text-slate-300"
              >
                {b}
              </span>
            ))}
          </div>

          <p className="text-sm text-slate-300 leading-relaxed">{s.scene_description}</p>

          <div>
            <label className="label">Visual Prompt</label>
            <textarea
              className="input min-h-[90px] resize-y text-[12px] font-mono"
              value={s.visual_prompt}
              disabled={locked}
              onChange={(e) => onChange(i, { visual_prompt: e.target.value })}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label">Audio</label>
              <textarea
                className="input min-h-[56px] resize-y text-[12px]"
                value={s.audio}
                disabled={locked}
                onChange={(e) => onChange(i, { audio: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Voice-over</label>
              <textarea
                className="input min-h-[56px] resize-y text-[12px]"
                value={s.voice_over}
                disabled={locked}
                onChange={(e) => onChange(i, { voice_over: e.target.value })}
              />
            </div>
          </div>
        </section>
      ))}
    </div>
  )
}
