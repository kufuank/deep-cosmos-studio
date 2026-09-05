# Devam Notu

Bu dosya, projeye ara verip döndüğünüzde **ilk okunacak** yerdir. Amacı, bir
önceki oturumda pahalıya öğrenilen şeylerin yeniden keşfedilmesini önlemek.

Son güncelleme: 19 Ağustos 2026.

---

## Bir bakışta

Deep Cosmos faz 3: hayali gezegenlerde geçen sahte doğa belgeselleri üretmek için
kurulan çok ajanlı hat. Kaynak spesifikasyon, kardeş klasördeki `DEEP COSMOS`
içindeki MASTER PROMPTS / PROTOCOLS / CORE REFERENCE DOCUMENT belgeleri.

| Ne | Nerede |
|---|---|
| Kaynak kod | `kufuank/deep-cosmos-studio` (public) |
| Yayın | https://kufuank.github.io/deep-cosmos-studio/ |
| Veritabanı | Supabase projesi `deep-cosmos` (`fypbcazbdjtcrhkkfrtr`) |
| Sunucu | Supabase Edge Function `anthropic` |
| Tablolar | `dc_` önekli — öneksizler emekli faz 1/2 sistemine ait |

```bash
npm install
npm run dev      # geliştirme
npm run smoke    # 129 mantık testi
npm run deploy   # test → derleme → gh-pages
```

---

## Nerede kaldık

**Bitti ve kullanımda:** Gezegen → Ekosistem → Tür → Mekân zinciri (sırasıyla 59,
49, 48, 31 alan). Shot Library (tarayıcıda kesme ölçümü + 16 kolonluk çözümleme).
Sunucu tarafı, erişim denetimi, akışlı yanıtlar, şifre sıfırlama.

**Kuruldu, ilk gerçek denemeler yapıldı (Mete, 19 Ağustos):** Storyboard ajanı.
Üç revize aynı gün uygulandı: (1) ajan artık kullanıcının seçtiği tek listeyi
değil, Shot Library'deki **tüm hazır listeleri** görür (kompakt indeks, sabit/
önbellekli blokta); (2) sekansı `select_sequence(shot_list_id, first_shot,
last_shot, rationale)` aracıyla kendisi seçer, protokol "listenin başı
ayrıcalıklı değildir, tüm listeyi baştan sona tara" der, seçim karta
(`shot_list_id` + `sequence_start/end`) yazılır ve başlıkta görünür; `set_scenes`
seçili plan sayısıyla sahne sayısı uyuşmazsa uyarır; (3) "Storyboard Panosu —
final prompt" master şablondaki SCENE bloğunu birebir basar (Timestamp, Scene
Description, Camera Angle, Shot Type, Camera Movement, Visual Prompt, Audio,
Voice-over). Üstteki liste seçici artık isteğe bağlı bir kısıt ("— tüm
kütüphane —" varsayılan). DB'deki storyboard protokolü v2'ye yükseltildi (DB,
koddaki sabitleri ezer — protokol değişince **her ikisini** güncelleyin).
Ölçek notu: indeks plan başına ~30 token; ~1500 planın üstünde bir
ön-eleme/retrieval aşaması gerekir. **Sıradaki iş:** Mete'nin yeni sürümle
tekrar denemesi; sahne sayısı = seçili plan sayısı ve süreler korunuyor mu.

**Hiç yok:** Video Prompt ajanı (doküman 6), render hattı (Higgsfield/Seedance),
reference library retrieval, uygulama içi görsel üretimi. `dc_assets` ve
`dc_reference_items` tabloları duruyor ama bağlı değil.

---

## Tuzaklar — bunları yeniden keşfetmeyin

Aşağıdakilerin her biri en az bir tur hata ayıklamaya mal oldu.

**Supabase hataları `Error` değildir.** Düz nesne dönerler. `e instanceof Error`
kontrolü gerçek mesajları yutar; `src/lib/errors.ts` içindeki `describeError`
kullanın. Bu kontrol bir NOT NULL ihlalini bir tur boyunca gizledi.

**Çok satırlı `insert`'te kolon listesi nesnelerin birleşimidir.** Bir satırda
eksik olan anahtara varsayılan değil **NULL** yazılır. Toplu eklemede her satır
aynı anahtarları taşımalı.

**Kesme tespitinde ortalama+standart sapma kullanmayın.** Aranan kesmeler
istatistiği kendileri şişirir; sık kesilen görüntüde eşik kesmelerin üstüne çıkar
ve klip tek plana çöker. Medyan + MAD kullanılıyor, regresyon testi var.

**Kilitli kart yazılamaz.** Veritabanı tetikleyicisi reddeder. Ajana yazma
araçlarını vermeyin, yoksa yazdığını sanır, siz de sessiz bir döngüye düşersiniz.

**Protokolleri kısaltmayın.** Kaynak PROTOCOL belgelerini özetlerken OUTPUT
VALIDATION, REVISION AND APPROVAL, LOCKING ve LEARNING bölümleri düşmüştü; onay
döngüsü ve iyileştirme önerisi böyle kayboldu. `npm run smoke` artık her bölümün
varlığını kontrol ediyor.

**Giriş yapmak harcama izni değildir.** Site public, `verify_jwt` tek başına
yetmez — publishable anahtar derlenmiş pakette yayımlı ve ağ geçidi onu kabul
eder. Harcama `dc_allowed_users` tablosuna bağlı ve **kapalı düşer**: liste
okunamazsa istek reddedilir. Meşru kullanıcılar 403 almaya başlarsa önce şuna
bakın:

```bash
curl -s https://fypbcazbdjtcrhkkfrtr.supabase.co/functions/v1/anthropic \
  -H "apikey: <publishable>" -H "Authorization: Bearer <publishable>"
# {"ok":true,"key_configured":true,"allowlist_readable":true}
```

**Bir tur 14–88 saniye sürer** ve birden fazla istek yapar. Yanıtlar akıyor;
"takıldı" şikayeti gelirse önce `get_logs` → `edge-function` bakın. Uzun süreli
200'ler çalıştığı anlamına gelir.

**`max_tokens` düşünmeyi de kapsar — model istenmese de düşünür.** Claude
Sonnet 5 / Opus 5'te adaptive thinking, `thinking` parametresi gönderilmese
bile açıktır ve `max_tokens` düşünme + görünür çıktının **toplamına** uygulanan
sert tavandır. 14 Ağustos'ta "bütün alanları doldur" turları 8000'lik bütçenin
tamamını düşünmeye harcayıp `stop_reason: "max_tokens"` ile bitti; eski SSE
ayrıştırıcısı thinking bloklarını tanımadığı ve `stop_reason`'a hiç bakmadığı
için tur "boş" göründü, arayüz de suçu kart kilidine attı. Düzeltme: akümülatör
thinking/redacted_thinking bloklarını ve imzalarını saklıyor, `stop_reason:
"max_tokens"` yakalanıp kullanıcıya açıklanıyor, kesilen araç çağrısına "daha
küçük partiler hâlinde yeniden gönder" tool_result'u dönülüyor, istemci
varsayılanı 24000 / sunucu tavanı 32000'e çıktı ve `set_fields` açıklaması
çağrı başına ≤15 alan istiyor. `npm run smoke` bu senaryoyu regresyon testi
olarak içeriyor. Belirtinin log imzası: OPTIONS+POST çifti 200, mesaj kaydı
POST'tan ~2 dakika sonra ve `dc_messages`'a boş yer tutucu yazılmış.

**"Overloaded" hatası HTTP 200 içinde gelir.** Anthropic aşırı yükteyken
akışı 200 ile açıp birkaç saniye sonra içeriğe `error: overloaded_error`
olayı yazar; edge-function loglarında her şey 200 ve ~7 sn görünür, ama
`dc_usage`'a hiçbir şey yazılmaz — bu ikili imza sağlayıcı yükü demektir,
uygulama hatası değil. 18 Ağustos'tan beri istemci geçici hataları
(overloaded_error / api_error / 5xx / 529) 2 → 5 → 12 sn beklemeyle üç kez
kendiliğinden yeniden dener (durum satırında görünür); ekrana metin akmaya
başladıysa yeniden denemez, hatayı gösterir. Üç deneme de düşerse mesaj
"Anthropic sunucuları şu an aşırı yüklü…" olur; yapılacak tek şey birkaç
dakika beklemek. `npm run smoke` akış içi overload olayını test ediyor.

**Token maliyeti üç yerden gelir; hepsi ölçülüyor.** (1) Düşünme: model
istenmese de düşünür, çıktı fiyatından ücretlenir; `Ayarlar → Düşünme
derinliği` (varsayılan orta) tek büyük dial. Shot Library çözümlemesi sabit
"düşük". Sunucu yalnızca low/medium/high'ı geçirir. (2) Sistem promptu her
istekte yeniden gider — gezegen ~2,4k, storyboard ~7,7k token — ve bir tur 2–4
istek atar. Bu yüzden prompt sabit/değişken iki bloğa ayrıldı
(`buildSystemBlocks`): rol+bilgi+protokol+miras kısıtlar önbelleğe alınıyor,
yalnızca CURRENT SHEET STATE değişken kısımda; son mesajın üstüne de bir
breakpoint konuyor ki bir turun 2. ve sonraki istekleri geçmişi önbellekten
okusun. Sabit yarıyı düzenlerken kuralı bozmayın: **her turda değişen hiçbir
şey sabit bloğa girmemeli**, yoksa önbellek hiç tutmaz (`npm run smoke` bunu
denetliyor). (3) Görseller ucuz: 640px kare ≈ 300 token. Her tur/çözümleme
`dc_usage` tablosuna yazılır (giriş/çıktı/önbellek okuma/yazma); sohbetin
altında "Bu tur: N istek · X giriş, Y önbellekten · Z çıktı" satırı görünür.
"Önbellekten" sıfırsa breakpoint tutmuyor demektir — önce sabit bloğun turlar
arası bayt-aynı kalıp kalmadığına bakın.

**Saglayici degistirmek yalnizca bridge.ts'i ilgilendirir.** Edge Function bir
adaptordur: istemciye her zaman Anthropic bicimi konusur. NVIDIA NIM OpenAI
uyumlu oldugu icin istegi cikarken cevirir, akisini donerken Anthropic
olaylarina yeniden yazar. Model kimligi `claude-` ile basliyorsa Anthropic'e,
degilse NIM'e gider (`providerFor`). Iki bicim arasindaki asil yapisal fark arac
sonuclarindadir: Anthropic bir turun butun `tool_result`'larini tek user
mesajinda paketler, OpenAI ise cagri basina ayri bir `tool` mesaji ister.
Onbellek karsiligi yoktur - `cache_control` tasiyan sistem bloklari tek sistem
mesajina birlesir, yani NIM'de prompt cache tasarrufu yoktur (ama NIM ucretsiz).
Sinirlar: ~40 istek/dakika anahtar basina, ve NIM'de gorseli yalnizca `-vl-`
iceren model okur - Shot Library icin baska model secilirse kareler sessizce
yok sayilir. `NVIDIA_API_KEY` Supabase Edge Function secret'i olarak eklenmelidir;
saglik ucu `nvidia_key_configured` ile bunu bildirir.

**Yayın bazen GitHub tarafında düşer.** 6 Ağustos'ta üç gün runner alınamadı.
Kod tarafı değil; şununla yeniden tetiklenir:

```bash
gh api -X POST repos/kufuank/deep-cosmos-studio/pages/builds
```

---

## Kaynak dokümanlardaki kusurlar

Bunlar sessizdir — hiçbirinde TODO işareti yok, o yüzden farkında olmadan kanon
haline gelirler.

1. **Anlatım çelişkisi.** Storyboard şablonu her sahneye `Voice-over` istiyor,
   Video şablonunun AUDIO bölümü anlatımı yasaklıyor. Uygulama anlatımı üretip
   video promptundan hariç tutuyor (ayrı seslendirme katmanı varsayımı).
   **Onaylanmadı.**
2. **Species Core Reference Document** tek Türkçe belge; bozuk arketip isimleri ve
   yüksek basınçta suyun fazı hakkında ters bir iddia içeriyor. Birebir değil,
   düzeltilmiş özet olarak kullanılıyor.
3. **Storyboard ve Video ajanları için çekirdek referans belgesi yok** — diğer
   beşinde var. Video ajanına geçmeden yazılmalı.

---

## Yeni sezonda ilk üç adım

1. **Storyboard'ı gerçek veriyle çalıştırın.** Bir mekân kartının altından
   storyboard ekleyin, üstteki menüden bir shot list seçin, ajana ne göstermek
   istediğinizi söyleyin. Kontrol edilecek: sahne sayısı kaynak sekansla eşleşiyor
   mu, süreler korunuyor mu. Protokolün en sıkı şartı bu.
2. **Video Prompt ajanı** (doküman 6). Hattı uçtan uca tamamlayan son ajan.
3. **Render hattı.** Higgsfield/Seedance, iş kuyruğu, maliyet takibi. Sistem bu
   aşamadan sonra para harcamaya başlar, bu yüzden en sona bırakıldı.

---

## Panelden yapılması gerekenler

Bunlar MCP üzerinden değiştirilemez, Supabase panelinden yapılır.

- [ ] **Site URL** hâlâ `localhost:3000`. Kurtarma ve magic link mailleri bu
      yüzden açılmıyor →
      `Authentication → URL Configuration` → `https://kufuank.github.io/deep-cosmos-studio/`
- [ ] **Kayıt herkese açık.** Beyaz liste harcamayı durdurdu ama yabancılar hesap
      açabiliyor → `Authentication → Providers → Email` → *Allow new users to sign up* kapat
- [ ] **Sohbette paylaşılan anahtarlar** döndürülmeli (bir Supabase gizli anahtarı,
      bir Anthropic anahtarı).
- [ ] Erişim vermek için: `dc_allowed_users` tablosuna e-posta ekleyin. Kayıt
      açmaya gerek yok.
