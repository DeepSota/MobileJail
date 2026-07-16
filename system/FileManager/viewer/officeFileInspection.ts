const OLE_MAGIC = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_LOCAL_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function utf16LeBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index * 2] = value.charCodeAt(index) & 0xff;
    bytes[index * 2 + 1] = value.charCodeAt(index) >>> 8;
  }
  return bytes;
}

function asciiBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  outer: for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

/** Detect the standard OLE envelope used by password-protected OOXML files. */
export function isPasswordProtectedOfficeFile(bytes: Uint8Array): boolean {
  if (startsWith(bytes, OLE_MAGIC)) {
    return contains(bytes, utf16LeBytes('EncryptionInfo'))
      && contains(bytes, utf16LeBytes('EncryptedPackage'));
  }

  // A ZIP-encrypted OOXML payload is not a valid Office package for preview,
  // but it is still more useful to report it as password protected than damaged.
  if (startsWith(bytes, ZIP_LOCAL_MAGIC) && bytes.length >= 8) {
    const generalPurposeFlags = bytes[6] | (bytes[7] << 8);
    return (generalPurposeFlags & 0x1) !== 0;
  }

  return false;
}

/**
 * Reject renamed CSV/text/other Office files before SheetJS' permissive parser
 * can interpret them as a workbook. ZIP entry names remain visible in the
 * central directory, so checking the OOXML workbook marker does not decompress
 * untrusted content.
 */
export function matchesSpreadsheetFileSignature(
  bytes: Uint8Array,
  extension: string,
): boolean {
  if (extension === 'xlsx') {
    return startsWith(bytes, ZIP_LOCAL_MAGIC)
      && contains(bytes, asciiBytes('[Content_Types].xml'))
      && contains(bytes, asciiBytes('xl/workbook.xml'));
  }
  if (extension === 'xls') {
    return startsWith(bytes, OLE_MAGIC)
      && contains(bytes, utf16LeBytes('Workbook'));
  }
  return false;
}
