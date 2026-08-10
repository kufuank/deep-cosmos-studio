import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errors'

type Mode = 'signin' | 'signup' | 'forgot'

/** Where Supabase should send the user back to after a recovery link. */
export function appUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

export function Auth() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  function switchTo(next: Mode) {
    setMode(next)
    setErr(null)
    setMsg(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: appUrl(),
        })
        if (error) throw error
        setMsg(
          'Sıfırlama bağlantısı gönderildi. Gelen kutunuzu kontrol edin — bağlantı sizi buraya geri getirecek.',
        )
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: appUrl() },
        })
        if (error) throw error
        setMsg('Hesap oluşturuldu. E-posta onayı istenirse gelen kutunuzu kontrol edin.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (e) {
      setErr(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  const title =
    mode === 'forgot' ? 'Şifre sıfırlama' : mode === 'signup' ? 'Hesap oluştur' : 'Giriş yap'

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

          {mode !== 'forgot' && (
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
          )}

          {mode === 'forgot' && (
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Kayıtlı adresinizi girin; size bir sıfırlama bağlantısı göndeririz. Bağlantı bu
              uygulamayı açar ve yeni parolanızı orada belirlersiniz.
            </p>
          )}

          {err && <p className="text-sm text-red-400">{err}</p>}
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}

          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Bekleyin…' : title}
          </button>

          <div className="flex flex-col gap-1.5 pt-1">
            {mode !== 'signin' && (
              <button
                type="button"
                className="w-full text-xs text-slate-500 hover:text-slate-300"
                onClick={() => switchTo('signin')}
              >
                Giriş ekranına dön
              </button>
            )}
            {mode === 'signin' && (
              <>
                <button
                  type="button"
                  className="w-full text-xs text-slate-500 hover:text-slate-300"
                  onClick={() => switchTo('signup')}
                >
                  Hesabınız yok mu? Oluşturun
                </button>
                <button
                  type="button"
                  className="w-full text-xs text-slate-500 hover:text-slate-300"
                  onClick={() => switchTo('forgot')}
                >
                  Şifremi unuttum
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
