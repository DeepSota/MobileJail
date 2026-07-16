import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  ERROR_DEFINITIONS,
  OfficePreviewError,
  normalizeExtension,
  officePreviewPlugin,
  validateOfficeBytes,
} from '../scripts/server/office_preview_vite.mjs';


function makeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [name, value] of entries) {
    const fileName = Buffer.from(name, 'utf8');
    const data = Buffer.from(value, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    localParts.push(local, fileName, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, fileName);
    localOffset += local.length + fileName.length + data.length;
  }
  const localData = Buffer.concat(localParts);
  const centralData = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralData.length, 12);
  eocd.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralData, eocd]);
}


describe('Vite Office preview validation', () => {
  it('normalizes only the six supported extensions', () => {
    expect(normalizeExtension('.DOCX')).toBe('docx');
    expect(() => normalizeExtension('pdf')).toThrowError(OfficePreviewError);
    expect(() => normalizeExtension('../docx')).toThrowError(OfficePreviewError);
  });

  it('checks the OOXML family marker', () => {
    const docx = makeStoredZip([
      ['[Content_Types].xml', '<Types />'],
      ['word/document.xml', '<document />'],
    ]);
    expect(() => validateOfficeBytes(docx, 'docx')).not.toThrow();
    expect(() => validateOfficeBytes(docx, 'xlsx')).toThrowError(
      expect.objectContaining({ code: 'INVALID_FILE', status: 422 }),
    );
  });

  it('keeps status and stable code together', () => {
    expect(ERROR_DEFINITIONS.FILE_TOO_LARGE).toEqual([
      413,
      'The file exceeds the 25 MiB preview limit.',
    ]);
    expect(ERROR_DEFINITIONS.CONVERSION_TIMEOUT[0]).toBe(504);
    expect(ERROR_DEFINITIONS.PASSWORD_PROTECTED[0]).toBe(423);
  });

  it('reports an encrypted OLE Office envelope as password protected', () => {
    const encrypted = Buffer.concat([
      Buffer.from('d0cf11e0a1b11ae1', 'hex'),
      Buffer.from('EncryptionInfo', 'utf16le'),
      Buffer.from('EncryptedPackage', 'utf16le'),
    ]);
    expect(() => validateOfficeBytes(encrypted, 'docx')).toThrowError(
      expect.objectContaining({ code: 'PASSWORD_PROTECTED', status: 423 }),
    );
  });
});


describe('Vite Office preview middleware contract', () => {
  async function invoke(method, headers = {}, body = Buffer.alloc(0)) {
    let middleware;
    officePreviewPlugin().configureServer({
      middlewares: {
        use(handler) {
          middleware = handler;
        },
      },
    });
    const request = Readable.from(body.length ? [body] : []);
    request.method = method;
    request.url = '/api/preview/office';
    request.headers = headers;
    const responseHeaders = {};
    let responseBody = Buffer.alloc(0);
    let finish;
    const finished = new Promise((resolve) => { finish = resolve; });
    const response = {
      statusCode: 200,
      destroyed: false,
      headersSent: false,
      setHeader(name, value) {
        responseHeaders[name.toLowerCase()] = String(value);
      },
      end(value = '') {
        responseBody = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
        this.headersSent = true;
        finish();
      },
    };
    middleware(request, response, () => {
      response.statusCode = 404;
      response.end('not found');
    });
    await finished;
    return {
      status: response.statusCode,
      headers: responseHeaders,
      json: () => JSON.parse(responseBody.toString('utf8')),
    };
  }

  it('returns the same method, missing-header and unsupported codes', async () => {
    const method = await invoke('GET');
    expect(method.status).toBe(405);
    expect(method.json().error.code).toBe('METHOD_NOT_ALLOWED');

    const missing = await invoke('POST', {}, Buffer.from('data'));
    expect(missing.status).toBe(400);
    expect(missing.json().error.code).toBe('MISSING_EXTENSION');

    const unsupported = await invoke(
      'POST',
      { 'x-file-extension': 'pdf' },
      Buffer.from('data'),
    );
    expect(unsupported.status).toBe(415);
    expect(unsupported.json().error.code).toBe('UNSUPPORTED_EXTENSION');
  });
});
