import { useCallback, useSyncExternalStore } from 'react'
import { MODELS } from './anthropic'
import type { Effort } from './anthropic'

/**
 * The Anthropic key is no longer held here — it lives in the edge function's
 * environment. Only display preferences remain client-side.
 */
const MODEL_STORAGE = 'dc.model'
const EFFORT_STORAGE = 'dc.effort'

const listeners = new Set<() => void>()
function emit() {
  listeners.forEach((l) => l())
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b'

/**
 * Defaults to the free provider; a stored choice wins only if it still exists.
 *
 * Providers withdraw models from their catalogue without notice, and a
 * withdrawn one answers 410. The stored id outlives the deployment that
 * offered it, so a browser that had selected a since-retired model would keep
 * failing after the fix shipped — the setting has to be checked, not trusted.
 */
export function getModel(): string {
  const stored = localStorage.getItem(MODEL_STORAGE)
  if (stored && MODELS.some((m) => m.id === stored)) return stored
  return DEFAULT_MODEL
}

/**
 * Thinking depth. The model thinks by default and thinking is billed as output
 * tokens, so this is the single biggest cost dial in the app. Medium keeps the
 * inference quality the sheets need at a fraction of the high-effort spend.
 */
export function getEffort(): Effort {
  const v = localStorage.getItem(EFFORT_STORAGE)
  return v === 'low' || v === 'high' ? v : 'medium'
}

export function useSettings() {
  const model = useSyncExternalStore(subscribe, getModel)
  const effort = useSyncExternalStore(subscribe, getEffort)

  const setModel = useCallback((v: string) => {
    localStorage.setItem(MODEL_STORAGE, v)
    emit()
  }, [])
  const setEffort = useCallback((v: Effort) => {
    localStorage.setItem(EFFORT_STORAGE, v)
    emit()
  }, [])

  return { model, setModel, effort, setEffort }
}
