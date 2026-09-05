import { callAnthropic } from '../lib/anthropic'
import type { ContentBlock, ToolDef, Usage } from '../lib/anthropic'
import { supabase } from '../lib/supabase'
import { dataUrlParts, formatTimecode } from '../lib/video'
import type { DetectedShot } from '../lib/video'

/** One row of the Production Shot List, per the Deconstruction Agent protocol. */
export interface ShotAnalysis {
  shot_type: string
  camera_angle: string
  camera_movement: string
  lens: string
  dof: string
  main_subject: string
  primary_action: string
  foreground: string
  background: string
  composition: string
  lighting: string
  camera_purpose: string
  continuity_notes: string
  technical_notes: string
  audio_notes: string
}

const FIELDS: (keyof ShotAnalysis)[] = [
  'shot_type',
  'camera_angle',
  'camera_movement',
  'lens',
  'dof',
  'main_subject',
  'primary_action',
  'foreground',
  'background',
  'composition',
  'lighting',
  'camera_purpose',
  'continuity_notes',
  'technical_notes',
  'audio_notes',
]

export const recordShotTool: ToolDef = {
  name: 'record_shot',
  description:
    'Record the cinematographic analysis of the shot whose frames were supplied. Call exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      shot_type: {
        type: 'string',
        description:
          'Establishing Shot, Extreme Wide, Wide, Medium Wide, Medium, Medium Close-Up, Close-Up, Extreme Close-Up, Insert, Detail, POV, Drone, Overhead, Macro, Tracking, Reaction, Cutaway…',
      },
      camera_angle: {
        type: 'string',
        description:
          "Eye Level, Low Angle, High Angle, Bird's Eye, Ground Level, Top Down, Front, Rear, Three Quarter, Profile, POV, Over the Shoulder…",
      },
      camera_movement: {
        type: 'string',
        description:
          'The actual physical movement of the camera, read from how the frame content shifts between the supplied frames. If it changes during the shot, state the full movement in chronological order. Locked Off, Static, Handheld, Pan Left/Right, Tilt Up/Down, Tracking, Crane, Orbit, Arc, Push In, Pull Back, Zoom In/Out, Whip Pan, Reveal, Combination…',
      },
      lens: {
        type: 'string',
        description:
          'Estimated from perspective compression only. 14mm Ultra Wide, 24mm Wide, 35mm Documentary, 50mm, 85mm, 135mm Telephoto, 200-300mm Ultra Telephoto, Macro…',
      },
      dof: {
        type: 'string',
        description:
          'Very Deep, Deep, Moderate, Shallow, Extremely Shallow, Rack Focus, Focus Pull…',
      },
      main_subject: { type: 'string', description: 'The primary subject only.' },
      primary_action: {
        type: 'string',
        description: 'Observable action only, in chronological order. No interpretation.',
      },
      foreground: {
        type: 'string',
        description: 'Important foreground objects. Empty string if the foreground is empty.',
      },
      background: { type: 'string', description: 'The visible background.' },
      composition: {
        type: 'string',
        description:
          'Subject Position, Rule of Thirds, Symmetry, Negative Space, Leading Lines, Framing, Layering, Visual Balance, Geometric Shapes, Natural Frames, Frame in Frame… list all that apply.',
      },
      lighting: {
        type: 'string',
        description:
          'Visible lighting only. Natural daylight, Golden Hour, Overcast, Soft Diffused, Hard Sunlight, Artificial, Practical, Backlit, Low Key, High Key…',
      },
      camera_purpose: {
        type: 'string',
        description:
          'Why this shot exists. Establish location, Reveal subject, Show behavior, Follow movement, Reaction, Scale comparison, Environmental context, Transition, Narrative emphasis…',
      },
      continuity_notes: {
        type: 'string',
        description:
          'What later shots must preserve: direction of movement, subject position, lighting, weather, object placement, camera height…',
      },
      technical_notes: {
        type: 'string',
        description:
          'Observable technical characteristics that make this shot distinctive: visible stabilisation or shake, motion blur, rolling shutter, lens distortion, slow motion, drone, tripod, gimbal, film grain, anamorphic streaks, exposure transitions…',
      },
      audio_notes: {
        type: 'string',
        description:
          'No audio is supplied with the frames, so this must always be "Cannot be determined (no audio supplied)".',
      },
    },
    required: FIELDS,
  },
}

async function loadProtocol(): Promise<{ role: string; knowledge: string; protocol: string }> {
  const { data } = await supabase
    .from('dc_agents')
    .select('role, knowledge, protocol')
    .eq('agent', 'deconstruction')
    .eq('active', true)
    .order('owner', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (data) return data
  return {
    role: 'You are the Deconstruction Agent. Reverse-engineer the cinematography of the supplied shot.',
    knowledge: '',
    protocol:
      'Describe only what the frames show. Never invent movement or action. Where something cannot be determined, write "Cannot be determined".',
  }
}

let cachedInstructions: Promise<{ role: string; knowledge: string; protocol: string }> | null = null

export function clearDeconstructCache() {
  cachedInstructions = null
}

/** Analyses one detected shot. Frames must all come from inside the shot. */
export async function analyseShot(params: {
  model: string
  shot: DetectedShot
  totalShots: number
  /** Handed to the model so continuity notes can reference what came before. */
  previousSummary?: string
  signal?: AbortSignal
}): Promise<{ analysis: ShotAnalysis; usage: Usage }> {
  cachedInstructions ??= loadProtocol()
  const inst = await cachedInstructions

  // One block, cached: every shot of a library run re-reads the same protocol.
  const system = [
    {
      text: [inst.role, inst.knowledge && `CORE KNOWLEDGE\n${inst.knowledge}`, inst.protocol]
        .filter(Boolean)
        .join('\n\n────────────────────\n\n'),
      cache: true,
    },
  ]

  const { shot } = params
  const duration = shot.endSeconds - shot.startSeconds

  const content: ContentBlock[] = []
  content.push({
    type: 'text',
    text: `Shot ${shot.index + 1} of ${params.totalShots}.
Measured timecode: ${formatTimecode(shot.startSeconds)} – ${formatTimecode(shot.endSeconds)} (${duration.toFixed(2)}s).
${shot.frames.length} frames follow, sampled in chronological order from inside this shot.${
      params.previousSummary
        ? `\n\nFor continuity only, the previous shot was: ${params.previousSummary}`
        : ''
    }`,
  })

  for (const f of shot.frames) {
    const { mediaType, base64 } = dataUrlParts(f)
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } })
  }

  content.push({
    type: 'text',
    text: 'Analyse this shot and call record_shot exactly once with every field filled.',
  })

  const res = await callAnthropic({
    model: params.model,
    system,
    messages: [{ role: 'user', content }],
    tools: [recordShotTool],
    // Perception, not reasoning: low effort keeps thinking spend small. The
    // cap still has to hold thinking + the 15-field tool call — 2000 was
    // enough before thinking was on by default, not any more.
    effort: 'low',
    maxTokens: 6000,
    signal: params.signal,
  })

  const call = res.content.find(
    (b): b is Extract<ContentBlock, { type: 'tool_use' }> =>
      b.type === 'tool_use' && b.name === 'record_shot',
  )
  if (!call) {
    throw new Error(`Plan ${shot.index + 1} çözümlenemedi: model beklenen çıktıyı vermedi.`)
  }

  const raw = call.input as Partial<Record<keyof ShotAnalysis, unknown>>
  const out = {} as ShotAnalysis
  for (const k of FIELDS) {
    const v = raw[k]
    out[k] = typeof v === 'string' ? v : ''
  }
  // The protocol forbids inventing audio observations from silent frames.
  if (!out.audio_notes) out.audio_notes = 'Cannot be determined (no audio supplied)'
  return { analysis: out, usage: res.usage }
}

export function shotSummary(a: ShotAnalysis): string {
  return `${a.shot_type}, ${a.camera_movement}, subject: ${a.main_subject}`.slice(0, 200)
}
