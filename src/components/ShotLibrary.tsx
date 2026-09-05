import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { ShotListRow, ShotRow } from '../lib/supabase'
import { detectShots, formatTimecode, loadVideo, reviewDetection } from '../lib/video'
import type { DetectedShot, DetectionReport } from '../lib/video'
import { analyseShot, shotSummary } from '../agents/deconstruct'
import { recordUsage } from '../lib/usage'
import { useSettings } from '../lib/settings'
import { visionModelFor, isFreeProvider, FREE_TIER_MIN_GAP_MS } from '../lib/anthropic'
import { describeError, isAbort } from '../lib/errors'
import { ShotTable } from './ShotTable'

interface Progress {
  label: string
  done: number
  total: number
}

export function ShotLibrary({ session }: { session: Session }) {
  const { model } = useSettings()
  const [lists, setLists] = useState<ShotListRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [shots, setShots] = useState<ShotRow[]>([])
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [sensitivity, setSensitivity] = useState(1)
  const [report, setReport] = useState<DetectionReport | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const playerRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from('dc_shot_lists')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) {
        setError(error.message)
        return
      }
      setLists((data ?? []) as ShotListRow[])
      setActiveId((prev) => prev ?? data?.[0]?.id ?? null)
    })()
  }, [])

  useEffect(() => {
    if (!activeId) {
      setShots([])
      return
    }
    let alive = true
    void (async () => {
      const { data, error } = await supabase
        .from('dc_shots')
        .select('*')
        .eq('shot_list_id', activeId)
        .order('ordinal', { ascending: true })
      if (!alive) return
      if (error) {
        setError(error.message)
        return
      }
      setShots((data ?? []) as ShotRow[])
    })()
    return () => {
      alive = false
    }
  }, [activeId])

  // The object URL belongs to this component; revoke it when it is replaced.
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl)
    }
  }, [videoUrl])

  async function handleFile(file: File) {
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller

    let listId: string | null = null
    try {
      setProgress({ label: 'Video açılıyor', done: 0, total: 1 })
      const { video, url } = await loadVideo(file)
      setVideoUrl(url)

      const { data: created, error: createErr } = await supabase
        .from('dc_shot_lists')
        .insert({
          owner: session.user.id,
          title: file.name,
          source_kind: 'file',
          source_ref: file.name,
          duration_seconds: video.duration,
          status: 'analyzing',
        })
        .select()
        .single()
      if (createErr || !created) throw new Error(createErr?.message ?? 'Kayıt oluşturulamadı.')
      listId = created.id
      setLists((l) => [created as ShotListRow, ...l])
      setActiveId(created.id)
      setShots([])

      // Cuts are measured, not guessed — the model only describes what it is given.
      let detected: DetectedShot[] = []
      detected = await detectShots(video, {
        signal: controller.signal,
        sensitivity,
        onProgress: (p) =>
          setProgress({
            label:
              p.phase === 'sampling'
                ? 'Kesmeler taranıyor'
                : p.phase === 'grouping'
                  ? 'Planlar gruplanıyor'
                  : 'Kareler çıkarılıyor',
            done: p.done,
            total: p.total,
          }),
      })

      if (!detected.length) throw new Error('Videoda plan tespit edilemedi.')

      // Surface the shape of the detection before spending a call per shot, so a
      // bad split can be corrected instead of paid for.
      const rev = reviewDetection(detected, video.duration)
      setReport(rev)

      // Frames only reach a model that can see them; the conversation model is
      // irrelevant here and choosing a text one would silently drop the images.
      const analysisModel = visionModelFor(model)
      const paced = isFreeProvider(analysisModel)
      let lastCallAt = 0

      let previous: string | undefined
      for (let i = 0; i < detected.length; i++) {
        if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError')
        setProgress({ label: 'Planlar çözümleniyor', done: i, total: detected.length })
        const d = detected[i]

        // The free tier allows ~40 requests a minute across the key, so a long
        // video has to wait its turn rather than collect 429s halfway through.
        if (paced) {
          const since = Date.now() - lastCallAt
          if (lastCallAt && since < FREE_TIER_MIN_GAP_MS) {
            await new Promise((r) => setTimeout(r, FREE_TIER_MIN_GAP_MS - since))
          }
          lastCallAt = Date.now()
        }

        const { analysis, usage } = await analyseShot({
          model: analysisModel,
          shot: d,
          totalShots: detected.length,
          previousSummary: previous,
          signal: controller.signal,
        })
        recordUsage({ kind: 'shot_analysis', agent: 'deconstruction', model: analysisModel, effort: 'low', requests: 1, usage })
        previous = shotSummary(analysis)

        const { data: row, error: insErr } = await supabase
          .from('dc_shots')
          .insert({
            shot_list_id: listId,
            owner: session.user.id,
            ordinal: i,
            start_seconds: d.startSeconds,
            end_seconds: d.endSeconds,
            timecode_start: formatTimecode(d.startSeconds),
            timecode_end: formatTimecode(d.endSeconds),
            ...analysis,
          })
          .select()
          .single()
        if (insErr) throw new Error(insErr.message)
        setShots((s) => [...s, row as ShotRow])
      }

      await supabase.from('dc_shot_lists').update({ status: 'ready' }).eq('id', listId)
      setLists((l) =>
        l.map((x) => (x.id === listId ? { ...x, status: 'ready' as const } : x)),
      )
      setProgress(null)
    } catch (e) {
      const aborted = isAbort(e)
      const msg = aborted ? 'Çözümleme durduruldu.' : describeError(e)
      setError(msg)
      setProgress(null)
      if (listId) {
        await supabase
          .from('dc_shot_lists')
          .update({ status: aborted ? 'draft' : 'failed', error: aborted ? null : msg })
          .eq('id', listId)
        setLists((l) =>
          l.map((x) =>
            x.id === listId ? { ...x, status: aborted ? 'draft' : ('failed' as const) } : x,
          ),
        )
      }
    } finally {
      abortRef.current = null
    }
  }

  async function deleteList(id: string) {
    const { error } = await supabase.from('dc_shot_lists').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    setLists((l) => l.filter((x) => x.id !== id))
    if (activeId === id) setActiveId(null)
  }

  const busy = progress !== null
  const active = lists.find((l) => l.id === activeId) ?? null

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-60 shrink-0 border-r border-edge overflow-auto p-3">
        <button
          className="btn-primary w-full text-xs mb-2"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          + Referans video
        </button>

        <label className="label mt-2">Kesme hassasiyeti</label>
        <select
          className="input text-xs py-1 mb-3"
          value={sensitivity}
          disabled={busy}
          onChange={(e) => setSensitivity(Number(e.target.value))}
        >
          <option value={0.6}>Yüksek — daha çok kesme bulur</option>
          <option value={1}>Normal</option>
          <option value={1.6}>Düşük — daha az kesme bulur</option>
        </select>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void handleFile(f)
          }}
        />

        {lists.length === 0 && !busy && (
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Bir belgesel klibi yükleyin. Kesmeler tarayıcıda ölçülür, her plan ayrı ayrı
            çözümlenip 16 kolonluk shot list'e dönüştürülür.
          </p>
        )}

        {lists.map((l) => (
          <div key={l.id}>
            <button
              onClick={() => setActiveId(l.id)}
              className={`w-full text-left px-2 py-1.5 rounded text-xs truncate transition-colors ${
                activeId === l.id
                  ? 'bg-sky-500/15 text-sky-200'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
              title={l.title}
            >
              {l.status === 'ready' && <span className="text-emerald-400 mr-1">●</span>}
              {l.status === 'failed' && <span className="text-red-400 mr-1">●</span>}
              {l.status === 'analyzing' && <span className="text-amber-400 mr-1">●</span>}
              {l.title}
            </button>
          </div>
        ))}
      </aside>

      <main className="flex-1 min-w-0 min-h-0 overflow-auto p-5">
        {progress && (
          <div className="card p-4 mb-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-sm text-slate-200">
                {progress.label}
                <span className="nums text-slate-500 ml-2">
                  {progress.done}/{progress.total}
                </span>
              </p>
              <button
                className="btn-ghost text-xs py-1"
                onClick={() => abortRef.current?.abort()}
              >
                Durdur
              </button>
            </div>
            <div className="h-1 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-sky-500 transition-all duration-300"
                style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 mb-4">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {report && (
          <div
            className={`rounded-md border px-3 py-2 mb-4 ${
              report.warning
                ? 'border-amber-500/30 bg-amber-500/10'
                : 'border-edge bg-white/[0.02]'
            }`}
          >
            <p className="nums text-xs text-slate-400">
              {report.shots} plan · ortalama {report.averageShotSeconds.toFixed(1)}s · en uzun{' '}
              {report.longestShotSeconds.toFixed(1)}s
            </p>
            {report.warning && (
              <p className="text-xs text-amber-300 mt-1 leading-relaxed">{report.warning}</p>
            )}
          </div>
        )}

        {active && (
          <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-100 truncate">{active.title}</h2>
              <p className="nums text-xs text-slate-500 mt-0.5">
                {active.duration_seconds
                  ? `${formatTimecode(active.duration_seconds)} · `
                  : ''}
                {shots.length} plan
              </p>
            </div>
            <button
              className="text-[11px] text-slate-700 hover:text-red-400"
              onClick={() => deleteList(active.id)}
            >
              Bu listeyi sil
            </button>
          </div>
        )}

        {videoUrl && (
          <video
            ref={playerRef}
            src={videoUrl}
            controls
            className="w-full max-w-2xl rounded-lg border border-edge bg-black mb-4"
          />
        )}

        {shots.length > 0 ? (
          <ShotTable
            shots={shots}
            onSeek={
              videoUrl
                ? (s) => {
                    if (playerRef.current) {
                      playerRef.current.currentTime = s
                      void playerRef.current.play()
                    }
                  }
                : undefined
            }
          />
        ) : (
          !busy &&
          !active && (
            <div className="h-full grid place-items-center text-sm text-slate-600">
              Soldan bir referans video yükleyin.
            </div>
          )
        )}
      </main>
    </div>
  )
}
