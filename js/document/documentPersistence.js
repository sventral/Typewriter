import {
  createDocumentRecord,
  decodeDocumentDataFromStorage,
  encodeDocumentDataForStorage,
  generateDocumentId,
  METADATA_VERSION,
  normalizeDocumentTitle,
} from './documentSchema.js';
import { estimateStoredBytes } from './documentSizing.js';
import {
  saveDocumentPayload,
  readDocumentPayload,
  pruneDocumentPayloads,
} from '../storage/documentBlobStore.js';

function getDocumentsKey(storageKey) {
  return `${storageKey}::documents.v1`;
}

function resolveStorage(options) {
  if (options && options.localStorage) return options.localStorage;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return null;
}

async function hydrateDocumentsFromBlobStore(documents, idsToHydrate) {
  if (!Array.isArray(documents) || !documents.length) return;
  const targetIds = Array.isArray(idsToHydrate) ? idsToHydrate.filter(Boolean) : [];
  if (!targetIds.length) return;
  const docMap = new Map(documents.map((doc) => [doc.id, doc]));
  await Promise.all(targetIds.map(async (id) => {
    const doc = docMap.get(id);
    if (!doc || doc.data) return;
    try {
      const payload = await readDocumentPayload(id);
      if (!payload) return;
      doc.data = decodeDocumentDataFromStorage(payload);
    } catch (err) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('Typewriter: Failed to read stored document payload', err);
      }
    }
  }));
}

function normalizeDocumentEntry(base, seen) {
  const decodedData = decodeDocumentDataFromStorage(base.data);
  const record = createDocumentRecord({
    id: base.id,
    title: base.title,
    data: decodedData,
    createdAt: Number(base.createdAt),
    updatedAt: Number(base.updatedAt),
  }, seen);
  const dataSize = Number.isFinite(base.dataSize) ? base.dataSize : estimateStoredBytes(base.data);
  if (dataSize) {
    record.dataSize = dataSize;
  }
  return record;
}

export async function loadDocumentIndexFromStorage(storageKey, options = {}) {
  const storage = resolveStorage(options);
  const documents = [];
  const seen = new Set();
  let activeId = null;
  let parsed = null;
  if (storage) {
    try {
      parsed = JSON.parse(storage.getItem(getDocumentsKey(storageKey)));
    } catch {
      parsed = null;
    }
  }
  const docEntries = parsed && Array.isArray(parsed.documents) ? parsed.documents : [];
  docEntries.forEach((entry) => {
    const base = entry && typeof entry === 'object' ? entry : {};
    const record = normalizeDocumentEntry(base, seen);
    documents.push(record);
  });
  if (parsed && typeof parsed.activeId === 'string' && parsed.activeId.trim()) {
    activeId = parsed.activeId.trim();
  }
  if (activeId && !documents.some((doc) => doc.id === activeId)) {
    activeId = null;
  }
  if (!activeId && documents.length) {
    activeId = documents[0].id;
  }
  const hydrateMode = options && options.hydrateAll ? 'all' : 'active';
  const idsToHydrate = hydrateMode === 'all'
    ? documents.map((d) => d.id)
    : (activeId ? [activeId] : []);
  await hydrateDocumentsFromBlobStore(documents, idsToHydrate);
  return { documents, activeId };
}

export function migrateLegacyDocument(storageKey, options = {}) {
  const storage = resolveStorage(options);
  if (!storage) return null;
  let raw = null;
  try {
    raw = JSON.parse(storage.getItem(storageKey));
  } catch {}
  if (!raw || typeof raw !== 'object') return null;
  const migrated = createDocumentRecord({
    id: generateDocumentId(),
    title: typeof raw.documentTitle === 'string' ? raw.documentTitle : normalizeDocumentTitle(),
    data: raw,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  try {
    storage.removeItem(storageKey);
  } catch {}
  return migrated;
}

export async function loadDocumentDataById(docId) {
  if (!docId) return null;
  try {
    const payload = await readDocumentPayload(docId);
    return decodeDocumentDataFromStorage(payload);
  } catch {
    return null;
  }
}

export async function persistDocuments(storageKey, docState, options = {}) {
  const storage = resolveStorage(options);
  const documents = Array.isArray(docState?.documents) ? docState.documents : [];
  const keepIds = new Set();
  const payloadDocs = [];
  const blobWrites = [];
  documents.forEach((doc) => {
    if (!doc || typeof doc !== 'object') return;
    const revision = Number.isInteger(doc.lastSavedRevision)
      ? doc.lastSavedRevision
      : (Number.isInteger(doc.revision) ? doc.revision : null);
    const persistedRevision = Number.isInteger(doc.lastPersistedRevision) ? doc.lastPersistedRevision : null;
    const needsPersist = doc.data && (revision == null || revision !== persistedRevision);

    let encoded = null;
    let size = Number(doc.dataSize) || 0;

    if (needsPersist) {
      encoded = encodeDocumentDataForStorage(doc.data);
      size = encoded ? estimateStoredBytes(encoded) : size;
      if (doc.id && encoded) {
        blobWrites.push(saveDocumentPayload(doc.id, encoded));
        doc.lastPersistedRevision = revision;
      }
    }

    if (doc.id) {
      keepIds.add(doc.id);
    }
    payloadDocs.push({
      id: doc.id,
      title: doc.title,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      dataSize: size || 0,
      hasData: (!!encoded) || !!doc.dataSize,
    });
    // Preserve cached size metadata even when skipping compression for unchanged docs.
    if (!needsPersist && size && !doc.dataSize) {
      doc.dataSize = size;
    } else if (needsPersist) {
      doc.dataSize = size;
    }
  });
  const payload = {
    version: METADATA_VERSION,
    activeId: docState?.activeId || null,
    documents: payloadDocs,
  };
  if (storage && !options.skipMetadataWrite) {
    try {
      storage.setItem(getDocumentsKey(storageKey), JSON.stringify(payload));
      storage.removeItem(storageKey);
    } catch (err) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('Typewriter: Failed to persist document metadata – storage quota may be exhausted.', err);
      }
      if (options.onSaveError) {
        options.onSaveError(err);
      }
    }
  }
  try {
    await Promise.all(blobWrites);
  } catch (err) {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('Typewriter: Failed to persist document payloads', err);
    }
    if (options.onSaveError) {
      options.onSaveError(err);
    }
  }
  if (keepIds.size || documents.length === 0) {
    try {
      await pruneDocumentPayloads(keepIds);
    } catch (err) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('Typewriter: Failed to prune stale document payloads', err);
      }
    }
  }
}
