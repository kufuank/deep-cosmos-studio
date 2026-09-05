import { schemas, cardOrder, allFields } from '../schemas'
import type { CardFields, CardSchema, CardType, Scene } from '../schemas'

export type PromptKind = 'sheet' | 'still' | 'video'

export interface BuiltPrompt {
  kind: PromptKind
  title: string
  /** Short note explaining what this prompt is for and where to paste it. */
  note: string
  text: string
  /** Fields still unresolved — the prompt is usable but incomplete. */
  missing: string[]
}

/** A card plus its resolved ancestors, used to build any prompt. */
export interface PromptContext {
  type: CardType
  fields: CardFields
  /** Ancestor cards keyed by type, nearest first is irrelevant — lookup by type. */
  ancestors: Partial<Record<CardType, CardFields>>
  /** Storyboard only. */
  scenes?: Scene[]
}

function val(fields: CardFields | undefined, key: string): string {
  const v = fields?.[key]?.value?.trim()
  return v || ''
}

function renderSection(schema: CardSchema, fields: CardFields): string {
  const out: string[] = []
  for (const section of schema.sections) {
    const lines: string[] = []
    for (const f of section.fields) {
      const v = val(fields, f.key)
      if (!v) continue
      lines.push(`${f.label}: ${v}`)
    }
    if (lines.length) {
      out.push(`────────────────────\n${section.title}\n${lines.join('\n')}`)
    }
  }
  return out.join('\n\n')
}

function missingFields(schema: CardSchema, fields: CardFields): string[] {
  return allFields(schema)
    .filter((f) => !val(fields, f.key))
    .map((f) => f.label)
}

/**
 * Inherited constraint block. Every protocol requires ancestor properties to be
 * restated as fixed and immutable rather than referenced, so downstream image and
 * video models receive them in full.
 */
function inheritedBlock(ctx: PromptContext): string {
  const idx = cardOrder.indexOf(ctx.type)
  const blocks: string[] = []
  for (const t of cardOrder.slice(0, idx)) {
    const anc = ctx.ancestors[t]
    if (!anc) continue
    const s = schemas[t]
    const lines = s.inheritedKeys
      .map((k) => {
        const f = allFields(s).find((x) => x.key === k)
        const v = val(anc, k)
        return f && v ? `${f.label}: ${v}` : ''
      })
      .filter(Boolean)
    if (lines.length) {
      blocks.push(`${s.type.toUpperCase()} CONSTRAINTS (fixed and immutable)\n${lines.join('\n')}`)
    }
  }
  return blocks.join('\n\n')
}

const WORLD_RULES = `WORLD RULES
Everything shown belongs exclusively to this fictional planet.
No references to Earth, humanity, terrestrial biology, terrestrial geography or real-world history.
No comparisons to terrestrial species.
The imagery must behave as if recorded by a crew that has no knowledge of Earth.`

/** The identity sheet — the card image itself. */
function buildSheet(ctx: PromptContext): BuiltPrompt {
  const schema = schemas[ctx.type]
  const parts = [schema.directive]

  const inherited = inheritedBlock(ctx)
  if (inherited) parts.push(inherited)

  const body = renderSection(schema, ctx.fields)
  if (body) parts.push(body)

  parts.push('────────────────────\n' + schema.promptTail)

  return {
    kind: 'sheet',
    title: 'Identity Sheet — kart görseli',
    note: 'Kartın kendisi. Bilimsel sunum panosu üreten görsel modeline yapıştırın (16:9).',
    text: parts.join('\n\n'),
    missing: missingFields(schema, ctx.fields),
  }
}

/** Descriptive summary of the subject, reused by both still and video prompts. */
function subjectSummary(ctx: PromptContext): string {
  const schema = schemas[ctx.type]
  const pick = (keys: string[]) =>
    keys
      .map((k) => {
        const f = allFields(schema).find((x) => x.key === k)
        const v = val(ctx.fields, k)
        return f && v ? `${f.label}: ${v}` : ''
      })
      .filter(Boolean)
      .join('\n')

  switch (ctx.type) {
    case 'planet':
      return pick([
        'planet_name',
        'planet_type',
        'surface_coloration',
        'dominant_terrain',
        'major_surface_features',
        'cloud_system',
        'atmospheric_optics',
        'sky_appearance',
        'nearby_celestial_bodies',
        'parent_star_appearance',
      ])
    case 'ecosystem':
      return pick([
        'ecosystem_name',
        'biome_type',
        'dominant_habitat_types',
        'primary_producers',
        'apex_organisms',
        'dominant_environmental_conditions',
        'environmental_gradients',
      ])
    case 'species':
      return pick([
        'species_name',
        'body_size',
        'body_plan',
        'overall_body_structure',
        'external_covering',
        'locomotion_structures',
        'sensory_organs',
        'defensive_structures',
        'activity_pattern',
        'social_organization',
        'foraging_strategy',
      ])
    case 'location':
      return pick([
        'location_name',
        'location_type',
        'dominant_terrain',
        'major_geological_features',
        'surface_materials',
        'hydrological_features',
        'environmental_layers',
        'primary_landmark',
        'secondary_landmarks',
        'lighting_conditions',
        'atmospheric_visibility',
        'weather_patterns',
        'visual_identity',
      ])
    default:
      return ''
  }
}

/** The four identity sheets; the storyboard builds its prompts separately. */
type SheetType = Exclude<CardType, 'storyboard'>

const STILL_FRAMING: Record<SheetType, string> = {
  planet:
    'Single ultra-photorealistic astronomical still of the planet seen from orbit. Long lens, no lens flare theatrics, physically correct terminator line and atmospheric limb.',
  ecosystem:
    'Single ultra-photorealistic wide establishing still of the ecosystem. Natural documentary framing, long telephoto compression, no subject staged for the camera.',
  species:
    'Single ultra-photorealistic wildlife documentary still of the organism in its natural habitat, undisturbed and unaware of the camera. Long telephoto lens, authentic optical depth of field, natural pose.',
  location:
    'Single ultra-photorealistic wide establishing still of the location. Natural documentary framing, physically correct atmospheric perspective.',
}

const VIDEO_ACTION: Record<SheetType, string> = {
  planet:
    'Extremely slow orbital drift across the planet, terminator line advancing naturally. No cuts. No camera acrobatics.',
  ecosystem:
    'Slow observational pan across the ecosystem, revealing its vertical layers and ambient activity. No cuts.',
  species:
    'The organism performs one natural, uninterrupted behavior drawn from its documented biology — foraging, locomotion or resting. No staged action, no dramatic acting, no reaction to the camera. No cuts.',
  location:
    'Slow observational push across the location, revealing its primary landmark and environmental depth. No cuts.',
}

const AUDIO_BLOCK = `AUDIO
Only natural diegetic environmental audio.
No music. No soundtrack. No score.
No narration. No voice-over. No subtitles.
No artificial sound design. No exaggerated cinematic sound effects.
Every sound must originate naturally from the environment visible within the frame.
Sound must remain spatially accurate and synchronized with the camera position.
Foreground sounds dominate nearby events; distant environmental ambience stays subtle.`

function buildStill(ctx: PromptContext): BuiltPrompt {
  const schema = schemas[ctx.type]
  const parts: string[] = [
    `Ultra-photorealistic single-frame still from a fictional nature documentary. ${STILL_FRAMING[ctx.type as SheetType]}`,
    WORLD_RULES,
  ]

  const inherited = inheritedBlock(ctx)
  if (inherited) parts.push(inherited)

  const subject = subjectSummary(ctx)
  if (subject) parts.push(`SUBJECT\n${subject}`)

  parts.push(`PHOTOGRAPHY
Professional BBC / National Geographic wildlife cinematography.
Physically accurate illumination consistent with the stated stellar environment and atmosphere.
Natural contrast, high dynamic range, no stylized grading.
Realistic autofocus, authentic optical depth of field, physically correct lens behavior.
Scientific observational tone. No cinematic exaggeration. No fantasy aesthetics.

NEGATIVE
No text, no watermarks, no logos, no UI overlays.
No humans, no human artifacts, no spacecraft, no structures.
No Earth flora or fauna. No concept-art rendering. No illustration. No CGI look.`)

  return {
    kind: 'still',
    title: 'Tek Kare Görsel — final prompt',
    note: 'Tek fotoğraf üretimi için. Görsel modeline olduğu gibi yapıştırın.',
    text: parts.join('\n\n'),
    missing: missingFields(schema, ctx.fields),
  }
}

function buildVideo(ctx: PromptContext): BuiltPrompt {
  const schema = schemas[ctx.type]
  const parts: string[] = [
    `Generate an ultra-photorealistic fictional AI-generated nature documentary shot. Live-action. Single continuous take.`,
    WORLD_RULES,
  ]

  const inherited = inheritedBlock(ctx)
  if (inherited) parts.push(inherited)

  const subject = subjectSummary(ctx)
  if (subject) parts.push(`SUBJECT\n${subject}`)

  parts.push(`ACTION\n${VIDEO_ACTION[ctx.type as SheetType]}`)

  parts.push(`CAMERA
Professional wildlife documentary cinematography.
Long telephoto wildlife lens. Natural handheld stabilization.
Smooth observational movement. Slow controlled pan.
Realistic autofocus, authentic optical depth of field, physically correct lens behavior.
Natural camera operator imperfections. Consistent exposure adaptation. High dynamic range.

LIGHTING & COLOR
Physically accurate illumination consistent with the stated stellar environment and atmosphere.
Realistic atmospheric haze. Natural contrast. No stylized grading.

STYLE
BBC Planet Earth. Scientific. Observational. Patient. Immersive. Objective.
No cinematic spectacle. No dramatic acting. No fantasy aesthetics.
Every movement must emerge naturally from the organism's biology and environment.`)

  parts.push(AUDIO_BLOCK)

  return {
    kind: 'video',
    title: 'Video — final prompt',
    note: 'Seedance / Higgsfield gibi video modeline yapıştırın. Tek plan, kesme yok.',
    text: parts.join('\n\n'),
    missing: missingFields(schema, ctx.fields),
  }
}

/** The shared header every storyboard-derived prompt opens with. */
function storyboardCommon(ctx: PromptContext): string {
  const f = (k: string) => val(ctx.fields, k)
  const lines = [
    f('common_camera') && `COMMON CAMERA CHARACTERISTICS\n${f('common_camera')}`,
    f('common_lighting') && `COMMON LIGHTING & COLOR\n${f('common_lighting')}`,
    f('common_environment') && `COMMON ENVIRONMENT\n${f('common_environment')}`,
    f('common_style') && `COMMON STYLE / TONE\n${f('common_style')}`,
  ].filter(Boolean)
  return lines.join('\n\n')
}

/** One scene rendered as a standalone, production-ready video prompt. */
export function sceneVideoPrompt(ctx: PromptContext, scene: Scene): string {
  const parts = [
    `Generate an ultra-photorealistic fictional AI-generated nature documentary shot. Live-action. Single continuous take, ${scene.timestamp_start} – ${scene.timestamp_end}.`,
    WORLD_RULES,
  ]
  const inherited = inheritedBlock(ctx)
  if (inherited) parts.push(inherited)

  const common = storyboardCommon(ctx)
  if (common) parts.push(common)

  parts.push(`SHOT
Shot Type: ${scene.shot_type}
Camera Angle: ${scene.camera_angle}
Camera Movement: ${scene.camera_movement}

ACTION
${scene.visual_prompt}`)

  parts.push(`AUDIO
${scene.audio}

No music. No soundtrack. No score.
No narration. No voice-over. No subtitles.
Every sound must originate naturally from the environment visible within the frame.`)
  return parts.join('\n\n')
}

function buildStoryboardPrompts(ctx: PromptContext): BuiltPrompt[] {
  const scenes = ctx.scenes ?? []
  const schema = schemas.storyboard
  const missing = missingFields(schema, ctx.fields)
  if (!scenes.length) missing.unshift('Sahneler')

  const inherited = inheritedBlock(ctx)
  const common = storyboardCommon(ctx)
  const planet = val(ctx.ancestors.planet, 'planet_name') || '[Planet]'
  const species = val(ctx.ancestors.species, 'species_name') || '[Species]'
  const location = val(ctx.ancestors.location, 'location_name') || '[Location]'

  // The board itself, following the master prompt's STORYBOARD PROMPT TEMPLATE
  // section for section: header, common blocks, then one full SCENE block per
  // frame. A frame line carrying only a timestamp and description was not the
  // template, and it dropped the camera language the image model needs.
  const duration = val(ctx.fields, 'target_duration') || '15 seconds'
  const pad = (i: number) => String(i + 1).padStart(2, '0')
  const coreDirective = schema.directive.includes('CORE DIRECTIVE')
    ? schema.directive.slice(schema.directive.indexOf('CORE DIRECTIVE'))
    : schema.directive
  const outputTail = schema.promptTail.includes('OUTPUT')
    ? schema.promptTail.slice(schema.promptTail.indexOf('OUTPUT'))
    : schema.promptTail

  const sceneBlocks = scenes.map(
    (s, i) => `SCENE ${pad(i)}
Timestamp:
${s.timestamp_start}–${s.timestamp_end}
Scene Description
${s.scene_description}
Camera Angle
${s.camera_angle}
Shot Type
${s.shot_type}
Camera Movement
${s.camera_movement}
Visual Prompt
${s.visual_prompt}
Audio
${s.audio}
Voice-over
${s.voice_over}`,
  )

  const board = [
    `Create a premium AAA ecosystem storyboard image using the supplied Planet Identity Sheet, Ecosystem Identity Sheet, Species Identity Sheet, Location Identity Sheet. For an ultra-photorealistic fictional ${duration} AI-generated nature documentary filmed on **${planet}**, capturing **${species}** during its natural daily life inside **${location}**.
The storyboard must faithfully preserve the cinematographic language of the selected reference shots while adapting every visual, biological and environmental element to the fictional world.
Compose the storyboard as a **16:9 production board** containing **${scenes.length || '[Number of Frames]'}** storyboard frames.
Each frame represents one scene and contains a **vertical 9:16 preview image**.
Below every frame include:
• Timestamp
• Scene Description`,
    coreDirective,
    WORLD_RULES,
    inherited,
    common,
    ...sceneBlocks,
    outputTail,
  ]
    .filter(Boolean)
    .join('\n\n────────────────────\n\n')

  // The whole sequence as one video brief.
  const sequence = [
    `Generate an ultra-photorealistic fictional AI-generated nature documentary sequence filmed entirely on ${planet}, observing ${species} naturally within ${location}.`,
    WORLD_RULES,
    inherited,
    common,
    scenes
      .map(
        (s, i) =>
          `SCENE ${String(i + 1).padStart(2, '0')}\nTimestamp: ${s.timestamp_start} – ${s.timestamp_end}\nShot: ${s.shot_type} | ${s.camera_angle} | ${s.camera_movement}\nVideo Prompt: ${s.visual_prompt}\nAudio: ${s.audio}`,
      )
      .join('\n\n'),
    `The sequence must preserve scene order, timestamps, pacing, framing, camera language and documentary rhythm exactly as written above.
Ultra-photorealistic live-action. Professional BBC / National Geographic style wildlife cinematography.
No staged actions. No cinematic exaggeration. No fantasy aesthetics.`,
    AUDIO_BLOCK,
  ]
    .filter(Boolean)
    .join('\n\n────────────────────\n\n')

  // Narration is kept apart on purpose: the video prompt forbids voice-over, so
  // it belongs in a separate voice pass rather than in the generation prompt.
  const narration = scenes
    .map((s, i) => `${String(i + 1).padStart(2, '0')}  ${s.timestamp_start}–${s.timestamp_end}\n${s.voice_over}`)
    .join('\n\n')

  return [
    {
      kind: 'sheet',
      title: 'Storyboard Panosu — final prompt',
      note: 'Tüm kareleri içeren 16:9 pano görseli. Görsel modeline yapıştırın.',
      text: board,
      missing,
    },
    {
      kind: 'still',
      title: 'Anlatım Metni — sahne sahne',
      note: 'Video promptu anlatımı yasaklar; bu metin ayrı bir seslendirme katmanı içindir.',
      text: narration || '(Henüz sahne yok.)',
      missing,
    },
    {
      kind: 'video',
      title: 'Sekans — final video prompt',
      note: 'Tüm sekans tek brief olarak. Sahne bazlı promptlar için sahne tablosundaki kopyala düğmelerini kullanın.',
      text: sequence,
      missing,
    },
  ]
}

export function buildPrompts(ctx: PromptContext): BuiltPrompt[] {
  if (ctx.type === 'storyboard') return buildStoryboardPrompts(ctx)
  return [buildSheet(ctx), buildStill(ctx), buildVideo(ctx)]
}
