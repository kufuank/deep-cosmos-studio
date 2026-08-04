import { useCallback, useSyncExternalStore } from 'react'

/**
 * The Anthropic key is no longer held here — it lives in the edge function's
 * environment. Only display preferences remain client-side.
 */
const MODEL_STORAGE = 'dc.model'

const listeners = new Set<() => void>()
function emit() {
  listeners.forEach((l) => l())
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function getModel(): string {
  return localStorage.getItem(MODEL_STORAGE) ?? 'claude-sonnet-5'
}

export function useSettings() {
  const model = useSyncExternalStore(subscribe, getModel)

  const setModel = useCallback((v: string) => {
    localStorage.setItem(MODEL_STORAGE, v)
    emit()
  }, [])

  return { model, setModel }
}
