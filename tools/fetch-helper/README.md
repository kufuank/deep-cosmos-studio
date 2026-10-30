# Yerel video yardımcısı

Shot Library'ye **link** ile referans video eklemek için (YouTube, Instagram, TikTok,
Vimeo, doğrudan mp4). Dosya yüklemek için gerekmez.

**Neden yerel?** Linkten video indirmek yt-dlp ister. Tarayıcı onu çalıştıramaz; Supabase
Edge Function da işe yaramaz, çünkü bu siteler veri merkezi IP'lerini engeller. Yardımcı
sizin bilgisayarınızda çalışır, videoyu indirir ve tarayıcıya verir. Kesme ölçümü ve
çözümleme eskisi gibi tarayıcıda yapılır.

## Kurulum (bir kez)

Python 3.10+ gerekir.

```bash
python -m pip install -r tools/fetch-helper/requirements.txt
```

Bu komut yt-dlp, YouTube için Deno ve ffmpeg'i (sistemde yoksa) kurar.

## Kullanım

```bash
npm run fetch-helper
```

Pencere açık kaldığı sürece Shot Library'deki **Linkten getir** çalışır. Chrome
yayındaki siteden (github.io) ilk kullanımda "yerel ağdaki cihazlara erişim" izni
isteyebilir; izin verin.

## Ne yapar, ne yapmaz

- Yalnızca `127.0.0.1:8765`'e bağlanır; ağdaki başka cihazlar erişemez.
- Yalnızca stüdyonun adreslerinden (github.io ve yerel geliştirme) gelen tarayıcı
  isteklerini kabul eder; başka bir site yardımcıyı kullanamaz.
- Videonun kendi altyazısını alır. Altyazı varsa her planın `audio_notes` alanına o
  plan sırasında söylenen anlatım yazılır. Müzik ve ortam sesi belirlenemez olarak kalır.
- İndirilen dosyalar geçici klasörde tutulur, 2 saat sonra ya da yardımcı kapanınca silinir.
- TLS doğrulamasını kapatmaz. Kurumsal proxy gibi TLS'i kesen ortamlarda yt-dlp'nin
  işletim sistemi sertifika deposunu kullanmasını sağlar.

Ayarlar: `DC_FETCH_PORT` (port), `DC_FETCH_ORIGINS` (virgülle ek izinli adresler),
`FFMPEG_BIN` (ffmpeg yolu).

## Sorun giderme

| Belirti | Ne yapmalı |
|---|---|
| "Yerel video yardımcısına ulaşılamadı" | `npm run fetch-helper` açık mı? Tarayıcı izin istediyse verdiniz mi? |
| 403 / "Sign in to confirm you're not a bot" | yt-dlp'yi güncelleyin: `python -m pip install -U "yt-dlp[default,curl-cffi]"` |
| `CERTIFICATE_VERIFY_FAILED` | Kesen proxy'nin kök sertifikası Windows deposunda olmalı. Doğrulamayı kapatmayın. |
| pip kurulumunda `CERTIFICATE_VERIFY_FAILED` | `truststore` kuruluysa `python -m pip install --use-feature=truststore -r ...`. Değilse Windows köklerini dışa aktarıp verin: `python -c "import ssl;open('roots.pem','w').write(''.join(ssl.DER_cert_to_PEM_cert(d) for s in ('ROOT','CA') for d,e,_ in ssl.enum_certificates(s) if e=='x509_asn'))"` ardından `python -m pip install --cert roots.pem -r ...`. `--trusted-host` kullanmayın. |
| `Could not open requirements file` / `Missing script: fetch-helper` | Komutları stüdyo klasöründe (`deep-cosmos-studio`) çalıştırın. |

İndirme kısmı [bradautomates/claude-video](https://github.com/bradautomates/claude-video)
"watch" betiklerini kullanır (MIT, `watch/VENDORED.md`).
