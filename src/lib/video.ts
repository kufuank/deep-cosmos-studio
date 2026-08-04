/**
 * Browser-side shot detection.
 *
 * Cut boundaries are measured mechanically rather than guessed by a model: the
 * video is sampled on a fixed grid, each sample reduced to a small signature,
 * and a cut declared where consecutive signatures diverge sharply. The model
 * then only has to describe shots whose timecodes are already known.
 */

export interface DetectedShot {
  index: number
  startSeconds: number
  endSeconds: number
  /** Data URLs, sampled across the shot so motion is visible. */
  frames: string[]
}

export interface DetectProgress {
  phase: 'sampling' | 'grouping' | 'extracting'
  done: number
  total: number
}

const SIGNATURE_W = 32
const SIGNATURE_H = 18
/** Shots shorter than this are treated as detection noise and merged. */
const MIN_SHOT_SECONDS = 0.45

export function formatTimecode(seconds: number): string {
  const s = Math.max(0, seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.round((s - Math.floor(s)) * 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(h)}:${p(m)}:${p(sec)}.${p(ms, 3)}`
}

export function loadVideo(file: File): Promise<{ video: HTMLVideoElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.src = url
    const onReady = () => {
      if (!video.duration || !isFinite(video.duration)) {
        reject(new Error('Video süresi okunamadı. Dosya bozuk olabilir.'))
        return
      }
      resolve({ video, url })
    }
    video.onloadedmetadata = onReady
    video.onerror = () => reject(new Error('Video açılamadı. Desteklenmeyen bir format olabilir.'))
  })
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Video konumlandırma zaman aşımına uğradı.')), 10000)
    const done = () => {
      clearTimeout(timer)
      video.removeEventListener('seeked', done)
      resolve()
    }
    video.addEventListener('seeked', done)
    video.currentTime = Math.min(time, Math.max(0, video.duration - 0.02))
  })
}

/** Mean absolute difference between two signatures, normalised to 0..1. */
function signatureDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 4) {
    // Luma only: colour grading shifts should not read as cuts.
    const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]
    const lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]
    sum += Math.abs(la - lb)
  }
  return sum / (a.length / 4) / 255
}

function toDataUrl(video: HTMLVideoElement, maxWidth: number, quality: number): string {
  const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth))
  const w = Math.max(2, Math.round((video.videoWidth || maxWidth) * scale))
  const h = Math.max(2, Math.round((video.videoHeight || maxWidth) * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(video, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality)
}

/**
 * Samples the video, finds cuts, and returns shots with representative frames.
 *
 * `sampleInterval` trades accuracy against time: a cut is located to within one
 * interval, and the whole pass costs roughly one seek per interval.
 */
export async function detectShots(
  video: HTMLVideoElement,
  opts: {
    sampleInterval?: number
    framesPerShot?: number
    frameWidth?: number
    signal?: AbortSignal
    onProgress?: (p: DetectProgress) => void
  } = {},
): Promise<DetectedShot[]> {
  const interval = opts.sampleInterval ?? 0.4
  const framesPerShot = opts.framesPerShot ?? 3
  const frameWidth = opts.frameWidth ?? 640
  const duration = video.duration

  const sigCanvas = document.createElement('canvas')
  sigCanvas.width = SIGNATURE_W
  sigCanvas.height = SIGNATURE_H
  const sigCtx = sigCanvas.getContext('2d', { willReadFrequently: true })!

  // Pass 1 — sample signatures across the timeline.
  const times: number[] = []
  for (let t = 0; t < duration; t += interval) times.push(t)
  const deltas: number[] = []
  let prev: Uint8ClampedArray | null = null

  for (let i = 0; i < times.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    await seek(video, times[i])
    sigCtx.drawImage(video, 0, 0, SIGNATURE_W, SIGNATURE_H)
    const data = sigCtx.getImageData(0, 0, SIGNATURE_W, SIGNATURE_H).data
    const copy = new Uint8ClampedArray(data)
    deltas.push(prev ? signatureDelta(prev, copy) : 0)
    prev = copy
    opts.onProgress?.({ phase: 'sampling', done: i + 1, total: times.length })
  }

  // Pass 2 — adaptive threshold. A fixed cutoff misfires on both very static
  // footage and constantly moving handheld work, so scale it to this video.
  opts.onProgress?.({ phase: 'grouping', done: 0, total: 1 })
  const meaningful = deltas.slice(1)
  const mean = meaningful.reduce((a, b) => a + b, 0) / Math.max(1, meaningful.length)
  const variance =
    meaningful.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, meaningful.length)
  const sd = Math.sqrt(variance)
  const threshold = Math.max(0.08, mean + 2.5 * sd)

  const boundaries: number[] = [0]
  for (let i = 1; i < deltas.length; i++) {
    if (deltas[i] >= threshold) {
      const t = times[i]
      if (t - boundaries[boundaries.length - 1] >= MIN_SHOT_SECONDS) boundaries.push(t)
    }
  }

  const shots: DetectedShot[] = boundaries.map((start, i) => ({
    index: i,
    startSeconds: start,
    endSeconds: i + 1 < boundaries.length ? boundaries[i + 1] : duration,
    frames: [],
  }))

  // Pass 3 — pull representative frames from inside each shot, avoiding the
  // boundaries themselves so no frame straddles a cut.
  for (let i = 0; i < shots.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const s = shots[i]
    const span = s.endSeconds - s.startSeconds
    const inset = Math.min(0.12, span * 0.15)
    const from = s.startSeconds + inset
    const to = Math.max(from, s.endSeconds - inset)
    const n = Math.max(1, Math.min(framesPerShot, Math.ceil(span / 0.5)))
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? (from + to) / 2 : from + ((to - from) * k) / (n - 1)
      await seek(video, t)
      s.frames.push(toDataUrl(video, frameWidth, 0.72))
    }
    opts.onProgress?.({ phase: 'extracting', done: i + 1, total: shots.length })
  }

  return shots
}

/** Splits a data URL into the parts the Anthropic image block needs. */
export function dataUrlParts(dataUrl: string): { mediaType: string; base64: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
  if (!m) throw new Error('Geçersiz kare verisi.')
  return { mediaType: m[1], base64: m[2] }
}
