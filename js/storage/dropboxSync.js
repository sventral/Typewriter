const DROPBOX_AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const DROPBOX_SETTINGS_PATH = '/settings.json';
const DROPBOX_DOCUMENTS_DIR = '/documents';
const DROPBOX_APP_FOLDER_PATH = '/Apps/Typewriter';
const CALLBACK_PAGE_NAME = 'dropbox-auth.html';

const OAUTH_EXPIRY_SKEW_MS = 60 * 1000;
const AUTO_SYNC_DEBOUNCE_MS = 2500;

const PKCE_STATE_SUFFIX = '::dropbox.pkce.state.v2';
const PKCE_VERIFIER_SUFFIX = '::dropbox.pkce.verifier.v2';
const TOKEN_SUFFIX = '::dropbox.oauth.v2';
const AUTH_RESULT_SUFFIX = '::dropbox.auth.result.v2';
const SYNC_STATE_SUFFIX = '::dropbox.sync.state.v2';

const APP_KEY_PLACEHOLDER = 'PASTE_DROPBOX_APP_KEY_HERE';
export const DROPBOX_APP_KEY = '7auk49ga7ozfe9y';


function canUseDom() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function safeGetStorage(kind) {
  if (!canUseDom()) return null;
  try {
    if (kind === 'session') return window.sessionStorage || null;
    return window.localStorage || null;
  } catch {
    return null;
  }
}

function safeGetItem(storage, key) {
  if (!storage || !key) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(storage, key, value) {
  if (!storage || !key) return;
  try {
    storage.setItem(key, value);
  } catch {}
}

function safeRemoveItem(storage, key) {
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {}
}

function readJsonResponseText(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  return readJsonResponseText(text);
}

function randomBytes(length) {
  if (
    !canUseDom()
    || !window.crypto
    || typeof window.crypto.getRandomValues !== 'function'
  ) {
    throw new Error('Browser crypto support is required for Dropbox sign-in.');
  }
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function utf8ToBytes(value) {
  return new TextEncoder().encode(value);
}

async function createCodeChallenge(verifier) {
  if (
    !canUseDom()
    || !window.crypto
    || !window.crypto.subtle
    || typeof window.crypto.subtle.digest !== 'function'
  ) {
    throw new Error('Browser crypto support is required for Dropbox sign-in.');
  }
  const digest = await window.crypto.subtle.digest('SHA-256', utf8ToBytes(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

function parseTokenRecord(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.accessToken !== 'string' || !parsed.accessToken.trim()) return null;
    return {
      accessToken: parsed.accessToken.trim(),
      refreshToken: typeof parsed.refreshToken === 'string' && parsed.refreshToken.trim()
        ? parsed.refreshToken.trim()
        : null,
      expiresAtMs: Number.isFinite(parsed.expiresAtMs) ? Number(parsed.expiresAtMs) : null,
      scope: typeof parsed.scope === 'string' ? parsed.scope : null,
      tokenType: typeof parsed.tokenType === 'string' ? parsed.tokenType : null,
    };
  } catch {
    return null;
  }
}

function normalizeTokenPayload(payload, previous = null) {
  const accessToken = typeof payload?.access_token === 'string' ? payload.access_token.trim() : '';
  if (!accessToken) throw new Error('Dropbox returned an invalid access token.');

  const refreshToken = typeof payload?.refresh_token === 'string' && payload.refresh_token.trim()
    ? payload.refresh_token.trim()
    : (previous?.refreshToken || null);

  const expiresIn = Number(payload?.expires_in);
  const expiresAtMs = Number.isFinite(expiresIn)
    ? Date.now() + (Math.max(1, expiresIn) * 1000)
    : (previous?.expiresAtMs || null);

  return {
    accessToken,
    refreshToken,
    expiresAtMs,
    scope: typeof payload?.scope === 'string' ? payload.scope : (previous?.scope || null),
    tokenType: typeof payload?.token_type === 'string' ? payload.token_type : (previous?.tokenType || null),
  };
}

function isTokenExpired(token) {
  if (!token || !Number.isFinite(token.expiresAtMs)) return false;
  return Date.now() >= (token.expiresAtMs - OAUTH_EXPIRY_SKEW_MS);
}

async function postTokenForm(params) {
  const response = await fetch(DROPBOX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const detail = payload?.error_description || payload?.error_summary || payload?.error || response.statusText;
    throw new Error(`Dropbox token request failed: ${detail}`);
  }
  return payload;
}

function resolveAppBasePath(pathname) {
  if (typeof pathname !== 'string' || !pathname) return '/';
  if (pathname.endsWith(`/${CALLBACK_PAGE_NAME}`)) {
    return pathname.slice(0, -CALLBACK_PAGE_NAME.length);
  }
  if (pathname.endsWith('/')) return pathname;
  const slash = pathname.lastIndexOf('/');
  if (slash < 0) return '/';
  return `${pathname.slice(0, slash + 1)}`;
}

function resolveDefaultRedirectUri() {
  if (!canUseDom()) return '';
  const basePath = resolveAppBasePath(window.location.pathname);
  return `${window.location.origin}${basePath}${CALLBACK_PAGE_NAME}`;
}

function resolveDefaultHomeUri() {
  if (!canUseDom()) return '';
  const basePath = resolveAppBasePath(window.location.pathname);
  return `${window.location.origin}${basePath}`;
}

function normalizeAppKey(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'PASTE_DROPBOX_APP_KEY_HERE') return '';
  return trimmed;
}

function resolveConfiguredAppKey(explicitAppKey = '') {
  const direct = normalizeAppKey(explicitAppKey);
  if (direct) return direct;
  if (canUseDom()) {
    const windowValue = normalizeAppKey(window.TYPEWRITER_DROPBOX_APP_KEY);
    if (windowValue) return windowValue;
  }
  return normalizeAppKey(DROPBOX_APP_KEY);
}

function resolveConfig(options = {}) {
  const appKey = resolveConfiguredAppKey(options.appKey);

  const keyPrefix = typeof options.storageKey === 'string' && options.storageKey.trim()
    ? options.storageKey.trim()
    : 'typewriter';

  const redirectUri = (typeof options.redirectUri === 'string' && options.redirectUri.trim())
    ? options.redirectUri.trim()
    : resolveDefaultRedirectUri();

  const homeUri = (typeof options.homeUri === 'string' && options.homeUri.trim())
    ? options.homeUri.trim()
    : resolveDefaultHomeUri();

  return {
    appKey,
    keyPrefix,
    redirectUri,
    homeUri,
    folderPath: DROPBOX_APP_FOLDER_PATH,
  };
}

function buildStorageKeys(keyPrefix) {
  const prefix = (typeof keyPrefix === 'string' && keyPrefix.trim())
    ? keyPrefix.trim()
    : 'typewriter';
  return {
    tokenKey: `${prefix}${TOKEN_SUFFIX}`,
    pkceStateKey: `${prefix}${PKCE_STATE_SUFFIX}`,
    pkceVerifierKey: `${prefix}${PKCE_VERIFIER_SUFFIX}`,
    authResultKey: `${prefix}${AUTH_RESULT_SUFFIX}`,
    syncStateKey: `${prefix}${SYNC_STATE_SUFFIX}`,
  };
}

function normalizeSyncState(rawState = null) {
  const parsed = rawState && typeof rawState === 'object' ? rawState : {};
  const settings = parsed.settings && typeof parsed.settings === 'object'
    ? parsed.settings
    : {};
  const docs = parsed.documents && typeof parsed.documents === 'object'
    ? parsed.documents
    : {};
  const normalizedDocs = {};
  Object.entries(docs).forEach(([docId, value]) => {
    if (typeof docId !== 'string' || !docId.trim()) return;
    const item = value && typeof value === 'object' ? value : {};
    normalizedDocs[docId] = {
      localHash: typeof item.localHash === 'string' ? item.localHash : null,
      remoteRev: typeof item.remoteRev === 'string' ? item.remoteRev : null,
      remoteModifiedMs: Number.isFinite(item.remoteModifiedMs) ? Number(item.remoteModifiedMs) : null,
    };
  });

  return {
    autoSync: !!parsed.autoSync,
    lastSyncAtMs: Number.isFinite(parsed.lastSyncAtMs) ? Number(parsed.lastSyncAtMs) : null,
    lastError: typeof parsed.lastError === 'string' ? parsed.lastError : '',
    settings: {
      localHash: typeof settings.localHash === 'string' ? settings.localHash : null,
      remoteRev: typeof settings.remoteRev === 'string' ? settings.remoteRev : null,
      remoteModifiedMs: Number.isFinite(settings.remoteModifiedMs) ? Number(settings.remoteModifiedMs) : null,
    },
    documents: normalizedDocs,
  };
}

function formatSyncTimestamp(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return 'Never';
  try {
    const formatter = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return formatter.format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

function hashText(value) {
  const text = typeof value === 'string' ? value : '';
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

function deepCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function generateConflictId(existingIds = new Set()) {
  const hasCrypto = canUseDom() && window.crypto && typeof window.crypto.randomUUID === 'function';
  let candidate = '';
  do {
    candidate = hasCrypto
      ? window.crypto.randomUUID()
      : `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  } while (existingIds.has(candidate));
  existingIds.add(candidate);
  return candidate;
}

function buildConflictStamp(ts = Date.now()) {
  try {
    return new Date(ts).toISOString().replace(/[.:]/g, '-');
  } catch {
    return String(ts);
  }
}

function buildConflictTitle(baseTitle, sourceLabel, ts = Date.now()) {
  const safeBase = typeof baseTitle === 'string' && baseTitle.trim()
    ? baseTitle.trim()
    : 'Untitled Document';
  const stamp = buildConflictStamp(ts).slice(0, 16).replace('T', ' ');
  return `${safeBase} (conflict ${sourceLabel}, ${stamp})`;
}

function encodeDocumentPath(docId) {
  return `${DROPBOX_DOCUMENTS_DIR}/${encodeURIComponent(docId)}.json`;
}

function decodeDocumentIdFromEntryName(name) {
  if (typeof name !== 'string') return null;
  if (!name.toLowerCase().endsWith('.json')) return null;
  const raw = name.slice(0, -5);
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw).trim();
    return decoded || null;
  } catch {
    return raw.trim() || null;
  }
}

function unwrapDropboxResult(response) {
  if (response && typeof response === 'object' && response.result && typeof response.result === 'object') {
    return response.result;
  }
  return response;
}

function summarizeDropboxError(err) {
  if (!err) return 'Unknown Dropbox error.';
  if (typeof err === 'string') return err;

  const queue = [
    err?.error_summary,
    err?.message,
    err?.error?.error_summary,
    err?.error?.reason?.['.tag'],
    err?.error?.reason,
    err?.response?.error_summary,
    err?.statusText,
  ];

  for (const item of queue) {
    if (typeof item === 'string' && item.trim()) return item.trim();
  }

  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown Dropbox error.';
  }
}

function isDropboxPathNotFound(err) {
  const detail = summarizeDropboxError(err).toLowerCase();
  return detail.includes('path/not_found') || detail.includes('not_found');
}

function isDropboxConflict(err) {
  const detail = summarizeDropboxError(err).toLowerCase();
  return detail.includes('path/conflict') || detail.includes('conflict');
}

function parseDropboxTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function extractDownloadedBlob(downloadResult) {
  if (!downloadResult || typeof downloadResult !== 'object') return null;
  if (downloadResult.fileBlob && typeof downloadResult.fileBlob.text === 'function') return downloadResult.fileBlob;
  if (downloadResult.file_blob && typeof downloadResult.file_blob.text === 'function') return downloadResult.file_blob;
  return null;
}

function safeParseJson(text, fallbackValue = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallbackValue;
  }
}

function normalizeSettingsPayload(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const docs = Array.isArray(input.documents) ? input.documents : [];
  const normalizedDocs = [];
  const seen = new Set();

  docs.forEach((entry) => {
    const item = entry && typeof entry === 'object' ? entry : {};
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    normalizedDocs.push({
      id,
      title: typeof item.title === 'string' ? item.title : 'Untitled Document',
      createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : Date.now(),
      updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : Date.now(),
      dataSize: Number.isFinite(item.dataSize) ? Number(item.dataSize) : 0,
    });
  });

  const activeId = typeof input.activeId === 'string' && input.activeId.trim() ? input.activeId.trim() : null;

  return {
    version: 1,
    activeId,
    documents: normalizedDocs,
  };
}

function buildSettingsPayloadFromSnapshot(snapshot) {
  const docs = Array.isArray(snapshot?.documents) ? snapshot.documents : [];
  const normalizedDocs = docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    createdAt: Number.isFinite(doc.createdAt) ? doc.createdAt : Date.now(),
    updatedAt: Number.isFinite(doc.updatedAt) ? doc.updatedAt : Date.now(),
    dataSize: Number.isFinite(doc.dataSize) ? doc.dataSize : 0,
  }));
  return normalizeSettingsPayload({
    version: 1,
    activeId: snapshot?.activeId || null,
    documents: normalizedDocs,
  });
}

function normalizeLocalSnapshot(snapshot) {
  const docs = Array.isArray(snapshot?.documents) ? snapshot.documents : [];
  const seen = new Set();
  const normalizedDocs = [];

  docs.forEach((entry) => {
    const item = entry && typeof entry === 'object' ? entry : {};
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id || seen.has(id)) return;
    if (!item.data || typeof item.data !== 'object') return;
    seen.add(id);
    normalizedDocs.push({
      id,
      title: typeof item.title === 'string' ? item.title : 'Untitled Document',
      createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : Date.now(),
      updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : Date.now(),
      dataSize: Number.isFinite(item.dataSize) ? Number(item.dataSize) : 0,
      data: deepCloneJson(item.data),
    });
  });

  const activeId = typeof snapshot?.activeId === 'string' && snapshot.activeId.trim() && seen.has(snapshot.activeId.trim())
    ? snapshot.activeId.trim()
    : (normalizedDocs[0]?.id || null);

  return {
    documents: normalizedDocs,
    activeId,
  };
}

function getDropboxSdkOrThrow() {
  if (!canUseDom()) throw new Error('Dropbox requires a browser environment.');
  const sdk = window.Dropbox;
  if (!sdk || typeof sdk.Dropbox !== 'function') {
    throw new Error('Dropbox SDK failed to load. Reload the page and try again.');
  }
  return sdk;
}

function findPkcePrefixByState(sessionStorageRef, stateValue) {
  if (!sessionStorageRef || typeof sessionStorageRef.length !== 'number') return null;
  if (typeof stateValue !== 'string' || !stateValue) return null;
  for (let i = 0; i < sessionStorageRef.length; i += 1) {
    const key = sessionStorageRef.key(i);
    if (!key || !key.endsWith(PKCE_STATE_SUFFIX)) continue;
    const stored = safeGetItem(sessionStorageRef, key);
    if (stored !== stateValue) continue;
    return key.slice(0, -PKCE_STATE_SUFFIX.length);
  }
  return null;
}

async function downloadDropboxFileText(dbx, path) {
  try {
    const raw = await dbx.filesDownload({ path });
    const result = unwrapDropboxResult(raw);
    const blob = extractDownloadedBlob(result) || extractDownloadedBlob(raw);
    if (!blob || typeof blob.text !== 'function') {
      throw new Error('Dropbox download response did not include file content.');
    }
    const text = await blob.text();
    return {
      text,
      metadata: {
        rev: typeof result?.rev === 'string' ? result.rev : null,
        serverModifiedMs: parseDropboxTimestamp(result?.server_modified),
      },
    };
  } catch (err) {
    if (isDropboxPathNotFound(err)) return null;
    throw new Error(`Dropbox download failed: ${summarizeDropboxError(err)}`);
  }
}

async function uploadDropboxFileText(dbx, path, text) {
  try {
    const raw = await dbx.filesUpload({
      path,
      mode: { '.tag': 'overwrite' },
      autorename: false,
      mute: true,
      strict_conflict: false,
      contents: new Blob([text], { type: 'application/json' }),
    });
    const result = unwrapDropboxResult(raw);
    return {
      rev: typeof result?.rev === 'string' ? result.rev : null,
      serverModifiedMs: parseDropboxTimestamp(result?.server_modified),
    };
  } catch (err) {
    throw new Error(`Dropbox upload failed: ${summarizeDropboxError(err)}`);
  }
}

async function ensureDropboxFolder(dbx, path) {
  try {
    await dbx.filesCreateFolderV2({ path, autorename: false });
  } catch (err) {
    if (isDropboxConflict(err)) return;
    if (isDropboxPathNotFound(err) && path === DROPBOX_DOCUMENTS_DIR) {
      // Root app folder path exists automatically in App Folder apps.
      return;
    }
    throw new Error(`Dropbox folder setup failed: ${summarizeDropboxError(err)}`);
  }
}

async function listRemoteDocumentEntries(dbx) {
  const out = new Map();
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    let page;
    try {
      if (!cursor) {
        const raw = await dbx.filesListFolder({ path: DROPBOX_DOCUMENTS_DIR });
        page = unwrapDropboxResult(raw);
      } else {
        const raw = await dbx.filesListFolderContinue({ cursor });
        page = unwrapDropboxResult(raw);
      }
    } catch (err) {
      if (isDropboxPathNotFound(err)) return out;
      throw new Error(`Dropbox list failed: ${summarizeDropboxError(err)}`);
    }

    const entries = Array.isArray(page?.entries) ? page.entries : [];
    entries.forEach((entry) => {
      if (!entry || entry['.tag'] !== 'file') return;
      const docId = decodeDocumentIdFromEntryName(entry.name);
      if (!docId) return;
      out.set(docId, {
        id: docId,
        path: typeof entry.path_display === 'string' && entry.path_display
          ? entry.path_display
          : encodeDocumentPath(docId),
        rev: typeof entry.rev === 'string' ? entry.rev : null,
        serverModifiedMs: parseDropboxTimestamp(entry.server_modified),
      });
    });

    hasMore = !!page?.has_more;
    cursor = typeof page?.cursor === 'string' ? page.cursor : null;
    if (hasMore && !cursor) break;
  }

  return out;
}

function buildPublicStatus(config, token, syncState, isSyncing) {
  const configured = !!config.appKey;
  const connected = !!token;
  const autoSync = !!syncState.autoSync;
  let status = 'Not connected';
  if (!configured) status = 'App key not configured';
  else if (connected && isSyncing) status = 'Syncing…';
  else if (connected) status = 'Connected';

  return {
    configured,
    connected,
    syncing: !!isSyncing,
    status,
    folderPath: config.folderPath,
    autoSync,
    lastSyncAtMs: syncState.lastSyncAtMs,
    lastSyncLabel: formatSyncTimestamp(syncState.lastSyncAtMs),
    error: syncState.lastError || '',
  };
}

export function createDropboxSyncController(options = {}) {
  const config = resolveConfig(options);
  const keys = buildStorageKeys(config.keyPrefix);
  const localStorageRef = safeGetStorage('local');
  const sessionStorageRef = safeGetStorage('session');

  let syncState = normalizeSyncState(safeParseJson(safeGetItem(localStorageRef, keys.syncStateKey), null));
  let isSyncing = false;
  let queuedSync = false;
  let autoSyncTimer = 0;
  const statusListeners = new Set();

  const readToken = () => parseTokenRecord(safeGetItem(localStorageRef, keys.tokenKey));
  const writeToken = (token) => safeSetItem(localStorageRef, keys.tokenKey, JSON.stringify(token));
  const clearToken = () => safeRemoveItem(localStorageRef, keys.tokenKey);

  function persistSyncState() {
    safeSetItem(localStorageRef, keys.syncStateKey, JSON.stringify(syncState));
  }

  function updateSyncState(patch = {}) {
    syncState = normalizeSyncState({ ...syncState, ...patch });
    persistSyncState();
    notifyStatus();
  }

  function setSyncError(message = '') {
    const next = typeof message === 'string' ? message.trim() : '';
    syncState.lastError = next;
    persistSyncState();
    notifyStatus();
  }

  function clearPkceState() {
    safeRemoveItem(sessionStorageRef, keys.pkceStateKey);
    safeRemoveItem(sessionStorageRef, keys.pkceVerifierKey);
  }

  async function refreshTokenIfNeeded() {
    const current = readToken();
    if (!current) throw new Error('Dropbox is not connected.');
    if (!isTokenExpired(current)) return current.accessToken;

    if (!current.refreshToken) {
      clearToken();
      throw new Error('Dropbox session expired. Please connect again.');
    }

    if (!config.appKey) {
      clearToken();
      throw new Error('Dropbox app key is not configured.');
    }

    const refreshedPayload = await postTokenForm({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: config.appKey,
    });

    const normalized = normalizeTokenPayload(refreshedPayload, current);
    writeToken(normalized);
    return normalized.accessToken;
  }

  async function createDropboxClient() {
    const accessToken = await refreshTokenIfNeeded();
    const sdk = getDropboxSdkOrThrow();
    return new sdk.Dropbox({
      accessToken,
      fetch,
    });
  }

  function notifyStatus() {
    const token = readToken();
    const status = buildPublicStatus(config, token, syncState, isSyncing);
    statusListeners.forEach((listener) => {
      try {
        listener(status);
      } catch {}
    });
    if (typeof options.onStatusChange === 'function') {
      try {
        options.onStatusChange(status);
      } catch {}
    }
  }

  function consumeAuthResult() {
    const raw = safeGetItem(localStorageRef, keys.authResultKey);
    if (!raw) return;
    safeRemoveItem(localStorageRef, keys.authResultKey);
    const parsed = safeParseJson(raw, null);
    if (!parsed || typeof parsed !== 'object') return;
    if (parsed.ok === true) {
      setSyncError('');
      if (typeof options.onNotice === 'function') {
        options.onNotice('Dropbox connected.', { level: 'info' });
      }
      return;
    }
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      setSyncError(parsed.error.trim());
      if (typeof options.onNotice === 'function') {
        options.onNotice(parsed.error.trim(), { level: 'error' });
      }
    }
  }

  async function startAuth() {
    if (!config.appKey) {
      throw new Error('Dropbox is not configured. Set DROPBOX_APP_KEY first.');
    }
    if (!config.redirectUri) {
      throw new Error('Dropbox redirect URI could not be determined.');
    }
    if (!sessionStorageRef) {
      throw new Error('Session storage is unavailable; Dropbox sign-in cannot continue.');
    }

    const state = bytesToBase64Url(randomBytes(16));
    const verifier = bytesToBase64Url(randomBytes(64));
    const challenge = await createCodeChallenge(verifier);

    safeSetItem(sessionStorageRef, keys.pkceStateKey, state);
    safeSetItem(sessionStorageRef, keys.pkceVerifierKey, verifier);

    const params = new URLSearchParams({
      client_id: config.appKey,
      response_type: 'code',
      token_access_type: 'offline',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      redirect_uri: config.redirectUri,
      state,
    });

    window.location.assign(`${DROPBOX_AUTHORIZE_URL}?${params.toString()}`);
  }

  function disconnect() {
    clearPkceState();
    clearToken();
    syncState = normalizeSyncState({
      ...syncState,
      lastError: '',
      settings: { localHash: null, remoteRev: null, remoteModifiedMs: null },
      documents: {},
    });
    persistSyncState();
    notifyStatus();
  }

  function setAutoSync(enabled) {
    syncState.autoSync = !!enabled;
    persistSyncState();
    notifyStatus();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    statusListeners.add(listener);
    try {
      listener(buildPublicStatus(config, readToken(), syncState, isSyncing));
    } catch {}
    return () => {
      statusListeners.delete(listener);
    };
  }

  function getStatus() {
    return buildPublicStatus(config, readToken(), syncState, isSyncing);
  }

  function reportNotice(message, level = 'info') {
    if (typeof options.onNotice !== 'function' || !message) return;
    options.onNotice(message, { level });
  }

  async function readRemoteDocumentById(dbx, docId, remoteMetaById, remoteSettingsById) {
    const meta = remoteMetaById.get(docId);
    if (!meta) return null;
    const downloaded = await downloadDropboxFileText(dbx, meta.path || encodeDocumentPath(docId));
    if (!downloaded) return null;
    const payload = safeParseJson(downloaded.text, null);
    if (!payload || typeof payload !== 'object') {
      throw new Error(`Remote document ${docId} is not valid JSON.`);
    }

    const settingsMeta = remoteSettingsById.get(docId);
    const title = typeof settingsMeta?.title === 'string' && settingsMeta.title.trim()
      ? settingsMeta.title
      : (typeof payload.documentTitle === 'string' && payload.documentTitle.trim()
        ? payload.documentTitle
        : 'Untitled Document');

    const createdAt = Number.isFinite(settingsMeta?.createdAt)
      ? Number(settingsMeta.createdAt)
      : Date.now();

    const updatedAt = Number.isFinite(settingsMeta?.updatedAt)
      ? Number(settingsMeta.updatedAt)
      : (meta.serverModifiedMs || Date.now());

    const dataSize = downloaded.text.length;

    return {
      id: docId,
      title,
      createdAt,
      updatedAt,
      dataSize,
      data: payload,
      hash: hashText(downloaded.text),
      remoteRev: typeof meta.rev === 'string' ? meta.rev : downloaded.metadata.rev,
      remoteModifiedMs: Number.isFinite(meta.serverModifiedMs) ? meta.serverModifiedMs : downloaded.metadata.serverModifiedMs,
      text: downloaded.text,
    };
  }

  function prepareLocalDocuments(snapshot) {
    const map = new Map();
    snapshot.documents.forEach((doc) => {
      const text = JSON.stringify(doc.data);
      map.set(doc.id, {
        ...doc,
        text,
        hash: hashText(text),
      });
    });
    return map;
  }

  function createConflictFromDoc(sourceDoc, sourceLabel, existingIds) {
    const now = Date.now();
    const id = generateConflictId(existingIds);
    return {
      id,
      title: buildConflictTitle(sourceDoc.title, sourceLabel, now),
      createdAt: Number.isFinite(sourceDoc.createdAt) ? sourceDoc.createdAt : now,
      updatedAt: now,
      dataSize: Number.isFinite(sourceDoc.dataSize) ? sourceDoc.dataSize : 0,
      data: deepCloneJson(sourceDoc.data),
    };
  }

  async function performSync(trigger = 'manual') {
    if (isSyncing) {
      queuedSync = true;
      return { queued: true };
    }

    if (!config.appKey) {
      const msg = 'Dropbox app key is not configured.';
      setSyncError(msg);
      throw new Error(msg);
    }

    const token = readToken();
    if (!token) {
      const msg = 'Dropbox is not connected.';
      setSyncError(msg);
      throw new Error(msg);
    }

    if (typeof options.getLocalSnapshot !== 'function') {
      throw new Error('Dropbox sync is missing local snapshot hooks.');
    }

    if (typeof options.applyMergedSnapshot !== 'function') {
      throw new Error('Dropbox sync is missing apply snapshot hooks.');
    }

    isSyncing = true;
    notifyStatus();

    try {
      if (typeof options.beforeSync === 'function') {
        await options.beforeSync({ trigger });
      }

      const localSnapshotRaw = await options.getLocalSnapshot();
      const localSnapshot = normalizeLocalSnapshot(localSnapshotRaw);
      const localSettingsPayload = buildSettingsPayloadFromSnapshot(localSnapshot);
      const localSettingsText = JSON.stringify(localSettingsPayload);
      const localSettingsHash = hashText(localSettingsText);
      const localDocs = prepareLocalDocuments(localSnapshot);
      const mergedDocs = new Map(localDocs);
      const existingIds = new Set(localDocs.keys());
      const pendingConflictUploads = [];
      let localNeedsApply = false;

      const dbx = await createDropboxClient();
      await ensureDropboxFolder(dbx, DROPBOX_DOCUMENTS_DIR);

      const remoteSettingsDownload = await downloadDropboxFileText(dbx, DROPBOX_SETTINGS_PATH);
      const remoteSettingsPayload = remoteSettingsDownload
        ? normalizeSettingsPayload(safeParseJson(remoteSettingsDownload.text, {}))
        : normalizeSettingsPayload(null);
      const remoteSettingsById = new Map(remoteSettingsPayload.documents.map((doc) => [doc.id, doc]));
      const remoteSettingsHash = remoteSettingsDownload ? hashText(remoteSettingsDownload.text) : null;
      const remoteSettingsMeta = remoteSettingsDownload
        ? {
            rev: remoteSettingsDownload.metadata.rev,
            serverModifiedMs: remoteSettingsDownload.metadata.serverModifiedMs,
          }
        : null;

      const remoteDocsMeta = await listRemoteDocumentEntries(dbx);
      const allIds = new Set([...localDocs.keys(), ...remoteDocsMeta.keys()]);
      const nextSyncDocsState = {};

      const remoteDocCache = new Map();
      const readRemoteDocCached = async (docId) => {
        if (remoteDocCache.has(docId)) return remoteDocCache.get(docId);
        const loaded = await readRemoteDocumentById(dbx, docId, remoteDocsMeta, remoteSettingsById);
        remoteDocCache.set(docId, loaded);
        return loaded;
      };

      for (const docId of allIds) {
        const localDoc = localDocs.get(docId) || null;
        const remoteMeta = remoteDocsMeta.get(docId) || null;
        const prior = syncState.documents?.[docId] || null;

        if (localDoc && !remoteMeta) {
          const uploadedMeta = await uploadDropboxFileText(dbx, encodeDocumentPath(docId), localDoc.text);
          mergedDocs.set(docId, localDoc);
          nextSyncDocsState[docId] = {
            localHash: localDoc.hash,
            remoteRev: uploadedMeta.rev,
            remoteModifiedMs: uploadedMeta.serverModifiedMs,
          };
          continue;
        }

        if (!localDoc && remoteMeta) {
          const remoteDoc = await readRemoteDocCached(docId);
          if (!remoteDoc) continue;
          mergedDocs.set(docId, remoteDoc);
          localNeedsApply = true;
          existingIds.add(docId);
          nextSyncDocsState[docId] = {
            localHash: remoteDoc.hash,
            remoteRev: remoteDoc.remoteRev,
            remoteModifiedMs: remoteDoc.remoteModifiedMs,
          };
          continue;
        }

        if (!localDoc || !remoteMeta) continue;

        const localChanged = !prior || prior.localHash !== localDoc.hash;
        const remoteChanged = !prior || prior.remoteRev !== remoteMeta.rev;

        if (!localChanged && !remoteChanged) {
          mergedDocs.set(docId, localDoc);
          nextSyncDocsState[docId] = {
            localHash: localDoc.hash,
            remoteRev: remoteMeta.rev,
            remoteModifiedMs: remoteMeta.serverModifiedMs,
          };
          continue;
        }

        if (localChanged && !remoteChanged) {
          const uploadedMeta = await uploadDropboxFileText(dbx, encodeDocumentPath(docId), localDoc.text);
          mergedDocs.set(docId, localDoc);
          nextSyncDocsState[docId] = {
            localHash: localDoc.hash,
            remoteRev: uploadedMeta.rev,
            remoteModifiedMs: uploadedMeta.serverModifiedMs,
          };
          continue;
        }

        if (!localChanged && remoteChanged) {
          const remoteDoc = await readRemoteDocCached(docId);
          if (!remoteDoc) continue;
          mergedDocs.set(docId, remoteDoc);
          localNeedsApply = true;
          nextSyncDocsState[docId] = {
            localHash: remoteDoc.hash,
            remoteRev: remoteDoc.remoteRev,
            remoteModifiedMs: remoteDoc.remoteModifiedMs,
          };
          continue;
        }

        const remoteDoc = await readRemoteDocCached(docId);
        if (!remoteDoc) {
          const uploadedMeta = await uploadDropboxFileText(dbx, encodeDocumentPath(docId), localDoc.text);
          mergedDocs.set(docId, localDoc);
          nextSyncDocsState[docId] = {
            localHash: localDoc.hash,
            remoteRev: uploadedMeta.rev,
            remoteModifiedMs: uploadedMeta.serverModifiedMs,
          };
          continue;
        }

        if (remoteDoc.hash === localDoc.hash) {
          mergedDocs.set(docId, localDoc);
          nextSyncDocsState[docId] = {
            localHash: localDoc.hash,
            remoteRev: remoteDoc.remoteRev,
            remoteModifiedMs: remoteDoc.remoteModifiedMs,
          };
          continue;
        }

        const localUpdated = Number.isFinite(localDoc.updatedAt) ? localDoc.updatedAt : 0;
        const remoteUpdated = Number.isFinite(remoteDoc.updatedAt)
          ? remoteDoc.updatedAt
          : (remoteMeta.serverModifiedMs || 0);

        if (localUpdated >= remoteUpdated) {
          const conflictCopy = createConflictFromDoc(remoteDoc, 'remote', existingIds);
          mergedDocs.set(conflictCopy.id, {
            ...conflictCopy,
            text: JSON.stringify(conflictCopy.data),
            hash: hashText(JSON.stringify(conflictCopy.data)),
          });
          pendingConflictUploads.push(conflictCopy);
          localNeedsApply = true;

          const uploadedMeta = await uploadDropboxFileText(dbx, encodeDocumentPath(docId), localDoc.text);
          mergedDocs.set(docId, localDoc);
          nextSyncDocsState[docId] = {
            localHash: localDoc.hash,
            remoteRev: uploadedMeta.rev,
            remoteModifiedMs: uploadedMeta.serverModifiedMs,
          };
          continue;
        }

        const localConflictCopy = createConflictFromDoc(localDoc, 'local', existingIds);
        const localConflictText = JSON.stringify(localConflictCopy.data);
        const localConflictHash = hashText(localConflictText);
        mergedDocs.set(localConflictCopy.id, {
          ...localConflictCopy,
          text: localConflictText,
          hash: localConflictHash,
        });
        pendingConflictUploads.push(localConflictCopy);
        localNeedsApply = true;

        mergedDocs.set(docId, remoteDoc);
        nextSyncDocsState[docId] = {
          localHash: remoteDoc.hash,
          remoteRev: remoteDoc.remoteRev,
          remoteModifiedMs: remoteDoc.remoteModifiedMs,
        };
      }

      for (const conflictDoc of pendingConflictUploads) {
        const conflictText = JSON.stringify(conflictDoc.data);
        const conflictHash = hashText(conflictText);
        const uploadedMeta = await uploadDropboxFileText(dbx, encodeDocumentPath(conflictDoc.id), conflictText);
        nextSyncDocsState[conflictDoc.id] = {
          localHash: conflictHash,
          remoteRev: uploadedMeta.rev,
          remoteModifiedMs: uploadedMeta.serverModifiedMs,
        };
      }

      let effectiveSettingsPayload = localSettingsPayload;
      let effectiveSettingsHash = localSettingsHash;
      let effectiveSettingsMeta = {
        rev: syncState.settings?.remoteRev || null,
        serverModifiedMs: syncState.settings?.remoteModifiedMs || null,
      };

      const settingsPrior = syncState.settings || {};
      const localSettingsChanged = !settingsPrior.localHash || settingsPrior.localHash !== localSettingsHash;
      const remoteSettingsChanged = remoteSettingsMeta
        ? (!settingsPrior.remoteRev || settingsPrior.remoteRev !== remoteSettingsMeta.rev)
        : false;

      if (!remoteSettingsMeta) {
        const uploaded = await uploadDropboxFileText(dbx, DROPBOX_SETTINGS_PATH, localSettingsText);
        effectiveSettingsMeta = uploaded;
      } else if (localSettingsChanged && !remoteSettingsChanged) {
        const uploaded = await uploadDropboxFileText(dbx, DROPBOX_SETTINGS_PATH, localSettingsText);
        effectiveSettingsMeta = uploaded;
      } else if (!localSettingsChanged && remoteSettingsChanged) {
        effectiveSettingsPayload = remoteSettingsPayload;
        effectiveSettingsHash = remoteSettingsHash || localSettingsHash;
        effectiveSettingsMeta = remoteSettingsMeta;
        localNeedsApply = true;
      } else if (localSettingsChanged && remoteSettingsChanged && remoteSettingsHash && remoteSettingsHash !== localSettingsHash) {
        const localMaxUpdated = Math.max(...localSettingsPayload.documents.map((d) => d.updatedAt || 0), 0);
        const remoteMaxUpdated = Math.max(...remoteSettingsPayload.documents.map((d) => d.updatedAt || 0), 0);

        const conflictPath = `/settings.conflict.${buildConflictStamp()}.json`;

        if (localMaxUpdated >= remoteMaxUpdated) {
          await uploadDropboxFileText(dbx, conflictPath, remoteSettingsDownload?.text || JSON.stringify(remoteSettingsPayload));
          const uploaded = await uploadDropboxFileText(dbx, DROPBOX_SETTINGS_PATH, localSettingsText);
          effectiveSettingsMeta = uploaded;
        } else {
          await uploadDropboxFileText(dbx, conflictPath, localSettingsText);
          effectiveSettingsPayload = remoteSettingsPayload;
          effectiveSettingsHash = remoteSettingsHash;
          effectiveSettingsMeta = remoteSettingsMeta;
          localNeedsApply = true;
        }
      } else if (remoteSettingsMeta) {
        effectiveSettingsMeta = remoteSettingsMeta;
      }

      if (effectiveSettingsPayload && Array.isArray(effectiveSettingsPayload.documents)) {
        const settingsById = new Map(effectiveSettingsPayload.documents.map((doc) => [doc.id, doc]));
        mergedDocs.forEach((doc, id) => {
          const meta = settingsById.get(id);
          if (!meta) return;
          doc.title = typeof meta.title === 'string' ? meta.title : doc.title;
          if (Number.isFinite(meta.createdAt)) doc.createdAt = meta.createdAt;
          if (Number.isFinite(meta.updatedAt)) doc.updatedAt = meta.updatedAt;
          if (Number.isFinite(meta.dataSize)) doc.dataSize = meta.dataSize;
        });
      }

      const mergedList = Array.from(mergedDocs.values()).map((doc) => ({
        id: doc.id,
        title: doc.title,
        createdAt: Number.isFinite(doc.createdAt) ? doc.createdAt : Date.now(),
        updatedAt: Number.isFinite(doc.updatedAt) ? doc.updatedAt : Date.now(),
        dataSize: Number.isFinite(doc.dataSize) ? doc.dataSize : 0,
        data: deepCloneJson(doc.data),
      }));

      const mergedIds = new Set(mergedList.map((doc) => doc.id));
      let nextActiveId = typeof effectiveSettingsPayload?.activeId === 'string' && mergedIds.has(effectiveSettingsPayload.activeId)
        ? effectiveSettingsPayload.activeId
        : null;
      if (!nextActiveId && mergedIds.has(localSnapshot.activeId)) {
        nextActiveId = localSnapshot.activeId;
      }
      if (!nextActiveId) {
        nextActiveId = mergedList[0]?.id || null;
      }

      if (localNeedsApply) {
        await options.applyMergedSnapshot({
          activeId: nextActiveId,
          documents: mergedList,
        });
      }

      syncState = normalizeSyncState({
        ...syncState,
        lastError: '',
        lastSyncAtMs: Date.now(),
        settings: {
          localHash: effectiveSettingsHash,
          remoteRev: effectiveSettingsMeta?.rev || null,
          remoteModifiedMs: effectiveSettingsMeta?.serverModifiedMs || null,
        },
        documents: nextSyncDocsState,
      });
      persistSyncState();
      notifyStatus();

      const conflictCount = pendingConflictUploads.length;
      if (conflictCount > 0) {
        reportNotice(`Dropbox sync completed with ${conflictCount} conflict copy${conflictCount === 1 ? '' : 'ies'}.`, 'info');
      } else {
        reportNotice('Dropbox sync complete.', 'info');
      }

      return {
        synced: true,
        conflicts: conflictCount,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSyncError(message);
      reportNotice(message, 'error');
      throw err;
    } finally {
      isSyncing = false;
      notifyStatus();
      if (queuedSync) {
        queuedSync = false;
        void performSync('queued');
      }
    }
  }

  function scheduleAutoSync() {
    if (!syncState.autoSync) return;
    if (!readToken()) return;
    if (autoSyncTimer) clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(() => {
      autoSyncTimer = 0;
      void performSync('auto');
    }, AUTO_SYNC_DEBOUNCE_MS);
  }

  function notifyLocalMutation() {
    scheduleAutoSync();
  }

  function bindUi(elements = {}) {
    const {
      connectBtn,
      disconnectBtn,
      syncNowBtn,
      autoSyncToggle,
      statusEl,
      folderPathEl,
      lastSyncEl,
      errorEl,
    } = elements;

    const render = (status) => {
      if (statusEl) statusEl.textContent = status.status;
      if (folderPathEl) folderPathEl.textContent = status.folderPath;
      if (lastSyncEl) lastSyncEl.textContent = status.lastSyncLabel;
      if (errorEl) {
        errorEl.textContent = status.error || '';
        errorEl.hidden = !status.error;
      }
      if (connectBtn) {
        connectBtn.disabled = !status.configured || status.connected || status.syncing;
      }
      if (disconnectBtn) {
        disconnectBtn.disabled = !status.connected || status.syncing;
      }
      if (syncNowBtn) {
        syncNowBtn.disabled = !status.connected || status.syncing;
      }
      if (autoSyncToggle) {
        autoSyncToggle.checked = !!status.autoSync;
        autoSyncToggle.disabled = !status.connected;
      }
    };

    const unsubscribe = subscribe(render);

    if (connectBtn) {
      connectBtn.addEventListener('click', (event) => {
        event.preventDefault();
        void startAuth().catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          setSyncError(message);
          reportNotice(message, 'error');
        });
      });
    }

    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', (event) => {
        event.preventDefault();
        disconnect();
      });
    }

    if (syncNowBtn) {
      syncNowBtn.addEventListener('click', (event) => {
        event.preventDefault();
        void performSync('manual').catch(() => {});
      });
    }

    if (autoSyncToggle) {
      autoSyncToggle.addEventListener('change', () => {
        setAutoSync(!!autoSyncToggle.checked);
      });
    }

    return unsubscribe;
  }

  function init() {
    consumeAuthResult();
    notifyStatus();
  }

  return {
    init,
    bindUi,
    subscribe,
    getStatus,
    startAuth,
    disconnect,
    setAutoSync,
    syncNow: () => performSync('manual'),
    notifyLocalMutation,
    isConfigured: () => !!config.appKey,
    isConnected: () => !!readToken(),
    getFolderPath: () => config.folderPath,
  };
}

export async function completeDropboxAuthRedirectOnCallbackPage(options = {}) {
  if (!canUseDom()) return { handled: false };

  const params = new URLSearchParams(window.location.search || '');
  if (!params.has('code') && !params.has('error')) {
    return { handled: false };
  }

  const returnedState = params.get('state') || '';
  const sessionStorageRef = safeGetStorage('session');
  const localStorageRef = safeGetStorage('local');
  const prefix = findPkcePrefixByState(sessionStorageRef, returnedState);
  const keyPrefix = prefix || (typeof options.storageKey === 'string' ? options.storageKey : 'typewriter');
  const keys = buildStorageKeys(keyPrefix);
  const appKey = resolveConfiguredAppKey(options.appKey);

  const redirectUri = (typeof options.redirectUri === 'string' && options.redirectUri.trim())
    ? options.redirectUri.trim()
    : resolveDefaultRedirectUri();

  const homeUri = (typeof options.homeUri === 'string' && options.homeUri.trim())
    ? options.homeUri.trim()
    : resolveDefaultHomeUri();

  const storeAuthResult = (payload) => {
    safeSetItem(localStorageRef, keys.authResultKey, JSON.stringify(payload));
  };

  const cleanupPkce = () => {
    safeRemoveItem(sessionStorageRef, keys.pkceStateKey);
    safeRemoveItem(sessionStorageRef, keys.pkceVerifierKey);
  };

  try {
    if (!appKey) {
      throw new Error('Dropbox app key is not configured.');
    }

    if (params.has('error')) {
      const detail = params.get('error_description') || params.get('error') || 'authorization_failed';
      throw new Error(`Dropbox authorization failed: ${detail}`);
    }

    const code = params.get('code');
    if (!code) {
      throw new Error('Missing Dropbox authorization code.');
    }

    const expectedState = safeGetItem(sessionStorageRef, keys.pkceStateKey);
    if (!expectedState || expectedState !== returnedState) {
      throw new Error('Dropbox sign-in could not be verified. Please connect again.');
    }

    const verifier = safeGetItem(sessionStorageRef, keys.pkceVerifierKey);
    if (!verifier) {
      throw new Error('Dropbox PKCE verifier is missing. Please connect again.');
    }

    const tokenPayload = await postTokenForm({
      grant_type: 'authorization_code',
      code,
      client_id: appKey,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });

    const normalized = normalizeTokenPayload(tokenPayload);
    safeSetItem(localStorageRef, keys.tokenKey, JSON.stringify(normalized));
    cleanupPkce();
    storeAuthResult({ ok: true, at: Date.now() });

    if (homeUri) {
      window.location.replace(homeUri);
      return { handled: true, redirected: true, ok: true };
    }

    return { handled: true, redirected: false, ok: true };
  } catch (err) {
    cleanupPkce();
    const message = err instanceof Error ? err.message : String(err);
    storeAuthResult({ ok: false, at: Date.now(), error: message });
    if (homeUri) {
      window.location.replace(homeUri);
      return { handled: true, redirected: true, ok: false, error: message };
    }
    return { handled: true, redirected: false, ok: false, error: message };
  }
}

export {
  DROPBOX_APP_FOLDER_PATH,
  DROPBOX_SETTINGS_PATH,
  DROPBOX_DOCUMENTS_DIR,
};
