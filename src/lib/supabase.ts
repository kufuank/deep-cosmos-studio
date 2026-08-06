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

export interface ProposalRow {
  id: string
  owner: string
  agent: CardType
  from_version: number
  proposed_protocol: string
  rationale: string
  expected_benefit: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  decided_at: string | null
}

export interface ShotListRow {
  id: string
  owner: string
  title: string
  source_kind: 'file' | 'youtube'
  source_ref: string
  duration_seconds: number | null
  status: 'draft' | 'analyzing' | 'ready' | 'locked' | 'failed'
  error: string | null
  notes: string
  created_at: string
  updated_at: string
}

export interface ShotRow {
  id: string
  shot_list_id: string
  owner: string
  ordinal: number
  start_seconds: number
  end_seconds: number
  timecode_start: string
  timecode_end: string
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
  created_at: string
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
