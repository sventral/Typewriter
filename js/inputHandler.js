import * as D from './dom.js';
import { state, insertChar, deleteBackwardOne, moveLeft, moveRight, moveUp, moveDown, reflowFromRow, restartBlink } from './state.js';
import { render, centerCaret } from './renderer.js';
import { saveCurrentDoc } from './storage.js';
import { getPageLayout, mapRowToPagePos } from './renderer.js';
import * as C from './constants.js';

let shimPrev = '', deletionPending = false, shimHold = '', deletionTimer = null, lastEventTs = 0;
const DELETION_GRACE_MS = 100;

export function resetShim() {
    D.shim.value = '';
    shimPrev = '';
    cancelDeletionPending();
}

function cancelDeletionPending() {
    deletionPending = false;
    if (deletionTimer) {
        clearTimeout(deletionTimer);
        deletionTimer = null;
    }
}

function startDeletionPending() {
    if (!deletionPending) {
        deletionPending = true;
        shimHold = shimPrev;
    }
    if (deletionTimer) clearTimeout(deletionTimer);
    deletionTimer = setTimeout(() => {
        D.shim.value = shimHold;
        shimPrev = shimHold;
        cancelDeletionPending();
    }, DELETION_GRACE_MS);
}

function computeDelta(prev, curr) {
    let i = 0, pLen = prev.length, cLen = curr.length;
    while (i < pLen && i < cLen && prev[i] === curr[i]) i++;
    let j = 0;
    while (j < pLen - i && j < cLen - i && prev[pLen - 1 - j] === curr[cLen - 1 - j]) j++;
    return { removed: pLen - i - j, inserted: curr.slice(i, cLen - j) };
}

function applyDelta(prev, curr) {
    const { removed, inserted } = computeDelta(prev, curr);
    for (let k = 0; k < removed; k++) deleteBackwardOne();
    for (const ch of inserted) {
        if (ch === '\r') continue;
        insertChar(ch);
    }
    reflowFromRow(state.row);
    saveCurrentDoc();
}

function onShimInput() {
    const now = performance.now(), curr = D.shim.value, baseline = deletionPending ? shimHold : shimPrev;
    const { removed, inserted } = computeDelta(baseline, curr);
    const bursty = (now - lastEventTs) < 24;
    lastEventTs = now;

    if (removed > 0 && inserted.length === 0) {
        startDeletionPending();
        return;
    }
    if (inserted.length > 0) {
        if (deletionPending) {
            if (deletionTimer) clearTimeout(deletionTimer);
            applyDelta(shimHold, curr);
            cancelDeletionPending();
        } else {
            applyDelta(shimPrev, curr);
        }
        shimPrev = curr;
        render();
        centerCaret();
        restartBlink(render);
        return;
    }
    if (!bursty) shimPrev = curr;
}

function handleEnterKey() {
    insertChar('\n');
    reflowFromRow(state.row - 1);
    render();
    centerCaret();
    restartBlink(render);
    saveCurrentDoc();
    resetShim();
}

function onKeyDown(e) {
    const k = e.key;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.activeElement === D.docTitleInput) {
        if (k === 'Enter') D.shim.focus();
        return;
    }
    if (document.activeElement !== D.shim) D.shim.focus();
    if (k === 'Backspace' || k === 'Delete') {
        return;
    }
    if (k.startsWith('Arrow') || k === 'Home' || k === 'End') {
        e.preventDefault();
        if (k === 'ArrowLeft') moveLeft();
        else if (k === 'ArrowRight') moveRight();
        else if (k === 'ArrowUp') moveUp();
        else if (k === 'ArrowDown') moveDown();
        else if (k === 'Home') state.col = 0;
        else if (k === 'End') state.col = state.lines[state.row].length;
        render();
        centerCaret();
        restartBlink(render);
        resetShim();
        return;
    }
    if (k === 'Enter') {
        e.preventDefault();
        handleEnterKey();
        return;
    }
}

function onCanvasMouseDown(e) {
    const rect = D.canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    const pageLayout = getPageLayout();
    const pageBlockHeight = C.PAGE_H + C.PAGE_GAP;
    const pageIndex = Math.floor(y / pageBlockHeight);
    if (pageIndex >= pageLayout.length) return;
    const page = pageLayout[pageIndex];
    const yOnPage = y - (pageIndex * pageBlockHeight);
    if (yOnPage > C.PAGE_H) return;
    const lineOnPage = Math.max(0, Math.floor((yOnPage - page.margins.top) / C.LINE_HEIGHT));
    const newRow = Math.min(state.lines.length - 1, page.lineStart + lineOnPage);
    state.row = newRow;
    const left = state.lineLeft[state.row] ?? state.marginL;
    const newCol = Math.max(0, Math.round((x - left) / C.CHAR_WIDTH));
    state.col = Math.min(newCol, state.lines[state.row].length);
    render();
    centerCaret();
    restartBlink(render);
    D.shim.focus();
    resetShim();
}

export function initInputHandlers() {
    D.shim.addEventListener('input', onShimInput);
    window.addEventListener('keydown', onKeyDown);
    D.canvas.addEventListener('mousedown', onCanvasMouseDown);
    document.addEventListener('pointerdown', (e) => {
        if (e.target !== D.docTitleInput && document.activeElement !== D.shim) D.shim.focus();
    });
}