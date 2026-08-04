import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function Auth() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMsg('Hesap oluşturuldu. E-posta onayı istenirse gelen kutunuzu kontrol edin.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Giriş başarısız.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-slate-100">Deep Cosmos Studio</h1>
          <p className="text-sm text-slate-500 mt-1">Dünya inşa hattı</p>
        </div>

        <form onSubmit={submit} className="card p-5 space-y-4">
          <div>
            <label className="label">E-posta</label>
            <input
              className="input"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Parola</label>
            <input
              className="input"
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {err && <p className="text-sm text-red-400">{err}</p>}
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}

          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Bekleyin…' : mode === 'signin' ? 'Giriş yap' : 'Hesap oluştur'}
          </button>

          <button
            type="button"
            className="w-full text-xs text-slate-500 hover:text-slate-300"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setErr(null)
              setMsg(null)
            }}
          >
            {mode === 'signin' ? 'Hesabınız yok mu? Oluşturun' : 'Zaten hesabınız var mı? Giriş yapın'}
          </button>
        </form>
      </div>
    </div>
  )
}
