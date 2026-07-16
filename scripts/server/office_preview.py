#!/usr/bin/env python3
"""Safe, cached LibreOffice-backed previews for local Office documents.

The module is intentionally independent from Starlette so the converter and its
validation rules can be tested without starting the API gateway.  The Vite
development middleware in ``vite.config.ts`` mirrors the constants and wire
contract defined here.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import os
import re
import shutil
import signal
import tempfile
import time
import uuid
import zipfile
from dataclasses import dataclass, replace
from pathlib import Path


MAX_SOURCE_BYTES = 25 * 1024 * 1024
MAX_OOXML_ENTRIES = 10_000
MAX_OOXML_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
MAX_PDF_BYTES = 128 * 1024 * 1024
CONVERSION_TIMEOUT_SECONDS = 45.0
HASH_LOCK_TIMEOUT_SECONDS = CONVERSION_TIMEOUT_SECONDS + 5.0
CONVERSION_SLOT_WAIT_SECONDS = 5.0
GLOBAL_CONVERSION_LIMIT = 2
GLOBAL_QUEUE_LIMIT = 8
CACHE_TTL_SECONDS = 24 * 60 * 60
CACHE_MAX_BYTES = 512 * 1024 * 1024
LEASE_STALE_SECONDS = 120.0

SUPPORTED_EXTENSIONS = frozenset({"doc", "docx", "xls", "xlsx", "ppt", "pptx"})
OOXML_MARKERS = {
    "docx": "word/document.xml",
    "xlsx": "xl/workbook.xml",
    "pptx": "ppt/presentation.xml",
}
OLE_MARKERS = {
    "doc": "WordDocument".encode("utf-16le"),
    "xls": "Workbook".encode("utf-16le"),
    "ppt": "PowerPoint Document".encode("utf-16le"),
}
OLE_MAGIC = bytes.fromhex("d0cf11e0a1b11ae1")
ZIP_MAGIC = b"PK\x03\x04"
PDF_MAGIC = b"%PDF-"
OLE_ENCRYPTION_MARKERS = (
    "EncryptionInfo".encode("utf-16le"),
    "EncryptedPackage".encode("utf-16le"),
)

ERROR_DEFINITIONS: dict[str, tuple[int, str]] = {
    "METHOD_NOT_ALLOWED": (405, "Only POST is supported."),
    "MISSING_EXTENSION": (400, "X-File-Extension is required."),
    "UNSUPPORTED_EXTENSION": (415, "This Office file type is not supported."),
    "FILE_TOO_LARGE": (413, "The file exceeds the 25 MiB preview limit."),
    "PASSWORD_PROTECTED": (423, "The document is password protected."),
    "INVALID_FILE": (422, "The file content does not match its extension or is damaged."),
    "CONVERSION_FAILED": (422, "The Office file could not be converted."),
    "PREVIEW_BUSY": (429, "The Office preview service is busy."),
    "SERVICE_UNAVAILABLE": (503, "The Office preview converter is unavailable."),
    "CONVERSION_TIMEOUT": (504, "The Office preview conversion timed out."),
    "INTERNAL_ERROR": (500, "The Office preview service failed unexpectedly."),
}

_EXTENSION_PATTERN = re.compile(r"^\.?[A-Za-z0-9]{1,8}$")
_CACHE_KEY_VERSION = "office-preview-v1"
_EXPORT_ARGS_KEY = "--convert-to\0pdf"


class PreviewError(Exception):
    """An expected HTTP-facing preview failure."""

    def __init__(self, code: str):
        status, message = ERROR_DEFINITIONS[code]
        super().__init__(message)
        self.code = code
        self.status = status
        self.message = message

    def payload(self) -> dict[str, dict[str, str]]:
        return {"error": {"code": self.code, "message": self.message}}


@dataclass(frozen=True)
class PreviewResult:
    pdf: bytes
    etag: str
    converter: str
    cache_status: str


@dataclass
class _FileLease:
    path: Path
    token: str
    fd: int

    def release(self) -> None:
        try:
            os.close(self.fd)
        except OSError:
            pass
        try:
            if self.path.read_text(encoding="utf-8") == self.token:
                self.path.unlink(missing_ok=True)
        except OSError:
            pass


def normalize_extension(value: str | None) -> str:
    if value is None or not value.strip():
        raise PreviewError("MISSING_EXTENSION")
    raw = value.strip()
    if not _EXTENSION_PATTERN.fullmatch(raw):
        raise PreviewError("UNSUPPORTED_EXTENSION")
    extension = raw.lower()
    if extension.startswith("."):
        extension = extension[1:]
    if extension not in SUPPORTED_EXTENSIONS:
        raise PreviewError("UNSUPPORTED_EXTENSION")
    return extension


def validate_office_bytes(data: bytes, extension: str) -> None:
    """Reject empty, oversized, mislabeled, encrypted, and malformed inputs."""

    extension = normalize_extension(extension)
    if len(data) > MAX_SOURCE_BYTES:
        raise PreviewError("FILE_TOO_LARGE")
    if not data:
        raise PreviewError("INVALID_FILE")
    if _is_password_protected(data):
        raise PreviewError("PASSWORD_PROTECTED")

    if extension in OOXML_MARKERS:
        _validate_ooxml(data, OOXML_MARKERS[extension])
        return

    marker = OLE_MARKERS[extension]
    if not data.startswith(OLE_MAGIC) or marker not in data:
        raise PreviewError("INVALID_FILE")


def _is_password_protected(data: bytes) -> bool:
    """Recognize the standard OLE envelope and ZIP encryption flag."""

    if data.startswith(OLE_MAGIC):
        return all(marker in data for marker in OLE_ENCRYPTION_MARKERS)
    if data.startswith(ZIP_MAGIC) and len(data) >= 8:
        general_purpose_flags = int.from_bytes(data[6:8], "little")
        return bool(general_purpose_flags & 0x1)
    return False


def _validate_ooxml(data: bytes, expected_marker: str) -> None:
    if not data.startswith(ZIP_MAGIC):
        raise PreviewError("INVALID_FILE")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            if not infos or len(infos) > MAX_OOXML_ENTRIES:
                raise PreviewError("INVALID_FILE")
            total_uncompressed = 0
            names: set[str] = set()
            for info in infos:
                if info.flag_bits & 0x1:  # traditional/strong ZIP encryption
                    raise PreviewError("PASSWORD_PROTECTED")
                total_uncompressed += info.file_size
                if total_uncompressed > MAX_OOXML_UNCOMPRESSED_BYTES:
                    raise PreviewError("INVALID_FILE")
                names.add(info.filename.replace("\\", "/"))
    except PreviewError:
        raise
    except (OSError, RuntimeError, ValueError, zipfile.BadZipFile, zipfile.LargeZipFile):
        raise PreviewError("INVALID_FILE") from None

    if "[Content_Types].xml" not in names or expected_marker not in names:
        raise PreviewError("INVALID_FILE")


def _default_cache_root() -> Path:
    configured = os.environ.get("MOBILEJAIL_PREVIEW_CACHE_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(tempfile.gettempdir()) / "mobilejail-office-preview"


def _try_create_lease(path: Path) -> _FileLease | None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd: int | None = None
    token = ""
    for _ in range(2):
        token = f"{os.getpid()}:{time.time_ns()}:{uuid.uuid4().hex}"
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            break
        except FileExistsError:
            try:
                if time.time() - path.stat().st_mtime > LEASE_STALE_SECONDS:
                    path.unlink(missing_ok=True)
                    continue
            except OSError:
                pass
            return None
        except OSError:
            return None
    if fd is None:
        return None

    try:
        os.write(fd, token.encode("utf-8"))
        os.fsync(fd)
    except OSError:
        try:
            os.close(fd)
        finally:
            path.unlink(missing_ok=True)
        return None
    return _FileLease(path=path, token=token, fd=fd)


async def _acquire_named_lease(path: Path, timeout: float) -> tuple[_FileLease | None, bool]:
    deadline = time.monotonic() + timeout
    waited = False
    while True:
        lease = _try_create_lease(path)
        if lease is not None:
            return lease, waited
        if time.monotonic() >= deadline:
            return None, waited
        waited = True
        await asyncio.sleep(0.1)


async def _acquire_slot_lease(
    lock_dir: Path,
    prefix: str,
    slots: int,
    timeout: float,
) -> _FileLease | None:
    deadline = time.monotonic() + timeout
    while True:
        for slot in range(slots):
            lease = _try_create_lease(lock_dir / f"{prefix}-{slot}.lock")
            if lease is not None:
                return lease
        if time.monotonic() >= deadline:
            return None
        await asyncio.sleep(0.1)


def _resolve_soffice(configured: str | None = None) -> str | None:
    if configured:
        return shutil.which(configured)
    env_path = os.environ.get("MOBILEJAIL_SOFFICE_BIN")
    if env_path:
        return shutil.which(env_path)
    return shutil.which("soffice") or shutil.which("libreoffice")


def _cache_key(
    source_sha256: str,
    extension: str,
    converter_version: str,
    font_version: str,
) -> str:
    material = "\0".join(
        (
            _CACHE_KEY_VERSION,
            source_sha256,
            extension,
            converter_version,
            font_version,
            _EXPORT_ARGS_KEY,
        )
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _valid_pdf(data: bytes) -> bool:
    return 0 < len(data) <= MAX_PDF_BYTES and data.startswith(PDF_MAGIC)


class OfficePreviewService:
    def __init__(
        self,
        *,
        cache_root: Path | str | None = None,
        soffice_path: str | None = None,
        conversion_timeout: float = CONVERSION_TIMEOUT_SECONDS,
    ) -> None:
        self.cache_root = Path(cache_root) if cache_root else _default_cache_root()
        self.cache_dir = self.cache_root / "cache"
        self.lock_dir = self.cache_root / "locks"
        self.temp_dir = self.cache_root / "tmp"
        for directory in (self.cache_dir, self.lock_dir, self.temp_dir):
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.soffice_path = _resolve_soffice(soffice_path)
        self.conversion_timeout = conversion_timeout
        self.font_version = os.environ.get(
            "MOBILEJAIL_PREVIEW_FONT_VERSION", "system-fonts-v1"
        )
        self._converter_version: str | None = None
        self._version_lock = asyncio.Lock()
        self._inflight_lock = asyncio.Lock()
        self._inflight: dict[str, asyncio.Task[PreviewResult]] = {}

    async def preview(self, data: bytes, extension: str) -> PreviewResult:
        extension = normalize_extension(extension)
        validate_office_bytes(data, extension)
        converter_version = await self._get_converter_version()
        source_hash = hashlib.sha256(data).hexdigest()
        key = _cache_key(
            source_hash,
            extension,
            converter_version,
            self.font_version,
        )

        cached = self._read_cache(key)
        if cached is not None:
            return PreviewResult(
                pdf=cached,
                etag=hashlib.sha256(cached).hexdigest(),
                converter=converter_version,
                cache_status="HIT",
            )

        async with self._inflight_lock:
            task = self._inflight.get(key)
            joined = task is not None
            if task is None:
                task = asyncio.create_task(
                    self._produce(data, extension, key, converter_version)
                )
                self._inflight[key] = task
                task.add_done_callback(
                    lambda done, cache_key=key: asyncio.create_task(
                        self._forget_inflight(cache_key, done)
                    )
                )

        result = await asyncio.shield(task)
        return replace(result, cache_status="JOINED") if joined else result

    async def _forget_inflight(
        self, key: str, task: asyncio.Task[PreviewResult]
    ) -> None:
        # Retrieve the exception to avoid a warning if every waiting client left.
        if not task.cancelled():
            try:
                task.exception()
            except Exception:
                pass
        async with self._inflight_lock:
            if self._inflight.get(key) is task:
                self._inflight.pop(key, None)

    async def _get_converter_version(self) -> str:
        if self._converter_version is not None:
            return self._converter_version
        if not self.soffice_path:
            raise PreviewError("SERVICE_UNAVAILABLE")
        async with self._version_lock:
            if self._converter_version is not None:
                return self._converter_version
            try:
                process = await asyncio.create_subprocess_exec(
                    self.soffice_path,
                    "--version",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    start_new_session=True,
                )
                stdout, _ = await asyncio.wait_for(process.communicate(), timeout=5.0)
            except (OSError, asyncio.TimeoutError):
                raise PreviewError("SERVICE_UNAVAILABLE") from None
            if process.returncode != 0:
                raise PreviewError("SERVICE_UNAVAILABLE")
            version = stdout.decode("utf-8", errors="replace").strip().splitlines()
            if not version or not version[0].strip():
                raise PreviewError("SERVICE_UNAVAILABLE")
            self._converter_version = version[0].strip()[:160]
            return self._converter_version

    async def _produce(
        self,
        data: bytes,
        extension: str,
        key: str,
        converter_version: str,
    ) -> PreviewResult:
        queue_lease = await _acquire_slot_lease(
            self.lock_dir, "queue", GLOBAL_QUEUE_LIMIT, 0.0
        )
        if queue_lease is None:
            raise PreviewError("PREVIEW_BUSY")
        try:
            hash_lease, waited = await _acquire_named_lease(
                self.lock_dir / f"hash-{key}.lock", HASH_LOCK_TIMEOUT_SECONDS
            )
            if hash_lease is None:
                raise PreviewError("PREVIEW_BUSY")
            try:
                cached = self._read_cache(key)
                if cached is not None:
                    return PreviewResult(
                        pdf=cached,
                        etag=hashlib.sha256(cached).hexdigest(),
                        converter=converter_version,
                        cache_status="JOINED" if waited else "HIT",
                    )

                conversion_lease = await _acquire_slot_lease(
                    self.lock_dir,
                    "conversion",
                    GLOBAL_CONVERSION_LIMIT,
                    CONVERSION_SLOT_WAIT_SECONDS,
                )
                if conversion_lease is None:
                    raise PreviewError("PREVIEW_BUSY")
                try:
                    pdf = await self._convert(data, extension)
                finally:
                    conversion_lease.release()

                self._write_cache(key, pdf)
                return PreviewResult(
                    pdf=pdf,
                    etag=hashlib.sha256(pdf).hexdigest(),
                    converter=converter_version,
                    cache_status="MISS",
                )
            finally:
                hash_lease.release()
        finally:
            queue_lease.release()

    async def _convert(self, data: bytes, extension: str) -> bytes:
        if not self.soffice_path:
            raise PreviewError("SERVICE_UNAVAILABLE")
        job_dir = Path(tempfile.mkdtemp(prefix="job-", dir=self.temp_dir))
        source_dir = job_dir / "source"
        output_dir = job_dir / "output"
        profile_dir = job_dir / "profile"
        process_tmp = job_dir / "tmp"
        xdg_cache = job_dir / "xdg-cache"
        xdg_config = job_dir / "xdg-config"
        xdg_runtime = job_dir / "xdg-runtime"
        for directory in (
            source_dir,
            output_dir,
            profile_dir,
            process_tmp,
            xdg_cache,
            xdg_config,
            xdg_runtime,
        ):
            directory.mkdir(mode=0o700)
        source = source_dir / f"document.{extension}"
        source.write_bytes(data)

        args = [
            "--headless",
            "--invisible",
            "--nodefault",
            "--nolockcheck",
            "--nologo",
            "--nofirststartwizard",
            f"-env:UserInstallation={profile_dir.resolve().as_uri()}",
            "--convert-to",
            "pdf",
            "--outdir",
            str(output_dir),
            str(source),
        ]
        env = os.environ.copy()
        env.update(
            {
                "HOME": str(profile_dir),
                "TMPDIR": str(process_tmp),
                "XDG_CACHE_HOME": str(xdg_cache),
                "XDG_CONFIG_HOME": str(xdg_config),
                "XDG_RUNTIME_DIR": str(xdg_runtime),
                "SAL_USE_VCLPLUGIN": "svp",
            }
        )

        process: asyncio.subprocess.Process | None = None
        try:
            try:
                process = await asyncio.create_subprocess_exec(
                    self.soffice_path,
                    *args,
                    cwd=job_dir,
                    env=env,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    start_new_session=True,
                )
            except OSError:
                raise PreviewError("SERVICE_UNAVAILABLE") from None

            try:
                await asyncio.wait_for(
                    process.communicate(), timeout=self.conversion_timeout
                )
            except asyncio.TimeoutError:
                await self._terminate_process_group(process)
                raise PreviewError("CONVERSION_TIMEOUT") from None
            except asyncio.CancelledError:
                await self._terminate_process_group(process)
                raise

            if process.returncode != 0:
                raise PreviewError("CONVERSION_FAILED")

            outputs = list(output_dir.glob("*.pdf"))
            if len(outputs) != 1:
                raise PreviewError("CONVERSION_FAILED")
            pdf = outputs[0].read_bytes()
            if not _valid_pdf(pdf):
                raise PreviewError("CONVERSION_FAILED")
            return pdf
        finally:
            shutil.rmtree(job_dir, ignore_errors=True)

    @staticmethod
    async def _terminate_process_group(process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            await asyncio.wait_for(process.wait(), timeout=2.0)
            return
        except asyncio.TimeoutError:
            pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        try:
            await process.wait()
        except ProcessLookupError:
            pass

    def _read_cache(self, key: str) -> bytes | None:
        cache_file = self.cache_dir / f"{key}.pdf"
        try:
            stat = cache_file.stat()
            if time.time() - stat.st_mtime > CACHE_TTL_SECONDS:
                cache_file.unlink(missing_ok=True)
                return None
            if stat.st_size <= 0 or stat.st_size > MAX_PDF_BYTES:
                cache_file.unlink(missing_ok=True)
                return None
            data = cache_file.read_bytes()
            if not _valid_pdf(data):
                cache_file.unlink(missing_ok=True)
                return None
            now = time.time()
            os.utime(cache_file, (now, now))
            return data
        except OSError:
            return None

    def _write_cache(self, key: str, pdf: bytes) -> None:
        if not _valid_pdf(pdf):
            raise PreviewError("CONVERSION_FAILED")
        target = self.cache_dir / f"{key}.pdf"
        temp = self.cache_dir / f".{key}.{uuid.uuid4().hex}.tmp"
        try:
            with temp.open("xb") as handle:
                handle.write(pdf)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, target)
            os.chmod(target, 0o600)
            self._prune_cache()
        finally:
            temp.unlink(missing_ok=True)

    def _prune_cache(self) -> None:
        now = time.time()
        files: list[tuple[float, int, Path]] = []
        total = 0
        try:
            candidates = list(self.cache_dir.glob("*.pdf"))
        except OSError:
            return
        for cache_file in candidates:
            try:
                stat = cache_file.stat()
                if now - stat.st_mtime > CACHE_TTL_SECONDS:
                    cache_file.unlink(missing_ok=True)
                    continue
                total += stat.st_size
                files.append((stat.st_mtime, stat.st_size, cache_file))
            except OSError:
                continue
        for _, size, cache_file in sorted(files):
            if total <= CACHE_MAX_BYTES:
                break
            try:
                cache_file.unlink()
                total -= size
            except OSError:
                continue

    async def shutdown(self) -> None:
        async with self._inflight_lock:
            tasks = list(self._inflight.values())
            self._inflight.clear()
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


__all__ = [
    "ERROR_DEFINITIONS",
    "MAX_SOURCE_BYTES",
    "OfficePreviewService",
    "PreviewError",
    "PreviewResult",
    "SUPPORTED_EXTENSIONS",
    "normalize_extension",
    "validate_office_bytes",
]
