export function ensureSaveRevisionState(state) {
  if (!state || typeof state !== 'object') {
    return { revision: 0, lastRevision: 0 };
  }
  if (!Number.isInteger(state.saveRevision)) {
    state.saveRevision = 0;
  }
  if (!Number.isInteger(state.lastSavedRevision)) {
    state.lastSavedRevision = state.saveRevision;
  }
  return {
    revision: state.saveRevision,
    lastRevision: state.lastSavedRevision,
  };
}

export function ensurePageRevisionState(page) {
  if (!page || typeof page !== 'object') {
    return { revision: 0, lastRevision: 0 };
  }
  if (!Number.isInteger(page.contentRevision)) {
    page.contentRevision = 0;
  }
  if (!Number.isInteger(page.lastSavedContentRevision)) {
    page.lastSavedContentRevision = page.contentRevision;
  }
  return {
    revision: page.contentRevision,
    lastRevision: page.lastSavedContentRevision,
  };
}

export function markPageContentDirty(page) {
  const info = ensurePageRevisionState(page);
  const next = info.revision + 1;
  page.contentRevision = next;
  return next;
}

export function hasPendingPageChanges(page) {
  const info = ensurePageRevisionState(page);
  return info.revision !== info.lastRevision;
}

export function getDirtyPageIndices(state) {
  const pages = Array.isArray(state?.pages) ? state.pages : [];
  const out = [];
  for (let i = 0; i < pages.length; i += 1) {
    if (hasPendingPageChanges(pages[i])) {
      out.push(i);
    }
  }
  return out;
}

export function syncSavedPageRevisions(state, pageIndices = null) {
  const pages = Array.isArray(state?.pages) ? state.pages : [];
  const targets = Array.isArray(pageIndices)
    ? pageIndices
    : pages.map((_, index) => index);
  let synced = 0;
  for (const index of targets) {
    if (!Number.isInteger(index) || index < 0 || index >= pages.length) continue;
    const page = pages[index];
    if (!page || typeof page !== 'object') continue;
    const info = ensurePageRevisionState(page);
    page.lastSavedContentRevision = info.revision;
    synced += 1;
  }
  return synced;
}

export function markDocumentDirty(state) {
  const info = ensureSaveRevisionState(state);
  const next = info.revision + 1;
  state.saveRevision = next;
  return next;
}

export function hasPendingDocumentChanges(state) {
  const info = ensureSaveRevisionState(state);
  return info.revision !== info.lastRevision;
}

export function syncSavedRevision(state) {
  const info = ensureSaveRevisionState(state);
  state.lastSavedRevision = state.saveRevision;
  return info.revision;
}
