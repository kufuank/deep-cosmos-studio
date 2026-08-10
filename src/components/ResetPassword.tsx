import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errors'

/**
 * Shown when the user arrives on a recovery link.
 *
 * Supabase signs them in with a short-lived recovery session, so setting the new
 * password is just updateUser — no token handling here. Without this screen the
 * recovery link lands on the sign-in form and appears to do nothing, which is
 * what drove people to keep creating fresh accounts.
 */
export function ResetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setErr('Parolalar eşleşmiyor.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setDone(true)
    } catch (e) {
      setErr(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-slate-100">Yeni parola belirleyin</h1>
          <p className="text-sm text-slate-500 mt-1">Sıfırlama bağlantısıyla geldiniz</p>
        </div>

        {done ? (
          <div className="card p-5 space-y-4">
            <p className="text-sm text-emerald-400">
              Parolanız güncellendi. Artık bu parolayla giriş yapabilirsiniz.
            </p>
            <button className="btn-primary w-full" onClick={onDone}>
              Uygulamaya devam et
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="card p-5 space-y-4">
            <div>
              <label className="label">Yeni parola</label>
              <input
                className="input"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Yeni parola (tekrar)</label>
              <input
                className="input"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>

            {err && <p className="text-sm text-red-400">{err}</p>}

            <button className="btn-primary w-full" disabled={busy}>
              {busy ? 'Kaydediliyor…' : 'Parolayı güncelle'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
