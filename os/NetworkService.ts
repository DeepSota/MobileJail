/**
 * System Network Service
 *
 * Goal:
 * - Give every app a single, stable way to do network requests
 * - In browser runtime, transparently avoid CORS by routing cross-origin HTTP(S) requests
 *   through the system gateway endpoint: POST /api/gw/fetch
 *
 * How it works:
 * - Local static resources and offline-capable system APIs use native fetch directly
 * - Cross-origin HTTP(S) requests are automatically proxied through /api/gw/fetch
 * - Requests that need a network transport fail before fetch when Wi-Fi and mobile data are unavailable
 *
 * Notes:
 * - This is a "system service" abstraction. Real mobile OS has no CORS; this is our Web equivalent.
 * - For binary payloads (images/video), prefer using <img>/<video> direct src when possible.
 */

import { immediateSetItem } from './debouncedPersist';
import { useOsStateStore } from './OsStateStore';
import { realNow } from './TimeService';

export type NetFetchOptions = RequestInit & {
  /**
   * Force routing through gateway even for same-origin URLs.
   */
  forceGateway?: boolean;
};

type GatewayFetchPayload = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

/** Stable error surfaced when the simulated device has no usable transport. */
export class NetworkUnavailableError extends Error {
  readonly code = 'NETWORK_UNAVAILABLE';
  readonly requestUrl: string;

  constructor(requestUrl: string) {
    super('Network unavailable: no active Wi-Fi or mobile data connection');
    this.name = 'NetworkUnavailableError';
    this.requestUrl = requestUrl;
  }
}

function isAbsoluteHttpUrl(url: string) {
  return /^https?:\/\//i.test(url);
}

function getRuntimeOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  const origin = window.location?.origin;
  return origin && origin !== 'null' ? origin : null;
}

function resolveHttpUrl(url: string): URL | null {
  try {
    const origin = getRuntimeOrigin();
    return new URL(url, origin ? `${origin}/` : 'http://localhost/');
  } catch {
    return null;
  }
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isOfflineCapableLocalApi(pathname: string): boolean {
  return (
    pathname === '/api/preview/office' ||
    pathname.startsWith('/api/preview/office/') ||
    pathname === '/api/sdcard' ||
    pathname.startsWith('/api/sdcard/')
  );
}

function requestNeedsNetwork(url: string, forceGateway: boolean): boolean {
  if (forceGateway) return true;
  const resolved = resolveHttpUrl(url);
  if (!resolved || (resolved.protocol !== 'http:' && resolved.protocol !== 'https:')) return false;

  const origin = getRuntimeOrigin();
  if (origin && resolved.origin !== origin) return true;
  if (!origin && isAbsoluteHttpUrl(url) && resolved.origin !== 'http://localhost') return true;
  return isApiPath(resolved.pathname) && !isOfflineCapableLocalApi(resolved.pathname);
}

function hasUsableNetworkTransport(): boolean {
  const state = useOsStateStore.getState();
  const wifiConnected =
    state.settings.global.wifiEnabled &&
    Boolean(state.hardware.wifi.connectedSsid) &&
    state.hardware.wifi.level > 0;
  const cellularConnected =
    !state.settings.global.airplaneModeEnabled &&
    state.settings.global.mobileDataEnabled &&
    !state.hardware.cellular.noSim &&
    state.hardware.cellular.signalLevel > 0 &&
    state.hardware.cellular.mobileDataType !== 'none';
  return wifiConnected || cellularConnected;
}

function assertNetworkAvailable(url: string, forceGateway: boolean): void {
  if (!requestNeedsNetwork(url, forceGateway)) return;
  if (!hasUsableNetworkTransport()) throw new NetworkUnavailableError(url);
}

function normalizeInput(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  // Request object
  if ((input as any)?.url) return (input as any).url as string;
  return input.toString();
}

function toHeadersObject(headers?: HeadersInit): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    const obj: Record<string, string> = {};
    headers.forEach((v, k) => (obj[k] = v));
    return obj;
  }
  if (Array.isArray(headers)) {
    const obj: Record<string, string> = {};
    for (const [k, v] of headers) obj[k] = v;
    return obj;
  }
  return headers as Record<string, string>;
}

function getGatewaySessionId() {
  const key = 'mobile-gym:gw:session';
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const id = crypto?.randomUUID ? crypto.randomUUID() : String(realNow()) + Math.random().toString(16).slice(2);
    immediateSetItem(key, id);
    return id;
  } catch {
    return 'anon';
  }
}

async function gatewayFetch(url: string, init: NetFetchOptions = {}) {
  const payload: GatewayFetchPayload = {
    url,
    method: init.method || 'GET',
    headers: toHeadersObject(init.headers),
  };

  // Body: support string payloads (JSON/text). For FormData/Blob/ArrayBuffer, caller should stringify or avoid.
  const bodyAny = init.body as any;
  if (typeof bodyAny === 'string') payload.body = bodyAny;

  const resp = await fetch('/api/gw/fetch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-gw-session': getGatewaySessionId(),
    },
    body: JSON.stringify(payload),
    signal: init.signal,
  });

  // The gateway returns upstream status + body. We keep it as-is.
  return resp;
}

async function gatewayProxy(url: string, init: NetFetchOptions = {}) {
  // For non-string bodies (FormData/Blob/ArrayBuffer/ReadableStream), we tunnel the request body
  // through same-origin endpoint to avoid CORS while keeping streaming.
  const u = new URL('/api/gw/proxy', window.location.origin);
  u.searchParams.set('url', url);
  return fetch(u.toString(), {
    ...init,
    headers: {
      ...(toHeadersObject(init.headers) || {}),
      'x-gw-session': getGatewaySessionId(),
    },
  });
}

/**
 * Unified fetch for apps.
 */
export async function netFetch(input: RequestInfo | URL, init: NetFetchOptions = {}) {
  const url = normalizeInput(input);
  assertNetworkAvailable(url, Boolean(init.forceGateway));

  // If already routed to gateway explicitly, don't wrap again.
  if (url.startsWith('/api/gw/')) {
    return fetch(url, init);
  }

  const resolved = resolveHttpUrl(url);
  const origin = getRuntimeOrigin();
  const isCrossOriginHttp =
    Boolean(resolved && (resolved.protocol === 'http:' || resolved.protocol === 'https:')) &&
    (origin ? resolved!.origin !== origin : isAbsoluteHttpUrl(url));

  if (init.forceGateway || isCrossOriginHttp) {
    const bodyAny = init.body as any;
    // Use proxy tunnel for non-string bodies to preserve streaming compatibility.
    if (bodyAny != null && typeof bodyAny !== 'string') {
      return gatewayProxy(url, init);
    }
    return gatewayFetch(url, init);
  }

  return fetch(input as any, init);
}

export async function netJson<T = any>(input: RequestInfo | URL, init: NetFetchOptions = {}): Promise<T> {
  const resp = await netFetch(input, init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Network error: ${resp.status} ${resp.statusText}${text ? ` - ${text.slice(0, 200)}` : ''}`);
  }
  return (await resp.json()) as T;
}

export async function netText(input: RequestInfo | URL, init: NetFetchOptions = {}): Promise<string> {
  const resp = await netFetch(input, init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Network error: ${resp.status} ${resp.statusText}${text ? ` - ${text.slice(0, 200)}` : ''}`);
  }
  return await resp.text();
}
