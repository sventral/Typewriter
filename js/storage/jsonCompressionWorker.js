import { compressString } from './jsonCompressionCodec.js';

self.addEventListener('message', (event) => {
  const message = event?.data;
  const id = Number.isInteger(message?.id) ? message.id : null;
  if (id == null) return;
  try {
    const raw = typeof message.raw === 'string' ? message.raw : '';
    const payload = compressString(raw);
    self.postMessage({ id, payload });
  } catch (err) {
    self.postMessage({
      id,
      error: err instanceof Error ? (err.message || err.name) : 'Compression failed',
    });
  }
});
