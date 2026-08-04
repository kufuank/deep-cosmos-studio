# Deep Cosmos Studio

Faz 3 dünya inşa hattı. Gezegen → Ekosistem → Tür → Mekân zincirini yürüten,
her kartı alan bazında takip eden ve sonunda kopyalanmaya hazır final promptlar
üreten bir web uygulaması.

Kaynak: `DEEP COSMOS` klasöründeki MASTER PROMPTS / PROTOCOLS / CORE REFERENCE
DOCUMENT belgeleri. Şablonlar bu belgelerden birebir çıkarılmıştır.

## Mimari

```
Tarayıcı (statik SPA, GitHub Pages)
   │  Supabase oturum tokenı
   ▼
Edge Function `anthropic`  ── ANTHROPIC_API_KEY burada durur
   ▼
api.anthropic.com

Postgres: dc_worlds · dc_cards · dc_messages · dc_agents · dc_assets
          dc_reference_items · dc_protocol_proposals
```

Uygulamanın sunucusu Supabase Edge Function'dır. API anahtarı hiçbir zaman
tarayıcıya inmez. Fonksiyon her isteği Auth API üzerinden gerçek bir kullanıcı
oturumuna çözer — Supabase'in `verify_jwt` ayarı tek başına yetmez, çünkü
publishable anahtar bu depoda yayımlıdır ve ağ geçidi onu kabul eder.

## Ne yapıyor

Her kart, ilgili master prompt şablonunun tipli bir şemasıdır — Gezegen 59 alan,
Ekosistem 49, Tür 48, Mekân 31. Her alanın üç durumu var: **boş**, **çıkarım**
(ajan türetti, gerekçesiyle birlikte) ve **onaylı** (siz verdiniz veya kabul
ettiniz).

Ajan Türkçe konuşur, eksik alanları sorar ve `set_fields` aracıyla doğrudan
sayfaya yazar — değerleri sohbet metnine yazamaz. Alan değerleri İngilizce
tutulur çünkü doğrudan görsel ve video modellerine yapıştırılır.

Bir kart kilitlendiğinde değişmez hale gelir ve alt kartlar onu sabit kısıt
olarak devralır. Kilit veritabanı trigger'ıyla da korunur.

**Protokoller kodda değil, `dc_agents` tablosunda sürümlü satırlar olarak
durur.** Kaynak dokümanların öngördüğü iyileştirme-önerisi döngüsünün
çalışabilmesi için gereken temel bu. Veritabanına ulaşılamazsa uygulama
dokümanlardan aktarılan yerel kopyaya düşer.

## Final promptlar

Her kart üç hazır prompt üretir, hepsi tek tıkla kopyalanır:

| Prompt | Ne için |
|---|---|
| **Kimlik Sayfası** | Kartın kendisi — bilimsel sunum panosu görseli |
| **Tek Kare Görsel** | Tek fotoğraf üretimi |
| **Video** | Seedance / Higgsfield gibi video modelleri |

Üst kartların kısıtları her prompta referansla değil, tam metin olarak
gömülür — böylece görsel/video modeli eksiksiz bağlam alır.

## Kurulum

```bash
npm install
npm run dev
```

Sunucu tarafı için Supabase panelinde Edge Function secret'ı olarak
`ANTHROPIC_API_KEY` tanımlı olmalıdır. Tanımlı değilse uygulama sohbet
denemesinde bunu açıkça söyler.

## Komutlar

```bash
npm run dev        # geliştirme sunucusu
npm run build      # üretim derlemesi
npm run smoke      # şema ve prompt mantığı testleri
npm run seed:sql   # ajan yapılandırmalarının seed SQL'ini üretir
```

## Güvenlik

Tüm `dc_` tablolarında RLS açık ve her satır `auth.uid()` ile sahibine bağlı;
publishable anahtar tek başına kimseye erişim vermez.

Aynı Supabase projesindeki öneksiz tablolar emekliye ayrılmış faz 1/2 sistemine
aittir. RLS açık, politika yok — yani veri korunuyor ama dışarıdan erişilemiyor.
Silmeyin, yeniden kullanmayın.

## Henüz yok

Shot Library (video çözümleme), Storyboard ajanı, Video prompt ajanı, render
kuyruğu, uygulama içi görsel üretimi, reference library retrieval.
