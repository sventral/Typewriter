export {
  DEFAULT_DOCUMENT_TITLE,
  normalizeDocumentTitle,
  serializeDocumentState,
  deserializeDocumentState,
  generateDocumentId,
  createDocumentRecord,
  METADATA_VERSION,
  encodeDocumentDataForStorage,
  decodeDocumentDataFromStorage,
} from './documentSchema.js';

export {
  loadDocumentIndexFromStorage,
  migrateLegacyDocument,
  loadDocumentDataById,
  persistDocuments,
} from './documentPersistence.js';

export {
  estimateDocumentDataBytes,
  estimateStoredBytes,
} from './documentSizing.js';
