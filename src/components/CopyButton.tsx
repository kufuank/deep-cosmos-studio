import { useEffect, useState } from 'react'

export function CopyButton({
  text,
  label = 'Kopyala',
  className = 'btn-primary',
}: {
  text: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Clipboard API needs a secure context; fall back to a selection copy.
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        setCopied(true)
      } finally {
        document.body.removeChild(ta)
      }
    }
  }

  return (
    <button type="button" onClick={copy} className={className}>
      {copied ? '✓ Kopyalandı' : label}
    </button>
  )
}
