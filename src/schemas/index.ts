import type { CardSchema, CardType } from './types'
import { planetSchema } from './planet'
import { ecosystemSchema } from './ecosystem'
import { speciesSchema } from './species'
import { locationSchema } from './location'

export const schemas: Record<CardType, CardSchema> = {
  planet: planetSchema,
  ecosystem: ecosystemSchema,
  species: speciesSchema,
  location: locationSchema,
}

/** Pipeline order — each card inherits every card before it as fixed constraint. */
export const cardOrder: CardType[] = ['planet', 'ecosystem', 'species', 'location']

export * from './types'
