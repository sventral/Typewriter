const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = (() => {
  const table = Object.create(null);
  for (let i = 0; i < BASE64_CHARS.length; i += 1) {
    table[BASE64_CHARS[i]] = i;
  }
  return table;
})();

const sharedTextEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const sharedTextDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

function encodeUtf8(str) {
  if (sharedTextEncoder) {
    return sharedTextEncoder.encode(str);
  }
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(str, 'utf8'));
  }
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) {
    out[i] = str.charCodeAt(i) & 0xFF;
  }
  return out;
}

function decodeUtf8(bytes) {
  if (sharedTextDecoder) {
    return sharedTextDecoder.decode(bytes);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('utf8');
  }
  let result = '';
  for (let i = 0; i < bytes.length; i += 1) {
    result += String.fromCharCode(bytes[i]);
  }
  return result;
}

function lzwCompressBytes(bytes) {
  if (!bytes || !bytes.length) {
    return new Uint32Array(0);
  }
  const dict = new Map();
  for (let i = 0; i < 256; i += 1) {
    dict.set(String.fromCharCode(i), i);
  }
  let dictSize = 256;
  let w = '';
  const codes = [];
  for (let i = 0; i < bytes.length; i += 1) {
    const c = String.fromCharCode(bytes[i]);
    const wc = w + c;
    if (dict.has(wc)) {
      w = wc;
    } else {
      if (w) {
        codes.push(dict.get(w));
      }
      dict.set(wc, dictSize++);
      w = c;
    }
  }
  if (w) {
    codes.push(dict.get(w));
  }
  return Uint32Array.from(codes);
}

function lzwDecompressToBytes(codes) {
  if (!codes || !codes.length) {
    return new Uint8Array(0);
  }
  const dict = [];
  for (let i = 0; i < 256; i += 1) {
    dict[i] = String.fromCharCode(i);
  }
  let dictSize = 256;
  const firstCode = codes[0];
  if (typeof firstCode !== 'number' || firstCode < 0 || firstCode >= dictSize) {
    return new Uint8Array(0);
  }
  let w = dict[firstCode];
  const segments = [w];
  for (let i = 1; i < codes.length; i += 1) {
    const k = codes[i];
    let entry;
    if (k < dictSize && dict[k] !== undefined) {
      entry = dict[k];
    } else if (k === dictSize && w) {
      entry = w + w.charAt(0);
    } else {
      entry = '';
    }
    if (!entry) {
      continue;
    }
    segments.push(entry);
    const lead = entry.charAt(0);
    dict[dictSize] = w + lead;
    dictSize += 1;
    w = entry;
  }
  const byteString = segments.join('');
  const out = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i += 1) {
    out[i] = byteString.charCodeAt(i) & 0xFF;
  }
  return out;
}

function base64Encode(bytes) {
  if (!bytes || !bytes.length) {
    return '';
  }
  let output = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    output += BASE64_CHARS[(chunk >> 18) & 63];
    output += BASE64_CHARS[(chunk >> 12) & 63];
    output += BASE64_CHARS[(chunk >> 6) & 63];
    output += BASE64_CHARS[chunk & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const chunk = bytes[i] << 16;
    output += BASE64_CHARS[(chunk >> 18) & 63];
    output += BASE64_CHARS[(chunk >> 12) & 63];
    output += '==';
  } else if (remaining === 2) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8);
    output += BASE64_CHARS[(chunk >> 18) & 63];
    output += BASE64_CHARS[(chunk >> 12) & 63];
    output += BASE64_CHARS[(chunk >> 6) & 63];
    output += '=';
  }
  return output;
}

function base64Decode(str) {
  if (!str || typeof str !== 'string') {
    return new Uint8Array(0);
  }
  const clean = str.replace(/[^A-Za-z0-9+/=]/g, '');
  const output = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch === '=') {
      break;
    }
    const val = BASE64_LOOKUP[ch];
    if (val == null) {
      continue;
    }
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xFF);
      buffer &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(output);
}

function uint32ArrayToBase64(array) {
  if (!array || !array.length) {
    return '';
  }
  const bytes = new Uint8Array(array.length * 4);
  for (let i = 0; i < array.length; i += 1) {
    const val = array[i] >>> 0;
    const offset = i * 4;
    bytes[offset] = val & 0xFF;
    bytes[offset + 1] = (val >>> 8) & 0xFF;
    bytes[offset + 2] = (val >>> 16) & 0xFF;
    bytes[offset + 3] = (val >>> 24) & 0xFF;
  }
  return base64Encode(bytes);
}

function base64ToUint32Array(str) {
  const bytes = base64Decode(str);
  if (!bytes.length || bytes.length % 4 !== 0) {
    return new Uint32Array(0);
  }
  const array = new Uint32Array(bytes.length / 4);
  for (let i = 0; i < array.length; i += 1) {
    const offset = i * 4;
    array[i] =
      bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24);
  }
  return array;
}

export function compressString(input) {
  const bytes = encodeUtf8(input);
  const codes = lzwCompressBytes(bytes);
  return uint32ArrayToBase64(codes);
}

export function decompressString(payload) {
  const codes = base64ToUint32Array(payload);
  const bytes = lzwDecompressToBytes(codes);
  return decodeUtf8(bytes);
}
