import * as D from './dom.js';
import { state, effectiveDark } from './state.js';

export function serializeDoc() {
    return {
        v: 4,
        marginL: state.marginL,
        marginR: state.marginR,
        lineLeft: state.lineLeft,
        lines: state.lines.map(line => line.map(cell => cell.map(s => ({ ch: s.ch, col: s.col })))),
        caret: { row: state.row, col: state.col },
        ink: state.ink,
        themeOverride: state.themeOverride,
        showStops: state.showStops,
        docPolarity: state.docPolarity,
        pageMargins: state.pageMargins,
        defaultMarginTop: state.defaultMarginTop,
        defaultMarginBottom: state.defaultMarginBottom
    };
}

export function deserializeDoc(obj) {
    if (!obj || typeof obj !== 'object' || obj.v !== 4) return false;
    state.marginL = Number.isFinite(obj.marginL) ? obj.marginL : state.marginL;
    state.marginR = Number.isFinite(obj.marginR) ? obj.marginR : state.marginR;
    state.lineLeft = Array.isArray(obj.lineLeft) ? obj.lineLeft.slice() : [state.marginL];
    if (Array.isArray(obj.lines)) {
        state.lines = obj.lines.map(line => Array.isArray(line) ? line.map(cell => Array.isArray(cell) ? cell.map(s => ({ ch: String(s.ch || '')[0] || ' ', col: (s.col === 'w' || s.col === 'r') ? s.col : 'b' })) : []) : []);
    } else {
        state.lines = [[]];
    }
    if (obj.caret && Number.isInteger(obj.caret.row) && Number.isInteger(obj.caret.col)) {
        state.row = Math.max(0, Math.min(obj.caret.row, state.lines.length - 1));
        state.col = Math.max(0, Math.min(obj.caret.col, (state.lines[state.row] || []).length));
    } else {
        state.row = state.lines.length - 1;
        state.col = (state.lines[state.row] || []).length;
    }
    state.ink = (obj.ink === 'w' || obj.ink === 'r') ? obj.ink : 'b';
    state.themeOverride = (obj.themeOverride === 'dark' || obj.themeOverride === 'light') ? obj.themeOverride : 'auto';
    state.showStops = (typeof obj.showStops === 'boolean') ? obj.showStops : loadStopsPref();
    state.docPolarity = (typeof obj.docPolarity === 'boolean') ? obj.docPolarity : effectiveDark();
    state.pageMargins = Array.isArray(obj.pageMargins) ? obj.pageMargins : [{ top: 40, bottom: 40 }];
    state.defaultMarginTop = Number.isFinite(obj.defaultMarginTop) ? obj.defaultMarginTop : 40;
    state.defaultMarginBottom = Number.isFinite(obj.defaultMarginBottom) ? obj.defaultMarginBottom : 40;
    return true;
}

export function getDocIndex() {
    try {
        return JSON.parse(localStorage.getItem('typewriter.docs.index.v1')) || [];
    } catch {
        return [];
    }
}

export function saveDocIndex(index) {
    try {
        localStorage.setItem('typewriter.docs.index.v1', JSON.stringify(index));
    } catch (e) {
        console.warn('Failed to save doc index:', e);
    }
}

export function saveCurrentDoc() {
    if (!state.currentDocId) return;
    try {
        localStorage.setItem('typewriter.doc.v4.' + state.currentDocId, JSON.stringify(serializeDoc()));
        localStorage.setItem('typewriter.last_doc.v1', state.currentDocId);
        const index = getDocIndex();
        const docEntry = index.find(d => d.id === state.currentDocId);
        const title = D.docTitleInput.value.trim() || (state.lines[0] || []).map(c => c[c.length - 1].ch).join('').substring(0, 40) || 'Untitled';
        if (docEntry) {
            docEntry.title = title;
            docEntry.modified = Date.now();
        } else {
            index.unshift({ id: state.currentDocId, title: title, created: Date.now(), modified: Date.now() });
        }
        saveDocIndex(index);
    } catch (e) {
        console.warn('Save failed:', e);
    }
}

export function saveStopsPref(v) {
    try {
        localStorage.setItem('typewriter.showStops.v1', v ? '1' : '0');
    } catch {}
}

export function loadStopsPref() {
    try {
        return localStorage.getItem('typewriter.showStops.v1') === '1';
    } catch {
        return false;
    }
}