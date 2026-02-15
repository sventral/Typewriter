const DROPBOX_AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const DROPBOX_UPLOAD_URL = 'https://content.dropboxapi.com/2/files/upload';
const DROPBOX_DOWNLOAD_URL = 'https://content.dropboxapi.com/2/files/download';
const DROPBOX_DEFAULT_BACKUP_PATH = '/typewriter-backup.json';
const OAUTH_EXPIRY_SKEW_MS = 60 * 1000;

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

function readMetaContent(name) {
  if (!canUseDom()) return '';
  const el = document.querySelector(`meta[name="${name}"]`);
  const value = el?.getAttribute('content');
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePath(path) {
  if (typeof path !== 'string' || !path.trim()) {
    return DROPBOX_DEFAULT_BACKUP_PATH;
  }
  const trimmed = path.trim();
  if (trimmed.startsWith('/')) return trimmed;
  return `/${trimmed}`;
}

function resolveConfig({ appKey, backupPath, redirectUri } = {}) {
  const resolvedAppKey = (typeof appKey === 'string' && appKey.trim())
    ? appKey.trim()
    : ((canUseDom() && typeof window.TYPEWRITER_DROPBOX_APP_KEY === 'string' && window.TYPEWRITER_DROPBOX_APP_KEY.trim())
      ? window.TYPEWRITER_DROPBOX_APP_KEY.trim()
      : readMetaContent('typewriter-dropbox-app-key'));

  const resolvedBackupPath = normalizePath(
    (typeof backupPath === 'string' && backupPath.trim())
      ? backupPath
      : ((canUseDom() && typeof window.TYPEWRITER_DROPBOX_BACKUP_PATH === 'string' && window.TYPEWRITER_DROPBOX_BACKUP_PATH.trim())
        ? window.TYPEWRITER_DROPBOX_BACKUP_PATH
        : readMetaContent('typewriter-dropbox-backup-path')),
  );

  const resolvedRedirectUri = (typeof redirectUri === 'string' && redirectUri.trim())
    ? redirectUri.trim()
    : (canUseDom() ? `${window.location.origin}${window.location.pathname}` : '');

  return {
    appKey: resolvedAppKey,
    backupPath: resolvedBackupPath,
    redirectUri: resolvedRedirectUri,
  };
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

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function clearAuthParamsFromLocation(params) {
  if (!canUseDom()) return;
  const nextParams = new URLSearchParams(params.toString());
  nextParams.delete('code');
  nextParams.delete('state');
  nextParams.delete('error');
  nextParams.delete('error_description');
  const query = nextParams.toString();
  const hash = window.location.hash || '';
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${hash}`;
  try {
    window.history.replaceState({}, document.title, nextUrl);
  } catch {}
}

async function postTokenForm(params) {
  const response = await fetch(DROPBOX_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const detail = payload?.error_description || payload?.error_summary || payload?.error || response.statusText;
    throw new Error(`Dropbox token request failed: ${detail}`);
  }
  return payload;
}

function buildContentApiErrorMessage(baseMessage, response, payload) {
  if (response.status === 409) {
    return `${baseMessage}: backup file not found at the configured Dropbox path.`;
  }
  const detail = payload?.error_summary || payload?.error || payload?.raw || response.statusText;
  return `${baseMessage}: ${detail}`;
}

export function createDropboxSyncClient(options = {}) {
  const config = resolveConfig(options);
  const keyPrefix = typeof options.storageKey === 'string' && options.storageKey.trim()
    ? options.storageKey.trim()
    : 'typewriter';
  const tokenStorage = safeGetStorage('local');
  const sessionStorage = safeGetStorage('session');
  const TOKEN_KEY = `${keyPrefix}::dropbox.oauth.v1`;
  const PKCE_VERIFIER_KEY = `${keyPrefix}::dropbox.pkce.verifier.v1`;
  const PKCE_STATE_KEY = `${keyPrefix}::dropbox.pkce.state.v1`;

  const readToken = () => parseTokenRecord(safeGetItem(tokenStorage, TOKEN_KEY));
  const writeToken = (token) => safeSetItem(tokenStorage, TOKEN_KEY, JSON.stringify(token));
  const clearToken = () => safeRemoveItem(tokenStorage, TOKEN_KEY);

  const clearPkce = () => {
    safeRemoveItem(sessionStorage, PKCE_VERIFIER_KEY);
    safeRemoveItem(sessionStorage, PKCE_STATE_KEY);
  };

  async function refreshTokenIfNeeded() {
    const current = readToken();
    if (!current) throw new Error('Dropbox is not connected.');
    if (!isTokenExpired(current)) return current.accessToken;
    if (!current.refreshToken) {
      clearToken();
      throw new Error('Dropbox session expired. Please connect again.');
    }
    const refreshed = await postTokenForm({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: config.appKey,
    });
    const normalized = normalizeTokenPayload(refreshed, current);
    writeToken(normalized);
    return normalized.accessToken;
  }

  async function getAccessToken() {
    if (!config.appKey) {
      throw new Error('Dropbox is not configured for this site.');
    }
    const token = readToken();
    if (!token) {
      throw new Error('Dropbox is not connected.');
    }
    return refreshTokenIfNeeded();
  }

  async function startAuth() {
    if (!config.appKey) {
      throw new Error('Dropbox is not configured. Add a Dropbox app key first.');
    }
    if (!config.redirectUri) {
      throw new Error('Dropbox redirect URI could not be determined.');
    }

    const state = bytesToBase64Url(randomBytes(16));
    const verifier = bytesToBase64Url(randomBytes(64));
    const challenge = await createCodeChallenge(verifier);
    safeSetItem(sessionStorage, PKCE_STATE_KEY, state);
    safeSetItem(sessionStorage, PKCE_VERIFIER_KEY, verifier);

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

  async function completeAuthRedirectIfPresent() {
    if (!canUseDom()) return { handled: false, connected: false };
    const params = new URLSearchParams(window.location.search);
    const hasOAuthParams = params.has('code') || params.has('error');
    if (!hasOAuthParams) return { handled: false, connected: !!readToken() };

    const expectedState = safeGetItem(sessionStorage, PKCE_STATE_KEY);
    const verifier = safeGetItem(sessionStorage, PKCE_VERIFIER_KEY);
    const returnedState = params.get('state') || '';
    const stateMatched = !!expectedState && expectedState === returnedState;

    if (!stateMatched) {
      clearPkce();
      clearAuthParamsFromLocation(params);
      throw new Error('Dropbox sign-in could not be verified. Please try connecting again.');
    }

    if (params.has('error')) {
      const code = params.get('error') || 'access_denied';
      const description = params.get('error_description') || code;
      clearPkce();
      clearAuthParamsFromLocation(params);
      throw new Error(`Dropbox authorization failed: ${description}`);
    }

    const code = params.get('code');
    if (!code || !verifier) {
      clearPkce();
      clearAuthParamsFromLocation(params);
      throw new Error('Dropbox authorization response is incomplete. Please reconnect.');
    }

    if (!config.appKey) {
      clearPkce();
      clearAuthParamsFromLocation(params);
      throw new Error('Dropbox app key is not configured for this site.');
    }

    let payload;
    try {
      payload = await postTokenForm({
        grant_type: 'authorization_code',
        code,
        client_id: config.appKey,
        code_verifier: verifier,
        redirect_uri: config.redirectUri,
      });
    } catch (err) {
      clearPkce();
      clearAuthParamsFromLocation(params);
      throw err;
    }
    const normalized = normalizeTokenPayload(payload);
    writeToken(normalized);
    clearPkce();
    clearAuthParamsFromLocation(params);
    return { handled: true, connected: true };
  }

  async function uploadJson(payload) {
    const accessToken = await getAccessToken();
    const response = await fetch(DROPBOX_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: config.backupPath,
          mode: 'overwrite',
          autorename: false,
          mute: true,
          strict_conflict: false,
        }),
      },
      body: JSON.stringify(payload, null, 2),
    });
    const body = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(buildContentApiErrorMessage('Dropbox upload failed', response, body));
    }
    return body;
  }

  async function downloadJson() {
    const accessToken = await getAccessToken();
    const response = await fetch(DROPBOX_DOWNLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path: config.backupPath }),
      },
    });
    if (!response.ok) {
      const body = await readJsonResponse(response);
      throw new Error(buildContentApiErrorMessage('Dropbox download failed', response, body));
    }
    const raw = await response.text();
    if (!raw) {
      throw new Error('Dropbox backup file is empty.');
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('Dropbox backup file is not valid JSON.');
    }
  }

  function disconnect() {
    clearPkce();
    clearToken();
  }

  return {
    isConfigured: () => !!config.appKey,
    isConnected: () => !!readToken(),
    getBackupPath: () => config.backupPath,
    startAuth,
    completeAuthRedirectIfPresent,
    uploadJson,
    downloadJson,
    disconnect,
  };
}

export { DROPBOX_DEFAULT_BACKUP_PATH };
