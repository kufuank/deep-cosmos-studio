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

export interface DetectionReport {
  shots: number
  durationSeconds: number
  averageShotSeconds: number
  longestShotSeconds: number
  /** Set when the result looks like missed cuts rather than genuine long takes. */
  warning: string | null
}

/** Documentary shots run seconds, not minutes; longer usually means missed cuts. */
const SUSPICIOUS_SHOT_SECONDS = 20

export function reviewDetection(shots: DetectedShot[], duration: number): DetectionReport {
  const lengths = shots.map((s) => s.endSeconds - s.startSeconds)
  const longest = lengths.length ? Math.max(...lengths) : 0
  const average = lengths.length ? duration / lengths.length : 0

  let warning: string | null = null
  if (shots.length <= 1 && duration > SUSPICIOUS_SHOT_SECONDS) {
    warning =
      'Hiç kesme bulunamadı ve video tek plan sayıldı. Video gerçekten tek çekimse sorun yok; değilse hassasiyeti düşürüp tekrar deneyin.'
  } else if (longest > SUSPICIOUS_SHOT_SECONDS) {
    warning = `En uzun plan ${longest.toFixed(1)} saniye. Belgesel planları nadiren bu kadar uzundur — muhtemelen bazı kesmeler atlandı. Hassasiyeti düşürüp tekrar deneyin.`
  }
  return {
    shots: shots.length,
    durationSeconds: duration,
    averageShotSeconds: average,
    longestShotSeconds: longest,
    warning,
  }
}

const SIGNATURE_W = 32
const SIGNATURE_H = 18
/** Shots shorter than this are treated as detection noise and merged. */
const MIN_SHOT_SECONDS = 0.45
/** Upper bound on frames sent per shot, to keep request payloads sane. */
const MAX_FRAMES_PER_SHOT = 10
/**
 * Seconds of shot each sampled frame is expected to account for.
 *
 * This was 4, which is fine when a shot is a couple of seconds long but not
 * when a whole clip is one shot: an eight-second take arrived as three stills
 * four seconds apart, and the model was then asked for a single camera
 * movement and a single action. It answered with contradictions — "Push In,
 * Pull Back" — because that is what three disconnected stills look like.
 */
const SECONDS_PER_FRAME = 1.5

/**
 * How many stills to sample from a shot of this length.
 *
 * Exported so the rule can be tested without a browser: it is plain
 * arithmetic, and getting it wrong does not throw — it just quietly starves
 * the model of the frames it needs to describe motion.
 */
export function framesForSpan(span: number, floor = 3): number {
  return Math.max(
    1,
    Math.min(MAX_FRAMES_PER_SHOT, Math.max(floor, Math.ceil(span / SECONDS_PER_FRAME))),
  )
}

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

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Indices where the frame signature jumps enough to call a cut.
 *
 * The baseline is the median and the median absolute deviation, not the mean and
 * standard deviation. Cuts are exactly the outliers being looked for, and they
 * drag the mean and especially the standard deviation upward — enough that on
 * densely cut footage the threshold climbs above the cuts themselves and the
 * whole clip collapses into one shot. Median and MAD are unmoved by a minority
 * of large values, so the baseline describes ordinary within-shot motion.
 *
 * `sensitivity` scales the margin: below 1 finds more cuts, above 1 fewer.
 */
export function findCutIndices(deltas: number[], sensitivity = 1): number[] {
  // The first sample has no predecessor, so it carries no usable delta.
  const body = deltas.slice(1)
  if (body.length < 2) return []

  const base = median(body)
  const mad = median(body.map((d) => Math.abs(d - base)))

  // MAD collapses to zero on perfectly still footage; the floor keeps the
  // threshold meaningful there instead of flagging every sample.
  const margin = Math.max(mad * 8, 0.06) * sensitivity
  const threshold = Math.max(base + margin, 0.07 * sensitivity)

  const out: number[] = []
  for (let i = 1; i < deltas.length; i++) {
    if (deltas[i] >= threshold) out.push(i)
  }
  return out
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
    /** Below 1 finds more cuts, above 1 fewer. */
    sensitivity?: number
    signal?: AbortSignal
    onProgress?: (p: DetectProgress) => void
  } = {},
): Promise<DetectedShot[]> {
  const interval = opts.sampleInterval ?? 0.25
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

  // Pass 2 — locate cuts against a robust baseline.
  opts.onProgress?.({ phase: 'grouping', done: 0, total: 1 })
  const cutIdx = findCutIndices(deltas, opts.sensitivity ?? 1)

  const boundaries: number[] = [0]
  for (const i of cutIdx) {
    const t = times[i]
    if (t - boundaries[boundaries.length - 1] >= MIN_SHOT_SECONDS) boundaries.push(t)
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
    // Longer spans get more frames. Motion is the thing being described, and it
    // only exists between frames — too few and the model is extrapolating, not
    // observing.
    const n = framesForSpan(span, framesPerShot)
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
