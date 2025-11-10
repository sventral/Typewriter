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
