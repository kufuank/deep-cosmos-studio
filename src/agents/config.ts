import { supabase } from '../lib/supabase'
import type { CardType } from '../schemas'
import { agentInstructions, protocolText } from './instructions'

/**
 * Agent role, knowledge and protocol come from `dc_agents` so they can evolve
 * through the improvement-proposal loop the source documents describe. The
 * transcribed constants remain as a fallback for a cold or unreachable database.
 */
export interface AgentConfig {
  agent: CardType
  version: number
  role: string
  knowledge: string
  protocol: string
  /** True when this came from the transcribed constants, not the database. */
  fallback: boolean
}

function builtin(type: CardType): AgentConfig {
  const inst = agentInstructions[type]
  return {
    agent: type,
    version: 0,
    role: inst.role,
    knowledge: inst.knowledge,
    protocol: protocolText(type),
    fallback: true,
  }
}

let cache: Partial<Record<CardType, AgentConfig>> = {}

export function clearAgentConfigCache() {
  cache = {}
}

export async function loadAgentConfig(type: CardType): Promise<AgentConfig> {
  const hit = cache[type]
  if (hit) return hit

  const { data, error } = await supabase
    .from('dc_agents')
    .select('agent, version, role, knowledge, protocol, owner')
    .eq('agent', type)
    .eq('active', true)
    // A user's own override outranks the built-in row (owner is null).
    .order('owner', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) {
    const fb = builtin(type)
    cache[type] = fb
    return fb
  }

  const cfg: AgentConfig = {
    agent: type,
    version: data.version,
    role: data.role,
    knowledge: data.knowledge ?? '',
    protocol: data.protocol,
    fallback: false,
  }
  cache[type] = cfg
  return cfg
}
