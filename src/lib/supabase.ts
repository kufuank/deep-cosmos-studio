import { createClient } from '@supabase/supabase-js'
import type { CardFields, CardType } from '../schemas'

/**
 * Publishable key only — every table is protected by row level security keyed on
 * auth.uid(), so this key on its own grants no access to anyone's data.
 */
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://fypbcazbdjtcrhkkfrtr.supabase.co'
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_flcsVWCjB0MTecdWx0Jb8Q_V_DbKn5Q'

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
})

export interface WorldRow {
  id: string
  owner: string
  name: string
  brief: string
  created_at: string
  updated_at: string
}

export interface CardRow {
  id: string
  world_id: string
  owner: string
  type: CardType
  parent_id: string | null
  title: string
  fields: CardFields
  status: 'draft' | 'locked'
  locked_at: string | null
  created_at: string
  updated_at: string
}

/** Chat lives in its own table so a long conversation is not rewritten on
 *  every field edit. */
export interface MessageRow {
  id: string
  card_id: string
  owner: string
  role: 'user' | 'assistant'
  text: string
  /** Field keys written during this assistant turn, shown in the transcript. */
  wrote: string[]
  created_at: string
}
