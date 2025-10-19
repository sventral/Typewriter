import * as D from './dom.js';
import { state, effectiveDark, swapInksInDocument } from './state.js';
import { positionRuler } from './ruler.js';
import { getDocIndex, saveCurrentDoc, saveStopsPref } from './storage.js';
import { loadDoc, setThemeOverride } from './document.js';

export function setInk(c) {
    state.ink = c;
    D.inkBlackBtn.dataset.active = String(c === 'b');
    D.inkRedBtn.dataset.active = String(c === 'r');
    D.inkWhiteBtn.dataset.active = String(c === 'w');
}

export function applyThemeSideEffects() {
    const effDark = effectiveDark();
    if (effDark !== state.docPolarity) {
        swapInksInDocument();
        state.docPolarity = effDark;
    }
    setInk(effDark ? 'w' : 'b');
}

export function updateThemeButton() {
    D.themeToggle.textContent = effectiveDark() ? 'Light' : 'Dark';
}

export function applyStopsVisibility() {
    const display = state.showStops ? 'block' : 'none';
    D.rulerH_host.style.display = display;
    D.rulerV_host.style.display = display;
    if (state.showStops) positionRuler();
    saveStopsPref(state.showStops);
}

export function updateDocsList() {
    const index = getDocIndex();
    D.docsList.innerHTML = '';
    if (index.length === 0) {
        const item = document.createElement('button');
        item.textContent = 'No saved documents';
        item.disabled = true;
        D.docsList.appendChild(item);
        return;
    }
    index.forEach(doc => {
        const item = document.createElement('button');
        item.textContent = doc.title;
        item.dataset.id = doc.id;
        item.onclick = () => {
            if (doc.id !== state.currentDocId) {
                saveCurrentDoc();
                loadDoc(doc.id);
            }
            D.docsList.classList.remove('show');
        };
        D.docsList.appendChild(item);
    });
}

export function initUIHandlers() {
    D.inkBlackBtn.onclick = () => setInk('b');
    D.inkRedBtn.onclick = () => setInk('r');
    D.inkWhiteBtn.onclick = () => setInk('w');

    D.themeToggle.addEventListener('click', () => setThemeOverride(effectiveDark() ? 'light' : 'dark'));

    D.toggleStopsBtn.addEventListener('click', () => {
        state.showStops = !state.showStops;
        applyStopsVisibility();
        saveCurrentDoc();
        D.shim.focus();
    });

    D.docTitleInput.addEventListener('input', () => {
        saveCurrentDoc();
        updateDocsList();
    });

    D.docsMenuBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        D.docsList.classList.toggle('show');
    });

    window.addEventListener('click', (event) => {
        if (!D.docsMenuBtn.contains(event.target) && !D.docsList.contains(event.target)) {
            if (D.docsList.classList.contains('show')) {
                D.docsList.classList.remove('show');
            }
        }
    });
}