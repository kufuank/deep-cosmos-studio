# Devam Notu

Bu dosya, projeye ara verip döndüğünüzde **ilk okunacak** yerdir. Amacı, bir
önceki oturumda pahalıya öğrenilen şeylerin yeniden keşfedilmesini önlemek.

Son güncelleme: 10 Ağustos 2026.

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

**Kuruldu, sınanmadı:** Storyboard ajanı. Gerçek bir shot list bağlanıp sekans
üretilmedi. **Sıradaki ilk iş bu** — kalan mimarinin doğruluğu buna bağlı.

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
