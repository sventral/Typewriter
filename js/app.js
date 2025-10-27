import { initApp } from './app/initApp.js';

function start() {
  initApp();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
