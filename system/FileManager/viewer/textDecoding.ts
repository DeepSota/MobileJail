export type TextEncoding = 'UTF-8' | 'UTF-16 LE' | 'UTF-16 BE' | 'GB18030';

export interface DecodedText {
  text: string;
  encoding: TextEncoding;
  hadBom: boolean;
}

export class TextDecodingError extends Error {
  constructor() {
    super('The text file is not valid UTF-8, UTF-16, or GB18030.');
    this.name = 'TextDecodingError';
  }
}

function decode(
  bytes: Uint8Array,
  label: string,
  options: TextDecoderOptions = {},
): string {
  return new TextDecoder(label, options).decode(bytes);
}

function validateDecodedText(text: string): string {
  if (text.includes('\u0000')) throw new TextDecodingError();
  let disallowedControls = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0c && code !== 0x0d) {
      disallowedControls += 1;
    }
  }
  if (disallowedControls > Math.max(1, Math.floor(text.length * 0.01))) {
    throw new TextDecodingError();
  }
  return text;
}

/**
 * Decode the encodings commonly produced by Android and Windows text tools.
 * A BOM is authoritative. Without one, strict UTF-8 is preferred and GB18030
 * is used only as a fallback so ordinary UTF-8 never gets misclassified.
 */
export function decodeTextBytes(bytes: Uint8Array): DecodedText {
  if (bytes.length === 0) {
    return { text: '', encoding: 'UTF-8', hadBom: false };
  }

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      text: validateDecodedText(decode(bytes.subarray(3), 'utf-8', { fatal: true })),
      encoding: 'UTF-8',
      hadBom: true,
    };
  }

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: validateDecodedText(decode(bytes.subarray(2), 'utf-16le', { fatal: true })),
      encoding: 'UTF-16 LE',
      hadBom: true,
    };
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: validateDecodedText(decode(bytes.subarray(2), 'utf-16be', { fatal: true })),
      encoding: 'UTF-16 BE',
      hadBom: true,
    };
  }

  try {
    return {
      text: validateDecodedText(decode(bytes, 'utf-8', { fatal: true })),
      encoding: 'UTF-8',
      hadBom: false,
    };
  } catch {
    try {
      return {
        text: validateDecodedText(decode(bytes, 'gb18030', { fatal: true })),
        encoding: 'GB18030',
        hadBom: false,
      };
    } catch {
      throw new TextDecodingError();
    }
  }
}
