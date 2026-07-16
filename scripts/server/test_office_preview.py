import asyncio
import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import httpx

from scripts.server import api_gateway
from scripts.server.office_preview import (
    MAX_SOURCE_BYTES,
    OfficePreviewService,
    PreviewError,
    PreviewResult,
    normalize_extension,
    validate_office_bytes,
)


def make_ooxml(marker: str) -> bytes:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "<Types />")
        archive.writestr(marker, "<document />")
    return stream.getvalue()


class OfficeValidationTests(unittest.TestCase):
    def test_extension_normalization_and_rejection(self):
        self.assertEqual(normalize_extension(".DOCX"), "docx")
        self.assertEqual(normalize_extension(" xLs "), "xls")
        for value, code in (
            (None, "MISSING_EXTENSION"),
            ("", "MISSING_EXTENSION"),
            ("pdf", "UNSUPPORTED_EXTENSION"),
            ("report.docx", "UNSUPPORTED_EXTENSION"),
            ("../docx", "UNSUPPORTED_EXTENSION"),
        ):
            with self.subTest(value=value), self.assertRaises(PreviewError) as raised:
                normalize_extension(value)
            self.assertEqual(raised.exception.code, code)

    def test_ooxml_family_marker_must_match_extension(self):
        docx = make_ooxml("word/document.xml")
        validate_office_bytes(docx, "docx")
        with self.assertRaises(PreviewError) as raised:
            validate_office_bytes(docx, "xlsx")
        self.assertEqual(raised.exception.code, "INVALID_FILE")

    def test_legacy_ole_family_marker_must_match_extension(self):
        ole_magic = bytes.fromhex("d0cf11e0a1b11ae1")
        doc = ole_magic + b"\0" * 512 + "WordDocument".encode("utf-16le")
        validate_office_bytes(doc, "doc")
        with self.assertRaises(PreviewError) as raised:
            validate_office_bytes(doc, "ppt")
        self.assertEqual(raised.exception.code, "INVALID_FILE")

    def test_empty_corrupt_and_oversized_files_are_rejected(self):
        for data, code in (
            (b"", "INVALID_FILE"),
            (b"not a zip", "INVALID_FILE"),
            (b"x" * (MAX_SOURCE_BYTES + 1), "FILE_TOO_LARGE"),
        ):
            with self.subTest(code=code), self.assertRaises(PreviewError) as raised:
                validate_office_bytes(data, "docx")
            self.assertEqual(raised.exception.code, code)

    def test_password_protected_ooxml_envelope_has_a_distinct_error(self):
        encrypted = (
            bytes.fromhex("d0cf11e0a1b11ae1")
            + b"\0" * 64
            + "EncryptionInfo".encode("utf-16le")
            + b"\0" * 32
            + "EncryptedPackage".encode("utf-16le")
        )
        with self.assertRaises(PreviewError) as raised:
            validate_office_bytes(encrypted, "docx")
        self.assertEqual(raised.exception.code, "PASSWORD_PROTECTED")
        self.assertEqual(raised.exception.status, 423)


class StubConversionService(OfficePreviewService):
    def __init__(self, cache_root: Path, *, output: bytes = b"%PDF-1.7\n%%EOF"):
        super().__init__(cache_root=cache_root, soffice_path="/bin/true")
        self._converter_version = "LibreOffice test"
        self.output = output
        self.conversion_count = 0

    async def _convert(self, data: bytes, extension: str) -> bytes:
        self.conversion_count += 1
        await asyncio.sleep(0.03)
        return self.output


class OfficePreviewServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_same_hash_is_joined_then_persistently_cached(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data = make_ooxml("word/document.xml")
            service = StubConversionService(root)
            first, second = await asyncio.gather(
                service.preview(data, "docx"),
                service.preview(data, "DOCX"),
            )
            self.assertEqual(service.conversion_count, 1)
            self.assertEqual({first.cache_status, second.cache_status}, {"MISS", "JOINED"})
            self.assertEqual(first.etag, second.etag)
            await service.shutdown()

            restarted = StubConversionService(root)
            cached = await restarted.preview(data, "docx")
            self.assertEqual(cached.cache_status, "HIT")
            self.assertEqual(restarted.conversion_count, 0)
            await restarted.shutdown()

    async def test_invalid_converter_output_is_not_cached(self):
        with tempfile.TemporaryDirectory() as temp:
            service = StubConversionService(Path(temp), output=b"not-pdf")
            with self.assertRaises(PreviewError) as raised:
                await service.preview(make_ooxml("word/document.xml"), "docx")
            self.assertEqual(raised.exception.code, "CONVERSION_FAILED")
            self.assertEqual(list(service.cache_dir.glob("*.pdf")), [])
            await service.shutdown()


class StubGatewayPreviewService:
    async def preview(self, data: bytes, extension: str) -> PreviewResult:
        return PreviewResult(
            pdf=b"%PDF-1.7\n%%EOF",
            etag="a" * 64,
            converter="LibreOffice test",
            cache_status="MISS",
        )

    async def shutdown(self) -> None:
        return None


class OfficePreviewRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.service_patch = mock.patch.object(
            api_gateway, "_office_preview", StubGatewayPreviewService()
        )
        self.service_patch.start()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=api_gateway.app),
            base_url="http://testserver",
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        self.service_patch.stop()

    async def test_method_and_extension_errors_use_stable_codes(self):
        method = await self.client.get("/api/preview/office")
        self.assertEqual(method.status_code, 405)
        self.assertEqual(method.json()["error"]["code"], "METHOD_NOT_ALLOWED")

        missing = await self.client.post("/api/preview/office", content=b"data")
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.json()["error"]["code"], "MISSING_EXTENSION")

        unsupported = await self.client.post(
            "/api/preview/office",
            headers={"X-File-Extension": "pdf"},
            content=b"data",
        )
        self.assertEqual(unsupported.status_code, 415)
        self.assertEqual(unsupported.json()["error"]["code"], "UNSUPPORTED_EXTENSION")

    async def test_success_contract_returns_inline_pdf(self):
        response = await self.client.post(
            "/api/preview/office",
            headers={"X-File-Extension": "docx"},
            content=b"raw office blob",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/pdf")
        self.assertEqual(response.headers["etag"], '"' + "a" * 64 + '"')
        self.assertEqual(response.headers["x-preview-converter"], "LibreOffice test")
        self.assertEqual(response.headers["x-preview-cache"], "MISS")
        self.assertTrue(response.content.startswith(b"%PDF-"))


if __name__ == "__main__":
    unittest.main()
