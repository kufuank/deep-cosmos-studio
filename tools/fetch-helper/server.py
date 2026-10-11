"""Deep Cosmos — yerel video getirme yardımcısı.

Shot Library tarayıcıda çalışır, ama YouTube/Instagram/TikTok sayfalarından video
indirmek (yt-dlp) tarayıcıda yapılamaz; sunucu tarafında da yapılamaz, çünkü bu siteler
veri merkezi IP'lerini engeller. Bu küçük sunucu kullanıcının kendi bilgisayarında
çalışır: linki indirir, sitenin kendi altyazısını çeker, videoyu tarayıcıya verir.
Kesme ölçümü ve çözümleme eskisi gibi tarayıcıda yapılır.

    python tools/fetch-helper/server.py        (ya da: npm run fetch-helper)

Yalnızca 127.0.0.1'e bağlanır. Tarayıcıdan gelen istekler yalnızca stüdyonun kendi
adreslerinden kabul edilir; başka bir sitenin bu yardımcıyı kullanmasına izin verilmez.

Ortam değişkenleri: DC_FETCH_PORT (varsayılan 8765), DC_FETCH_ORIGINS (virgülle ek
kaynaklar), FFMPEG_BIN (ffmpeg yolu).
"""
from __future__ import annotations

import json
import mimetypes
import os
import shutil
import sys
import sysconfig
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

PORT = int(os.environ.get("DC_FETCH_PORT", "8765"))
ALLOWED_ORIGINS = {
    "https://kufuank.github.io",
    "http://localhost:5178",
    "http://127.0.0.1:5178",
    *(o.strip() for o in os.environ.get("DC_FETCH_ORIGINS", "").split(",") if o.strip()),
}
WATCH_DIR = Path(__file__).resolve().parent / "watch"
WORK = Path(tempfile.gettempdir()) / "deep-cosmos-fetch"
JOB_TTL_SECONDS = 2 * 3600
MAX_BODY_BYTES = 64 * 1024

_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


# ── ortam: yt-dlp, deno, ffmpeg, sertifikalar ────────────────────────────────

def _prepend_path(directory: Path) -> None:
    path = os.environ.get("PATH", "")
    if directory.is_dir() and str(directory) not in path.split(os.pathsep):
        os.environ["PATH"] = str(directory) + os.pathsep + path


def resolve_ffmpeg() -> str | None:
    env = os.environ.get("FFMPEG_BIN")
    if env and Path(env).is_file():
        return env
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg  # noqa: PLC0415

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        return None


def _ca_bundle() -> str | None:
    """certifi + işletim sistemi kök sertifikaları → tek PEM (yalnızca Windows'ta).

    yt-dlp'nin tarayıcı-taklit istekleri (curl_cffi) yalnızca certifi'ye güvenir. Kurumsal
    proxy gibi TLS'i kesen ortamlarda kesen kök işletim sistemi deposundadır; ikisini
    birleştiririz. Doğrulama hiçbir koşulda kapatılmaz.
    """
    import ssl  # noqa: PLC0415

    if not hasattr(ssl, "enum_certificates"):
        return None
    try:
        import certifi  # noqa: PLC0415
    except ImportError:
        return None
    pems = [Path(certifi.where()).read_text(encoding="utf-8")]
    for store in ("ROOT", "CA"):
        for der, enc, _trust in ssl.enum_certificates(store):
            if enc == "x509_asn":
                pems.append(ssl.DER_cert_to_PEM_cert(der))
    out = WORK / "ca-bundle.pem"
    out.write_text("\n".join(pems), encoding="utf-8")
    return str(out)


def prepare_environment() -> dict[str, Any]:
    """yt-dlp'nin araçlarını bulabileceği ve TLS'i doğrulayabileceği ortamı kurar."""
    WORK.mkdir(parents=True, exist_ok=True)
    if str(WATCH_DIR) not in sys.path:
        sys.path.insert(0, str(WATCH_DIR))
    # pip'in yt-dlp.exe / deno.exe koyduğu yerler (venv, sistem, kullanıcı kurulumu)
    for scheme in (None, f"{os.name}_user"):
        try:
            scripts = sysconfig.get_path("scripts", scheme) if scheme else sysconfig.get_path("scripts")
        except KeyError:
            continue
        if scripts:
            _prepend_path(Path(scripts))

    ffmpeg = resolve_ffmpeg()
    lines = ["# deep-cosmos fetch-helper tarafından üretildi; elle düzenlemeyin.",
             "--compat-options no-certifi"]   # Python tarafı: işletim sistemi sertifika deposu
    if ffmpeg:
        if Path(ffmpeg).stem.lower() == "ffmpeg":
            _prepend_path(Path(ffmpeg).resolve().parent)
        else:  # imageio-ffmpeg'in adı farklıdır; PATH'ten bulunamaz
            lines.append(f'--ffmpeg-location "{Path(ffmpeg).resolve().as_posix()}"')
    config_home = WORK / "config"
    (config_home / "yt-dlp").mkdir(parents=True, exist_ok=True)
    (config_home / "yt-dlp" / "config").write_text("\n".join(lines) + "\n", encoding="utf-8")
    # Kullanıcının kendi XDG ayarı varsa ona dokunma; yt-dlp onun config'ini okur.
    os.environ.setdefault("XDG_CONFIG_HOME", str(config_home))
    if "CURL_CA_BUNDLE" not in os.environ:
        bundle = _ca_bundle()
        if bundle:
            os.environ["CURL_CA_BUNDLE"] = bundle
    return {"ffmpeg": ffmpeg, "yt_dlp": shutil.which("yt-dlp"), "deno": shutil.which("deno")}


# ── iş: indir + altyazı ──────────────────────────────────────────────────────

def fetch(url: str) -> dict[str, Any]:
    """URL → yerel video + altyazı segmentleri. Başarısızsa RuntimeError."""
    from download import download, fetch_captions, is_url  # noqa: PLC0415  (vendored)
    from transcribe import parse_vtt  # noqa: PLC0415

    if not is_url(url):
        raise ValueError("Geçerli bir http(s) bağlantısı değil.")
    job_id = uuid.uuid4().hex[:16]
    job_dir = WORK / "jobs" / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    ctx = fetch_captions(url, job_dir)
    transcript: list[dict[str, Any]] = []
    transcript_source = None
    errors = list(ctx.get("errors", []))
    if ctx.get("subtitle_path"):
        try:
            transcript = parse_vtt(ctx["subtitle_path"])
            track = ctx.get("caption_track") or {}
            transcript_source = (f"captions ({track.get('language', 'unknown')}, "
                                 f"{track.get('kind', 'unknown')})")
        except (OSError, ValueError) as exc:
            errors.append(f"Altyazı okunamadı: {exc}")
    try:
        media = download(url, job_dir, context=ctx if ctx.get("run_dir") else None)
    except SystemExit as exc:  # vendored kod hataları SystemExit ile bildirir
        shutil.rmtree(job_dir, ignore_errors=True)
        raise RuntimeError(f"Video indirilemedi: {exc}") from None

    video = Path(media["video_path"])
    info = media.get("info") or {}
    with _jobs_lock:
        _jobs[job_id] = {"path": video, "dir": job_dir, "created": time.time()}
    return {
        "id": job_id,
        "title": info.get("title") or video.name,
        "uploader": info.get("uploader"),
        "duration_seconds": info.get("duration"),
        "source_url": info.get("url") or url,
        "size_bytes": video.stat().st_size,
        "media": f"/media/{job_id}",
        "transcript": transcript,
        "transcript_source": transcript_source,
        "errors": errors,
    }


def cleanup_jobs() -> None:
    cutoff = time.time() - JOB_TTL_SECONDS
    with _jobs_lock:
        stale = [k for k, v in _jobs.items() if v["created"] < cutoff]
        for k in stale:
            shutil.rmtree(_jobs.pop(k)["dir"], ignore_errors=True)


# ── HTTP ─────────────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = "DeepCosmosFetch/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write(f"[fetch-helper] {self.address_string()} {fmt % args}\n")

    # Tarayıcı istekleri Origin taşır; listede değilse başka bir site demektir.
    # Origin'siz istekler (curl, yerel betik) zaten bu makinede çalışan süreçlerdir.
    def _origin_ok(self) -> bool:
        origin = self.headers.get("Origin")
        return origin is None or origin in ALLOWED_ORIGINS

    def _cors(self) -> None:
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            # Chrome: herkese açık bir siteden yerel ağa istek için açık izin.
            if self.headers.get("Access-Control-Request-Private-Network"):
                self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, status: int, body: dict[str, Any]) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not self._origin_ok():
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if not self._origin_ok():
            return self._json(403, {"error": "Bu kaynağa izin verilmiyor."})
        if self.path == "/health":
            return self._json(200, {"ok": True, **self.server.tools})  # type: ignore[attr-defined]
        if self.path.startswith("/media/"):
            return self._media(self.path.removeprefix("/media/"))
        self._json(404, {"error": "Bulunamadı."})

    def _media(self, job_id: str) -> None:
        with _jobs_lock:
            job = _jobs.get(job_id)
        if not job or not job["path"].is_file():
            return self._json(404, {"error": "Video bulunamadı ya da süresi doldu; yeniden getirin."})
        path: Path = job["path"]
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "video/mp4")
        self.send_header("Content-Length", str(path.stat().st_size))
        self.end_headers()
        with path.open("rb") as f:
            shutil.copyfileobj(f, self.wfile, 1 << 20)

    def do_POST(self) -> None:  # noqa: N802
        if not self._origin_ok():
            return self._json(403, {"error": "Bu kaynağa izin verilmiyor."})
        if self.path != "/fetch":
            return self._json(404, {"error": "Bulunamadı."})
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_BODY_BYTES:
            return self._json(400, {"error": "Geçersiz istek gövdesi."})
        try:
            url = str(json.loads(self.rfile.read(length)).get("url", "")).strip()
        except (ValueError, AttributeError):
            return self._json(400, {"error": "Geçersiz JSON."})
        cleanup_jobs()
        try:
            self._json(200, fetch(url))
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
        except RuntimeError as exc:
            self._json(502, {"error": str(exc)})


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass
    tools = prepare_environment()
    missing = [k for k in ("yt_dlp", "ffmpeg") if not tools[k]]
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.tools = {k: bool(v) for k, v in tools.items()}  # type: ignore[attr-defined]
    print(f"Deep Cosmos video yardımcısı: http://127.0.0.1:{PORT}  (durdurmak için Ctrl+C)")
    if missing:
        print(f"UYARI: eksik araç: {', '.join(missing)} — "
              f"pip install -r {Path(__file__).parent / 'requirements.txt'}")
    if not tools["deno"]:
        print("UYARI: deno yok; YouTube indirmeleri başarısız olabilir.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        shutil.rmtree(WORK / "jobs", ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
