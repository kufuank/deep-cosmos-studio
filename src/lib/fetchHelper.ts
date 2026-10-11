/**
 * Reference videos from a link (YouTube, Instagram, TikTok, …) through the local
 * fetch helper (tools/fetch-helper). The browser cannot run yt-dlp, and a server
 * cannot either — these sites block datacenter addresses — so the download runs on
 * the user's own machine and the video comes back here as an ordinary File. From
 * that point the Shot Library treats it exactly like an upload.
 */

export const FETCH_HELPER_URL = 'http://127.0.0.1:8765'

/** One caption cue, in source seconds. */
export interface CaptionSegment {
  start: number
  end: number
  text: string
}

export interface FetchedVideo {
  file: File
  title: string
  sourceUrl: string
  sourceKind: 'youtube' | 'url'
  durationSeconds: number | null
  transcript: CaptionSegment[]
  transcriptSource: string | null
}

const UNREACHABLE =
  'Yerel video yardımcısına ulaşılamadı (127.0.0.1:8765). Bilgisayarınızda ' +
  '`npm run fetch-helper` çalıştırın; tarayıcı yerel ağ izni isterse izin verin.'

export function sourceKindFor(url: string): 'youtube' | 'url' {
  try {
    const host = new URL(url).hostname.replace(/^www\.|^m\./, '')
    return host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')
      ? 'youtube'
      : 'url'
  } catch {
    return 'url'
  }
}

/** Caption text spoken while [start, end) is on screen. */
export function captionsForSpan(segments: CaptionSegment[], start: number, end: number): string {
  return segments
    .filter((s) => s.end > start && s.start < end)
    .map((s) => s.text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
}

/**
 * audio_notes for a shot when the video came with captions.
 *
 * Captions are evidence of what is said, not of music or ambience, so only the
 * speech is reported and everything else stays undetermined, as the protocol
 * requires. Returns null when there are no captions at all, which leaves the
 * analysis's own "cannot be determined" in place.
 */
export function captionAudioNotes(
  segments: CaptionSegment[],
  start: number,
  end: number,
  source: string | null,
): string | null {
  if (!segments.length) return null
  const label = source ?? 'captions'
  const said = captionsForSpan(segments, start, end)
  return said
    ? `Voice-over/dialogue (from ${label}): "${said}" Music and ambience cannot be determined.`
    : `No captioned speech in this span (${label}). Music and ambience cannot be determined.`
}

async function helperError(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) return new Error(body.error)
  } catch {
    // fall through
  }
  return new Error(`Video yardımcısı hata döndü (${res.status}).`)
}

/** Downloads the link through the helper and returns it as a File. */
export async function fetchFromUrl(url: string, signal?: AbortSignal): Promise<FetchedVideo> {
  let res: Response
  try {
    res = await fetch(`${FETCH_HELPER_URL}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal,
    })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new Error(UNREACHABLE)
  }
  if (!res.ok) throw await helperError(res)
  const meta = (await res.json()) as {
    title: string
    source_url: string
    duration_seconds: number | null
    media: string
    transcript: CaptionSegment[]
    transcript_source: string | null
  }

  let media: Response
  try {
    media = await fetch(`${FETCH_HELPER_URL}${meta.media}`, { signal })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new Error(UNREACHABLE)
  }
  if (!media.ok) throw await helperError(media)
  const blob = await media.blob()
  const ext = blob.type.includes('webm') ? 'webm' : 'mp4'
  const name = `${meta.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'video'}.${ext}`

  return {
    file: new File([blob], name, { type: blob.type || 'video/mp4' }),
    title: meta.title,
    sourceUrl: meta.source_url || url,
    sourceKind: sourceKindFor(url),
    durationSeconds: meta.duration_seconds,
    transcript: meta.transcript ?? [],
    transcriptSource: meta.transcript_source,
  }
}
