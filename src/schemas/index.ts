import type { CardSchema, CardType } from './types'
import { planetSchema } from './planet'
import { ecosystemSchema } from './ecosystem'
import { speciesSchema } from './species'
import { locationSchema } from './location'
import { storyboardSchema } from './storyboard'

export const schemas: Record<CardType, CardSchema> = {
  planet: planetSchema,
  ecosystem: ecosystemSchema,
  species: speciesSchema,
  location: locationSchema,
  storyboard: storyboardSchema,
}

/** Pipeline order — each card inherits every card before it as fixed constraint. */
export const cardOrder: CardType[] = [
  'planet',
  'ecosystem',
  'species',
  'location',
  'storyboard',
]

/** The storyboard is scene-based rather than a field sheet. */
export function isSceneCard(t: CardType): boolean {
  return t === 'storyboard'
}

export { storyboardSchema }
export type { Scene } from './storyboard'
export { SCENE_FIELDS } from './storyboard'

export * from './types'
