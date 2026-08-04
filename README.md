# Deep Cosmos Studio

Faz 3 dünya inşa hattı. Gezegen → Ekosistem → Tür → Mekân zincirini yürüten,
her kartı alan bazında takip eden ve sonunda kopyalanmaya hazır final promptlar
üreten bir web uygulaması.

Kaynak: `DEEP COSMOS` klasöründeki MASTER PROMPTS / PROTOCOLS / CORE REFERENCE
DOCUMENT belgeleri. Şablonlar bu belgelerden birebir çıkarılmıştır.

## Ne yapıyor

Her kart, ilgili master prompt şablonunun tipli bir şemasıdır — Gezegen 59 alan,
Ekosistem 49, Tür 48, Mekân 31. Her alanın üç durumu var: **boş**, **çıkarım**
(ajan türetti, gerekçesiyle birlikte) ve **onaylı** (siz verdiniz veya kabul
ettiniz).

Ajan sizinle Türkçe konuşur, eksik alanları sorar ve `set_fields` aracıyla
doğrudan sayfaya yazar — değerleri sohbet metnine yazmaz. Alan değerleri
İngilizce tutulur çünkü doğrudan görsel ve video modellerine yapıştırılır.

Bir kart kilitlendiğinde değişmez hale gelir ve alt kartlar onu sabit kısıt
olarak devralır. Kilit veritabanı seviyesinde de korunur.

## Final promptlar

Her kart üç hazır prompt üretir, hepsi tek tıkla kopyalanır:

| Prompt | Ne için |
|---|---|
| **Kimlik Sayfası** | Kartın kendisi — bilimsel sunum panosu görseli |
| **Tek Kare Görsel** | Tek fotoğraf üretimi |
| **Video** | Seedance / Higgsfield gibi video modelleri |

Üst kartların kısıtları her prompta tam metin olarak gömülür; referansla değil,
yeniden yazılarak — böylece görsel/video modeli eksiksiz bağlam alır.

## Kurulum

```bash
npm install
npm run dev
```

Uygulamayı ilk açtığınızda:

1. Bir hesap oluşturun (Supabase Auth, e-posta + parola).
2. **Ayarlar** → Anthropic API anahtarınızı girin.

Anahtar yalnızca tarayıcınızın `localStorage`'ında durur. Sunucu yok; istekler
doğrudan tarayıcıdan `api.anthropic.com`'a gider.

## Komutlar

```bash
npm run dev        # geliştirme sunucusu
npm run build      # üretim derlemesi
npm run smoke      # şema ve prompt mantığı testleri
npm run typecheck  # tip kontrolü
```

## Veri

Supabase projesi `deep-cosmos`, tablolar `dc_worlds` ve `dc_cards`. Önek
kasıtlı: aynı projedeki önceki faz tabloları ayrı durur ve etkilenmez.

RLS açık, her satır `auth.uid()` ile sahibine bağlı — publishable key tek başına
kimseye erişim vermez.

## Henüz yok

Faz 2 ve sonrası: Shot Library (video çözümleme), Storyboard ajanı, Video
prompt ajanı, render kuyruğu, protokol sürümleme.
