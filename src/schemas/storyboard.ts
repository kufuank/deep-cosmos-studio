import type { CardSchema } from './types'

/**
 * Transcribed from "5 - STORYBOARD AGENT MASTER PROMPT.docx".
 *
 * Unlike the four identity sheets, the bulk of this card's output is an ordered
 * scene list rather than fields. The fields here carry the shared attributes the
 * template calls COMMON — the properties every scene inherits.
 */
export const storyboardSchema: CardSchema = {
  type: 'storyboard',
  label: 'Storyboard',
  parent: 'location',
  directive: `Create a premium AAA ecosystem storyboard image using the supplied Planet Identity Sheet, Ecosystem Identity Sheet, Species Identity Sheet and Location Identity Sheet, for an ultra-photorealistic fictional nature documentary.

CORE DIRECTIVE
This is NOT concept art.
This is NOT a screenplay.
This is NOT a creative storyboard.
This is a professional production storyboard documenting a scientifically plausible nature documentary filmed within the fictional world defined by the supplied Identity Sheets.
The objective is to preserve the documentary grammar of a complete sequence while replacing every observable element with its fictional equivalent.
Every scene must contribute to observing the species naturally within its environment.
Every shot must have a clear documentary purpose.
No arbitrary shots. No unexplained behaviours. No cinematic clichés. No visual contradictions.`,
  inheritedKeys: [],
  sections: [
    {
      id: 'brief',
      title: 'STORYBOARD BRIEF',
      fields: [
        {
          key: 'storyboard_title',
          label: 'Storyboard Title',
          hint: 'Short production name for this sequence.',
        },
        {
          key: 'documentary_objective',
          label: 'Documentary Objective',
          hint: 'What this sequence sets out to show about the species. Drives which reference sequence is chosen.',
          examples: [
            'Foraging at first light',
            'Territorial display between rivals',
            'Juvenile learning to move through the canopy',
          ],
          multiline: true,
        },
        {
          key: 'target_duration',
          label: 'Target Duration',
          hint: 'Total runtime of the sequence.',
          examples: ['15 seconds', '30 seconds'],
        },
        {
          key: 'source_sequence',
          label: 'Source Sequence',
          hint: 'Which shots from the Production Shot Library this sequence adapts, by shot number and timecode.',
          multiline: true,
        },
        {
          key: 'adaptation_logic',
          label: 'Adaptation Logic',
          hint: 'How each real-world element maps to its fictional equivalent, and why this sequence was chosen.',
          multiline: true,
        },
      ],
    },
    {
      id: 'common',
      title: 'COMMON ATTRIBUTES',
      fields: [
        {
          key: 'common_camera',
          label: 'Common Camera Characteristics',
          hint: 'The shared camera system for the entire sequence.',
          examples: [
            'BBC Planet Earth style wildlife cinematography',
            'Long telephoto documentary lenses',
            'Natural handheld stabilisation',
            'Slow observational camera language',
          ],
          multiline: true,
        },
        {
          key: 'common_lighting',
          label: 'Common Lighting & Color',
          hint: 'Overall lighting conditions, consistent with the planet and location.',
          examples: [
            'Early morning soft sunlight',
            'Cold blue atmospheric haze',
            'Neutral scientific color grading',
          ],
          multiline: true,
        },
        {
          key: 'common_environment',
          label: 'Common Environment',
          hint: 'The recurring environmental conditions, drawn from the Location Card.',
          examples: ['Dense floating mineral forest', 'Basalt canyon system', 'Ammonia wetland'],
          multiline: true,
        },
        {
          key: 'common_style',
          label: 'Common Style / Tone',
          hint: 'The overall documentary style.',
          examples: [
            'Observational',
            'Naturalistic',
            'Scientific',
            'BBC wildlife documentary',
            'Calm cinematic pacing',
          ],
          multiline: true,
        },
      ],
    },
  ],
  promptTail: `LAYOUT
Compose the storyboard as a 16:9 production board.
Each frame represents one scene and contains a vertical 9:16 preview image.
Below every frame include the timestamp and the scene description.
Dark neutral background. Editorial composition.

OUTPUT
Production-ready AAA storyboard suitable for:
• AI image generation
• AI video generation
• Documentary production
• Storyboarding
• Wildlife cinematography
• AAA film pre-production`,
}

/** One scene of the storyboard, per the master prompt's SCENE block. */
export interface Scene {
  timestamp_start: string
  timestamp_end: string
  scene_description: string
  camera_angle: string
  shot_type: string
  camera_movement: string
  visual_prompt: string
  audio: string
  voice_over: string
  /** Which shot in the source list this scene adapts, for traceability. */
  source_shot: string
}

export const SCENE_FIELDS: (keyof Scene)[] = [
  'timestamp_start',
  'timestamp_end',
  'scene_description',
  'camera_angle',
  'shot_type',
  'camera_movement',
  'visual_prompt',
  'audio',
  'voice_over',
  'source_shot',
]
