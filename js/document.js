import * as D from './dom.js';
import { state, effectiveDark, restartBlink } from './state.js';
import { render, centerCaret, afterLayout } from './renderer.js';
import { positionRuler } from './ruler.js';
import { deserializeDoc, getDocIndex, saveCurrentDoc as storageSave, saveDocIndex, loadStopsPref } from './storage.js';
import { applyStopsVisibility, updateThemeButton, applyThemeSideEffects, updateDocsList, setInk } from './ui.js';
import { resetShim } from './inputHandler.js';

export function loadDoc(docId) {
    try {
        const j = localStorage.getItem('typewriter.doc.v4.' + docId);
        if (j && deserializeDoc(JSON.parse(j))) {
            state.currentDocId = docId;
            const index = getDocIndex();
            const docEntry = index.find(d => d.id === state.currentDocId);
            D.docTitleInput.value = docEntry ? docEntry.title : 'Untitled';
            localStorage.setItem('typewriter.last_doc.v1', state.currentDocId);
            
            // UI Updates
            applyStopsVisibility();
            setThemeOverride(state.themeOverride); // This ensures theme is correctly applied
            resetShim();
            render();
            afterLayout(() => {
                positionRuler();
                centerCaret();
            });
            restartBlink(render);
            D.shim.focus();
            return true;
        }
    } catch (e) {
        console.warn('Load failed:', e);
    }
    return false;
}

export function createNewDoc() {
    if (state.currentDocId && (state.lines.length > 1 || (state.lines[0] && state.lines[0].length > 0))) {
        storageSave();
    }
    state.currentDocId = 'doc_' + Date.now();
    state.lines = [[]];
    state.lineLeft = [state.marginL];
    state.pageMargins = [{ top: state.defaultMarginTop, bottom: state.defaultMarginBottom }];
    state.row = 0;
    state.col = 0;
    state.docPolarity = effectiveDark();
    D.docTitleInput.value = 'Untitled';
    storageSave();
    updateDocsList();

    render();
    centerCaret();
    restartBlink(render);
    resetShim();
    D.shim.focus();
}

export function deleteCurrentDoc() {
    if (!state.currentDocId || !confirm('Are you sure you want to delete this document?')) return;
    const docIdToDelete = state.currentDocId;
    let index = getDocIndex();
    const newIndex = index.filter(d => d.id !== docIdToDelete);
    saveDocIndex(newIndex);
    localStorage.removeItem('typewriter.doc.v4.' + docIdToDelete);
    state.currentDocId = null;
    if (newIndex.length > 0) {
        loadDoc(newIndex[0].id);
    } else {
        createNewDoc();
    }
    updateDocsList();
}

// This function now correctly orchestrates theme changes and UI updates
export function setThemeOverride(mode) {
    state.themeOverride = mode;
    const root = document.documentElement;
    if (mode === 'dark') root.setAttribute('data-theme', 'dark');
    else if (mode === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    applyThemeSideEffects();
    render();
    positionRuler();
    updateThemeButton();
}