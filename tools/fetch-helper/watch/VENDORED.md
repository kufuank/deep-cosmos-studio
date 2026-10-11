# Vendored: bradautomates/claude-video — `skills/watch/scripts`

- Kaynak: https://github.com/bradautomates/claude-video
- Sürüm: 0.3.2 (commit `03ceb42`), MIT — bkz. `LICENSE`
- Dosyalar **değiştirilmeden** kopyalandı. Güncellemek için yeni sürümün
  `skills/watch/scripts/*.py` dosyalarını buraya olduğu gibi kopyalayın.

Script'ler düz import kullanır (`from runtime import ...`), bu yüzden bu dizin bir
Python paketi değildir. Yalnızca `../server.py` kullanır: dizini `sys.path`'e ekler,
`download.fetch_captions` / `download.download` (yt-dlp ile indirme, tek altyazı izi
seçimi) ve `transcribe.parse_vtt` çağırır. Kesme ölçümü tarayıcıda (`src/lib/video.ts`)
kalır; buradaki kare çıkarma kodu kullanılmaz.
