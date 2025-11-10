#!/usr/bin/env node
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
};

const sendError = (res, code, message) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(message);
};

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendError(res, 400, 'Bad Request');
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  let filePath;
  try {
    const decodedPath = decodeURIComponent(requestUrl.pathname || '/');
    const resolvedPath = path.resolve(ROOT, `.${decodedPath}`);
    const relative = path.relative(ROOT, resolvedPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      sendError(res, 403, 'Forbidden');
      return;
    }
    filePath = resolvedPath;
  } catch {
    sendError(res, 400, 'Bad Request');
    return;
  }

  try {
    let fileStats = await stat(filePath);
    if (fileStats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      fileStats = await stat(filePath);
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileStats.size);

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = createReadStream(filePath);
    stream.on('error', () => {
      sendError(res, 500, 'Internal Server Error');
    });
    stream.pipe(res);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      sendError(res, 404, 'Not Found');
    } else {
      sendError(res, 500, 'Internal Server Error');
    }
  }
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT} on http://localhost:${PORT}`);
});
