import { encodeDocumentDataForStorage } from './documentSchema.js';
import { estimatePayloadBytes } from '../storage/documentBlobStore.js';

export function estimateStoredBytes(value) {
  return estimatePayloadBytes(value);
}

export function estimateDocumentDataBytes(data, options = {}) {
  const encoded = encodeDocumentDataForStorage(data, options);
  return estimateStoredBytes(encoded);
}
