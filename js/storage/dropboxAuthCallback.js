import { completeDropboxAuthRedirectOnCallbackPage } from './dropboxSync.js';

function setStatus(message, isError = false) {
  const statusEl = document.getElementById('dropboxAuthStatus');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle('dropbox-auth-status--error', !!isError);
}

async function run() {
  setStatus('Connecting to Dropbox...');

  try {
    const result = await completeDropboxAuthRedirectOnCallbackPage();
    if (!result.handled) {
      setStatus('No Dropbox authorization response found.', true);
      return;
    }
    if (result.redirected) {
      setStatus(result.ok ? 'Connected. Returning to TypeSim...' : 'Authorization failed. Returning to TypeSim...', !result.ok);
      return;
    }
    if (result.ok) {
      setStatus('Dropbox connected. You can close this tab.');
    } else {
      setStatus(result.error || 'Dropbox authorization failed.', true);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(message || 'Dropbox authorization failed.', true);
  }
}

void run();
