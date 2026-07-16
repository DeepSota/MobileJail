import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';


export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_OOXML_ENTRIES = 10_000;
const MAX_OOXML_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_PDF_BYTES = 128 * 1024 * 1024;
const CONVERSION_TIMEOUT_MS = 45_000;
const HASH_LOCK_TIMEOUT_MS = CONVERSION_TIMEOUT_MS + 5_000;
const CONVERSION_SLOT_WAIT_MS = 5_000;
const GLOBAL_CONVERSION_LIMIT = 2;
const GLOBAL_QUEUE_LIMIT = 8;
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const CACHE_MAX_BYTES = 512 * 1024 * 1024;
const LEASE_STALE_MS = 120_000;
const CACHE_KEY_VERSION = 'office-preview-v1';

export const SUPPORTED_EXTENSIONS = new Set([
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);

const OOXML_MARKERS = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
};

const OLE_MARKERS = {
  doc: Buffer.from('WordDocument', 'utf16le'),
  xls: Buffer.from('Workbook', 'utf16le'),
  ppt: Buffer.from('PowerPoint Document', 'utf16le'),
};

const OLE_MAGIC = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

export const ERROR_DEFINITIONS = {
  METHOD_NOT_ALLOWED: [405, 'Only POST is supported.'],
  MISSING_EXTENSION: [400, 'X-File-Extension is required.'],
  UNSUPPORTED_EXTENSION: [415, 'This Office file type is not supported.'],
  FILE_TOO_LARGE: [413, 'The file exceeds the 25 MiB preview limit.'],
  PASSWORD_PROTECTED: [423, 'The document is password protected.'],
  INVALID_FILE: [422, 'The file content does not match its extension or is damaged.'],
  CONVERSION_FAILED: [422, 'The Office file could not be converted.'],
  PREVIEW_BUSY: [429, 'The Office preview service is busy.'],
  SERVICE_UNAVAILABLE: [503, 'The Office preview converter is unavailable.'],
  CONVERSION_TIMEOUT: [504, 'The Office preview conversion timed out.'],
  INTERNAL_ERROR: [500, 'The Office preview service failed unexpectedly.'],
};

export class OfficePreviewError extends Error {
  constructor(code) {
    const [status, message] = ERROR_DEFINITIONS[code];
    super(message);
    this.name = 'OfficePreviewError';
    this.code = code;
    this.status = status;
  }
}

export function normalizeExtension(value) {
  if (value == null || !value.trim()) throw new OfficePreviewError('MISSING_EXTENSION');
  const raw = value.trim();
  if (!/^\.?[A-Za-z0-9]{1,8}$/.test(raw)) {
    throw new OfficePreviewError('UNSUPPORTED_EXTENSION');
  }
  const extension = raw.toLowerCase().replace(/^\./, '');
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new OfficePreviewError('UNSUPPORTED_EXTENSION');
  }
  return extension;
}

export function validateOfficeBytes(data, extensionValue) {
  const extension = normalizeExtension(extensionValue);
  if (data.byteLength > MAX_SOURCE_BYTES) throw new OfficePreviewError('FILE_TOO_LARGE');
  if (data.byteLength === 0) throw new OfficePreviewError('INVALID_FILE');
  if (
    data.subarray(0, OLE_MAGIC.length).equals(OLE_MAGIC)
    && data.indexOf(Buffer.from('EncryptionInfo', 'utf16le')) !== -1
    && data.indexOf(Buffer.from('EncryptedPackage', 'utf16le')) !== -1
  ) {
    throw new OfficePreviewError('PASSWORD_PROTECTED');
  }

  const expectedOoxmlMarker = OOXML_MARKERS[extension];
  if (expectedOoxmlMarker) {
    validateOoxml(data, expectedOoxmlMarker);
    return;
  }

  if (!data.subarray(0, OLE_MAGIC.length).equals(OLE_MAGIC)) {
    throw new OfficePreviewError('INVALID_FILE');
  }
  if (data.indexOf(OLE_MARKERS[extension]) === -1) {
    throw new OfficePreviewError('INVALID_FILE');
  }
}

function validateOoxml(data, expectedMarker) {
  if (!data.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
    throw new OfficePreviewError('INVALID_FILE');
  }

  // Parse only the ZIP central directory.  No entry is decompressed here, so a
  // malformed archive or ZIP bomb cannot consume converter-side memory first.
  const minimumEocdOffset = Math.max(0, data.length - 22 - 65_535);
  let eocd = -1;
  for (let offset = data.length - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0 || eocd + 22 > data.length) throw new OfficePreviewError('INVALID_FILE');

  const disk = data.readUInt16LE(eocd + 4);
  const centralDisk = data.readUInt16LE(eocd + 6);
  const entriesOnDisk = data.readUInt16LE(eocd + 8);
  const entryCount = data.readUInt16LE(eocd + 10);
  const centralSize = data.readUInt32LE(eocd + 12);
  const centralOffset = data.readUInt32LE(eocd + 16);
  if (
    disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount ||
    entryCount === 0 || entryCount > MAX_OOXML_ENTRIES || entryCount === 0xffff ||
    centralSize === 0xffffffff || centralOffset === 0xffffffff ||
    centralOffset + centralSize > eocd
  ) {
    throw new OfficePreviewError('INVALID_FILE');
  }

  const names = new Set();
  let totalUncompressed = 0;
  let cursor = centralOffset;
  const centralEnd = centralOffset + centralSize;
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (cursor + 46 > centralEnd || data.readUInt32LE(cursor) !== 0x02014b50) {
      throw new OfficePreviewError('INVALID_FILE');
    }
    const flags = data.readUInt16LE(cursor + 8);
    const uncompressedSize = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    if ((flags & 0x1) !== 0) {
      throw new OfficePreviewError('PASSWORD_PROTECTED');
    }
    if (uncompressedSize === 0xffffffff) {
      throw new OfficePreviewError('INVALID_FILE');
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_OOXML_UNCOMPRESSED_BYTES) {
      throw new OfficePreviewError('INVALID_FILE');
    }
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    const next = nameEnd + extraLength + commentLength;
    if (nameEnd > centralEnd || next > centralEnd) {
      throw new OfficePreviewError('INVALID_FILE');
    }
    names.add(data.toString('utf8', nameStart, nameEnd).replace(/\\/g, '/'));
    cursor = next;
  }
  if (cursor > centralEnd || !names.has('[Content_Types].xml') || !names.has(expectedMarker)) {
    throw new OfficePreviewError('INVALID_FILE');
  }
}

function tryCreateLease(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = process.pid + ':' + Date.now() + ':' + crypto.randomUUID();
    let fd;
    try {
      fd = fs.openSync(filePath, 'wx', 0o600);
    } catch (error) {
      if (error?.code !== 'EEXIST') return null;
      try {
        if (Date.now() - fs.statSync(filePath).mtimeMs > LEASE_STALE_MS) {
          fs.unlinkSync(filePath);
          continue;
        }
      } catch {}
      return null;
    }

    try {
      fs.writeFileSync(fd, token, { encoding: 'utf8' });
      fs.fsyncSync(fd);
    } catch {
      try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(filePath); } catch {}
      return null;
    }

    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        try { fs.closeSync(fd); } catch {}
        try {
          if (fs.readFileSync(filePath, 'utf8') === token) fs.unlinkSync(filePath);
        } catch {}
      },
    };
  }
  return null;
}

const delay = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

async function acquireNamedLease(
  filePath,
  timeoutMs,
) {
  const deadline = Date.now() + timeoutMs;
  let waited = false;
  while (true) {
    const lease = tryCreateLease(filePath);
    if (lease) return { lease, waited };
    if (Date.now() >= deadline) return { lease: null, waited };
    waited = true;
    await delay(100);
  }
}

async function acquireSlotLease(
  lockDir,
  prefix,
  slots,
  timeoutMs,
) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    for (let slot = 0; slot < slots; slot += 1) {
      const lease = tryCreateLease(path.join(lockDir, prefix + '-' + slot + '.lock'));
      if (lease) return lease;
    }
    if (Date.now() >= deadline) return null;
    await delay(100);
  }
}

class ExecFailure extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

function executeFile(
  executable,
  args,
  options,
  timeoutMs,
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const child = execFile(
      executable,
      args,
      {
        ...options,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (error) {
          reject(new ExecFailure(error.code === 'ENOENT' ? 'missing' : 'exit'));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (child.pid != null && process.platform !== 'win32' && options.detached) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      } else {
        child.kill('SIGKILL');
      }
      reject(new ExecFailure('timeout'));
    }, timeoutMs);
  });
}

class ViteOfficePreviewService {
  constructor() {
    this.root = process.env.MOBILEJAIL_PREVIEW_CACHE_DIR
      ? path.resolve(process.env.MOBILEJAIL_PREVIEW_CACHE_DIR)
      : path.join(os.tmpdir(), 'mobilejail-office-preview');
    this.cacheDir = path.join(this.root, 'cache');
    this.lockDir = path.join(this.root, 'locks');
    this.tempDir = path.join(this.root, 'tmp');
    this.fontVersion = process.env.MOBILEJAIL_PREVIEW_FONT_VERSION || 'system-fonts-v1';
    this.converterPromise = undefined;
    this.inflight = new Map();
    for (const directory of [this.cacheDir, this.lockDir, this.tempDir]) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
  }

  async preview(data, extensionValue) {
    const extension = normalizeExtension(extensionValue);
    validateOfficeBytes(data, extension);
    const converter = await this.getConverter();
    const sourceHash = crypto.createHash('sha256').update(data).digest('hex');
    const keyMaterial = [
      CACHE_KEY_VERSION,
      sourceHash,
      extension,
      converter.version,
      this.fontVersion,
      '--convert-to',
      'pdf',
    ].join('\0');
    const key = crypto.createHash('sha256').update(keyMaterial, 'utf8').digest('hex');

    const cached = this.readCache(key);
    if (cached) return this.makeResult(cached, converter.version, 'HIT');

    const existing = this.inflight.get(key);
    if (existing) {
      const joined = await existing;
      return { ...joined, cacheStatus: 'JOINED' };
    }

    const pending = this.produce(data, extension, key, converter.version);
    this.inflight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.inflight.get(key) === pending) this.inflight.delete(key);
    }
  }

  makeResult(
    pdf,
    converter,
    cacheStatus,
  ) {
    return {
      pdf,
      etag: crypto.createHash('sha256').update(pdf).digest('hex'),
      converter,
      cacheStatus,
    };
  }

  async getConverter() {
    if (!this.converterPromise) {
      this.converterPromise = this.probeConverter().catch((error) => {
        this.converterPromise = undefined;
        throw error;
      });
    }
    return this.converterPromise;
  }

  async probeConverter() {
    const configured = process.env.MOBILEJAIL_SOFFICE_BIN;
    const candidates = configured ? [configured] : ['soffice', 'libreoffice'];
    for (const executable of candidates) {
      try {
        const { stdout } = await executeFile(executable, ['--version'], {}, 5_000);
        const version = stdout.trim().split(/\r?\n/)[0]?.trim().slice(0, 160);
        if (version) return { executable, version };
      } catch {}
    }
    throw new OfficePreviewError('SERVICE_UNAVAILABLE');
  }

  async produce(
    data,
    extension,
    key,
    converterVersion,
  ) {
    const queueLease = await acquireSlotLease(this.lockDir, 'queue', GLOBAL_QUEUE_LIMIT, 0);
    if (!queueLease) throw new OfficePreviewError('PREVIEW_BUSY');
    try {
      const hashLock = await acquireNamedLease(
        path.join(this.lockDir, 'hash-' + key + '.lock'),
        HASH_LOCK_TIMEOUT_MS,
      );
      if (!hashLock.lease) throw new OfficePreviewError('PREVIEW_BUSY');
      try {
        const cached = this.readCache(key);
        if (cached) {
          return this.makeResult(cached, converterVersion, hashLock.waited ? 'JOINED' : 'HIT');
        }

        const conversionLease = await acquireSlotLease(
          this.lockDir,
          'conversion',
          GLOBAL_CONVERSION_LIMIT,
          CONVERSION_SLOT_WAIT_MS,
        );
        if (!conversionLease) throw new OfficePreviewError('PREVIEW_BUSY');
        let pdf;
        try {
          pdf = await this.convert(data, extension);
        } finally {
          conversionLease.release();
        }
        this.writeCache(key, pdf);
        return this.makeResult(pdf, converterVersion, 'MISS');
      } finally {
        hashLock.lease.release();
      }
    } finally {
      queueLease.release();
    }
  }

  async convert(data, extension) {
    const converter = await this.getConverter();
    const jobDir = fs.mkdtempSync(path.join(this.tempDir, 'job-'));
    const sourceDir = path.join(jobDir, 'source');
    const outputDir = path.join(jobDir, 'output');
    const profileDir = path.join(jobDir, 'profile');
    const processTmp = path.join(jobDir, 'tmp');
    const xdgCache = path.join(jobDir, 'xdg-cache');
    const xdgConfig = path.join(jobDir, 'xdg-config');
    const xdgRuntime = path.join(jobDir, 'xdg-runtime');
    for (const directory of [
      sourceDir, outputDir, profileDir, processTmp, xdgCache, xdgConfig, xdgRuntime,
    ]) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    const source = path.join(sourceDir, 'document.' + extension);
    fs.writeFileSync(source, data, { mode: 0o600 });
    const args = [
      '--headless',
      '--invisible',
      '--nodefault',
      '--nolockcheck',
      '--nologo',
      '--nofirststartwizard',
      '-env:UserInstallation=' + pathToFileURL(profileDir).href,
      '--convert-to',
      'pdf',
      '--outdir',
      outputDir,
      source,
    ];
    const env = {
      ...process.env,
      HOME: profileDir,
      TMPDIR: processTmp,
      XDG_CACHE_HOME: xdgCache,
      XDG_CONFIG_HOME: xdgConfig,
      XDG_RUNTIME_DIR: xdgRuntime,
      SAL_USE_VCLPLUGIN: 'svp',
    };

    try {
      try {
        await executeFile(
          converter.executable,
          args,
          { cwd: jobDir, env, detached: process.platform !== 'win32' },
          CONVERSION_TIMEOUT_MS,
        );
      } catch (error) {
        if (error instanceof ExecFailure && error.kind === 'timeout') {
          throw new OfficePreviewError('CONVERSION_TIMEOUT');
        }
        if (error instanceof ExecFailure && error.kind === 'missing') {
          throw new OfficePreviewError('SERVICE_UNAVAILABLE');
        }
        throw new OfficePreviewError('CONVERSION_FAILED');
      }

      const outputs = fs.readdirSync(outputDir).filter((name) => name.toLowerCase().endsWith('.pdf'));
      if (outputs.length !== 1) throw new OfficePreviewError('CONVERSION_FAILED');
      const pdf = fs.readFileSync(path.join(outputDir, outputs[0]));
      if (!isValidPdf(pdf)) throw new OfficePreviewError('CONVERSION_FAILED');
      return pdf;
    } finally {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  }

  readCache(key) {
    const cacheFile = path.join(this.cacheDir, key + '.pdf');
    try {
      const stat = fs.statSync(cacheFile);
      if (Date.now() - stat.mtimeMs > CACHE_TTL_MS || stat.size <= 0 || stat.size > MAX_PDF_BYTES) {
        fs.unlinkSync(cacheFile);
        return null;
      }
      const pdf = fs.readFileSync(cacheFile);
      if (!isValidPdf(pdf)) {
        fs.unlinkSync(cacheFile);
        return null;
      }
      const now = new Date();
      fs.utimesSync(cacheFile, now, now);
      return pdf;
    } catch {
      return null;
    }
  }

  writeCache(key, pdf) {
    if (!isValidPdf(pdf)) throw new OfficePreviewError('CONVERSION_FAILED');
    const target = path.join(this.cacheDir, key + '.pdf');
    const temporary = path.join(this.cacheDir, '.' + key + '.' + crypto.randomUUID() + '.tmp');
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, pdf);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, target);
      fs.chmodSync(target, 0o600);
      this.pruneCache();
    } finally {
      if (fd != null) {
        try { fs.closeSync(fd); } catch {}
      }
      try { fs.unlinkSync(temporary); } catch {}
    }
  }

  pruneCache() {
    const files = [];
    let total = 0;
    const now = Date.now();
    let names;
    try { names = fs.readdirSync(this.cacheDir); } catch { return; }
    for (const name of names) {
      if (!name.endsWith('.pdf')) continue;
      const filePath = path.join(this.cacheDir, name);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > CACHE_TTL_MS) {
          fs.unlinkSync(filePath);
          continue;
        }
        total += stat.size;
        files.push({ path: filePath, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {}
    }
    files.sort((left, right) => left.mtimeMs - right.mtimeMs);
    for (const file of files) {
      if (total <= CACHE_MAX_BYTES) break;
      try {
        fs.unlinkSync(file.path);
        total -= file.size;
      } catch {}
    }
  }
}

function isValidPdf(data) {
  return data.length > 0 && data.length <= MAX_PDF_BYTES &&
    data.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const onData = (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_SOURCE_BYTES) {
        settled = true;
        request.removeListener('data', onData);
        request.removeListener('end', onEnd);
        request.removeListener('error', onError);
        request.resume();
        reject(new OfficePreviewError('FILE_TOO_LARGE'));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, size));
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      reject(new OfficePreviewError('INVALID_FILE'));
    };
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
  });
}

function requestHeader(request, name) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function sendError(response, error) {
  const body = JSON.stringify({ error: { code: error.code, message: error.message } });
  response.statusCode = error.status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(body);
}

export function officePreviewPlugin() {
  const service = new ViteOfficePreviewService();

  const handler = async (request, response) => {
    try {
      if (request.method !== 'POST') throw new OfficePreviewError('METHOD_NOT_ALLOWED');
      const extension = normalizeExtension(requestHeader(request, 'x-file-extension'));
      const contentLength = Number(requestHeader(request, 'content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_BYTES) {
        request.resume();
        throw new OfficePreviewError('FILE_TOO_LARGE');
      }
      const data = await readRawBody(request);
      const result = await service.preview(data, extension);
      if (response.destroyed) return;
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/pdf');
      response.setHeader('Content-Length', result.pdf.length);
      response.setHeader('Cache-Control', 'private, max-age=86400');
      response.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
      response.setHeader('ETag', '"' + result.etag + '"');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Preview-Cache', result.cacheStatus);
      response.setHeader('X-Preview-Converter', result.converter);
      response.end(result.pdf);
    } catch (error) {
      if (response.destroyed || response.headersSent) return;
      sendError(
        response,
        error instanceof OfficePreviewError
          ? error
          : new OfficePreviewError('INTERNAL_ERROR'),
      );
    }
  };

  const middleware = (
    request,
    response,
    next,
  ) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname.replace(/\/$/, '');
    if (!pathname.endsWith('/api/preview/office')) return next();
    void handler(request, response);
  };

  return {
    name: 'office-preview',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
