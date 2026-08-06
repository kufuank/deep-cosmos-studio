export type CardType = 'planet' | 'ecosystem' | 'species' | 'location' | 'storyboard'

/** Lifecycle of a single field inside a card. */
export type FieldState =
  | 'missing' // never filled
  | 'inferred' // the agent derived it; needs review
  | 'confirmed' // the user supplied or accepted it

export interface FieldValue {
  value: string
  state: FieldState
  /** Why the agent chose this value. Required by every protocol for inferred values. */
  reasoning?: string
}

export interface FieldDef {
  key: string
  label: string
  /** The bracketed guidance from the master prompt template. */
  hint: string
  examples?: string[]
  multiline?: boolean
}

export interface SectionDef {
  id: string
  title: string
  fields: FieldDef[]
}

export interface CardSchema {
  type: CardType
  /** Human label, Turkish UI. */
  label: string
  /** Card this one inherits immutable constraints from. */
  parent: CardType | null
  /** Opening line of the generated image prompt. */
  directive: string
  sections: SectionDef[]
  /** Static tail of the image prompt: layout, visual reference, callouts, consistency. */
  promptTail: string
  /** Fields whose values are quoted into child cards as fixed constraints. */
  inheritedKeys: string[]
}

export type CardFields = Record<string, FieldValue>

export function allFields(schema: CardSchema): FieldDef[] {
  return schema.sections.flatMap((s) => s.fields)
}

export function fieldStats(schema: CardSchema, fields: CardFields) {
  const defs = allFields(schema)
  let confirmed = 0
  let inferred = 0
  for (const d of defs) {
    const f = fields[d.key]
    if (!f || !f.value.trim()) continue
    if (f.state === 'confirmed') confirmed++
    else if (f.state === 'inferred') inferred++
  }
  return {
    total: defs.length,
    confirmed,
    inferred,
    missing: defs.length - confirmed - inferred,
    resolved: confirmed + inferred,
  }
}
