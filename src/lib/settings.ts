import { useCallback, useSyncExternalStore } from 'react'

/**
 * The Anthropic key never leaves this browser — it is not sent to Supabase and
 * there is no server in this app. Each operator supplies their own.
 */
const KEY_STORAGE = 'dc.anthropic_key'
const MODEL_STORAGE = 'dc.model'

const listeners = new Set<() => void>()
function emit() {
  listeners.forEach((l) => l())
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? ''
}
export function getModel(): string {
  return localStorage.getItem(MODEL_STORAGE) ?? 'claude-sonnet-5'
}

export function useSettings() {
  const apiKey = useSyncExternalStore(subscribe, getApiKey)
  const model = useSyncExternalStore(subscribe, getModel)

  const setApiKey = useCallback((v: string) => {
    if (v) localStorage.setItem(KEY_STORAGE, v)
    else localStorage.removeItem(KEY_STORAGE)
    emit()
  }, [])

  const setModel = useCallback((v: string) => {
    localStorage.setItem(MODEL_STORAGE, v)
    emit()
  }, [])

  return { apiKey, model, setApiKey, setModel }
}
