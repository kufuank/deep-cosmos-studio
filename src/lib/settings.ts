import { useCallback, useSyncExternalStore } from 'react'
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

/** Defaults to the free provider; a stored choice always wins. */
export function getModel(): string {
  return localStorage.getItem(MODEL_STORAGE) ?? 'nvidia/llama-3.3-nemotron-super-49b-v1.5'
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
