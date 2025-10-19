import * as C from './constants.js';
import * as D from './dom.js';
import { state } from './state.js';
import { render } from './renderer.js';
import { saveCurrentDoc } from './storage.js';
import { mapRowToPagePos, getPageLayout } from './renderer.js';

let drag = null;

function updateRulerTicks(activePageRect) {
    const ticksH = D.rulerH_host.querySelector('.ruler-ticks');
    const ticksV = D.rulerV_host.querySelector('.ruler-v-ticks');
    ticksH.innerHTML = '';
    ticksV.innerHTML = '';

    const ppiH = (C.PAGE_W / 210) * 25.4;
    const originX = activePageRect.left;
    const startInchH = Math.floor(-originX / ppiH);
    const endInchH = Math.ceil((window.innerWidth - originX) / ppiH);

    for (let i = startInchH; i <= endInchH; i++) {
        for (let j = 0; j < 10; j++) {
            const x = originX + (i + j / 10) * ppiH;
            if (x < 0 || x > window.innerWidth) continue;
            let tickClass = 'tick minor';
            if (j === 0) tickClass = 'tick major';
            else if (j === 5) tickClass = 'tick medium';
            const tick = document.createElement('div');
            tick.className = tickClass;
            tick.style.left = x + 'px';
            ticksH.appendChild(tick);
            if (j === 0) {
                const lbl = document.createElement('div');
                lbl.className = 'tick-num';
                lbl.textContent = i;
                lbl.style.left = (x + 4) + 'px';
                ticksH.appendChild(lbl);
            }
        }
    }

    const ppiV = (C.PAGE_H / 297) * 25.4;
    const originY = activePageRect.top;
    const startInchV = Math.floor(-originY / ppiV);
    const endInchV = Math.ceil((window.innerHeight - originY) / ppiV);

    for (let i = startInchV; i <= endInchV; i++) {
        for (let j = 0; j < 10; j++) {
            const y = originY + (i + j / 10) * ppiV;
            if (y < 0 || y > window.innerHeight) continue;
            let tickClass = 'tick-v minor';
            if (j === 0) tickClass = 'tick-v major';
            else if (j === 5) tickClass = 'tick-v medium';
            const tick = document.createElement('div');
            tick.className = tickClass;
            tick.style.top = y + 'px';
            ticksV.appendChild(tick);
            if (j === 0) {
                const lbl = document.createElement('div');
                lbl.className = 'tick-v-num';
                lbl.textContent = i;
                lbl.style.top = (y + 4) + 'px';
                ticksV.appendChild(lbl);
            }
        }
    }
}

export function positionRuler() {
    if (!state.showStops) return;
    const pageLayout = getPageLayout();
    const { pageIndex: activePageIndex } = mapRowToPagePos(state.row);
    D.rulerH_stops_container.innerHTML = '';
    D.rulerV_stops_container.innerHTML = '';

    let activePageRect = null;

    for (let i = 0; i < pageLayout.length; i++) {
        const pageTop = i * (C.PAGE_H + C.PAGE_GAP);
        const pageRect = new DOMRect(D.pageWrap.getBoundingClientRect().left, D.pageWrap.getBoundingClientRect().top + pageTop, C.PAGE_W, C.PAGE_H);
        const isActive = (i === activePageIndex);

        if (isActive) activePageRect = pageRect;

        const mLeft = document.createElement('div');
        mLeft.className = `tri left ${isActive ? '' : 'inactive-stop'}`;
        mLeft.style.left = pageRect.left + state.marginL + 'px';
        mLeft.dataset.drag = 'left';
        D.rulerH_stops_container.appendChild(mLeft);

        const mRight = document.createElement('div');
        mRight.className = `tri right ${isActive ? '' : 'inactive-stop'}`;
        mRight.style.left = pageRect.left + state.marginR + 'px';
        mRight.dataset.drag = 'right';
        D.rulerH_stops_container.appendChild(mRight);

        if (isActive) {
            const mTop = document.createElement('div');
            mTop.className = 'tri-v top';
            mTop.style.top = pageRect.top + state.defaultMarginTop + 'px';
            mTop.dataset.drag = 'top';
            D.rulerV_stops_container.appendChild(mTop);

            const mBottom = document.createElement('div');
            mBottom.className = 'tri-v bottom';
            mBottom.style.top = pageRect.top + (C.PAGE_H - state.defaultMarginBottom) + 'px';
            mBottom.dataset.drag = 'bottom';
            D.rulerV_stops_container.appendChild(mBottom);
        }
    }
    if (activePageRect) updateRulerTicks(activePageRect);
}

export function buildRuler() {
    if (!D.rulerH_host.querySelector('.ruler-ticks')) {
        const ticks = document.createElement('div');
        ticks.className = 'ruler-ticks';
        D.rulerH_host.prepend(ticks);
    }
    if (!D.rulerV_host.querySelector('.ruler-v-ticks')) {
        const ticks = document.createElement('div');
        ticks.className = 'ruler-v-ticks';
        D.rulerV_host.prepend(ticks);
    }
}

function onHMove(ev) {
    if (!drag || !state.showStops) return;
    const pageRect = D.pageWrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(C.PAGE_W, ev.clientX - pageRect.left));
    if (drag === 'left') {
        state.marginL = Math.max(0, Math.min(x, state.marginR - 10 * C.CHAR_WIDTH));
    } else {
        state.marginR = Math.min(C.PAGE_W, Math.max(x, state.marginL + 10 * C.CHAR_WIDTH));
    }
    D.guideV.style.left = ev.clientX + 'px';
    render();
}

function onVMove(ev) {
    if (!drag || !state.showStops) return;
    const { pageIndex } = mapRowToPagePos(state.row);
    const pageRect = D.pageWrap.getBoundingClientRect();
    const pageTopY = pageRect.top + pageIndex * (C.PAGE_H + C.PAGE_GAP);
    let y = ev.clientY - pageTopY;

    if (drag === 'top') {
        y = Math.max(20, Math.min(y, C.PAGE_H - state.defaultMarginBottom - 5 * C.LINE_HEIGHT));
        state.defaultMarginTop = y;
    } else {
        y = Math.max(state.defaultMarginTop + 5 * C.LINE_HEIGHT, Math.min(y, C.PAGE_H - 20));
        state.defaultMarginBottom = C.PAGE_H - y;
    }

    const pageLayout = getPageLayout();
    const currentPage = pageLayout[pageIndex];
    const isPageEmpty = (state.lines.length === currentPage.lineStart + 1) && (state.lines[currentPage.lineStart]?.length === 0);

    if (isPageEmpty) {
        state.pageMargins[pageIndex] = { top: state.defaultMarginTop, bottom: state.defaultMarginBottom };
    }

    D.guideH.style.top = ev.clientY + 'px';
    render();
}

function onUp() {
    drag = null;
    D.guideV.style.display = 'none';
    D.guideH.style.display = 'none';
    document.removeEventListener('mousemove', onHMove);
    document.removeEventListener('mousemove', onVMove);
    document.removeEventListener('mouseup', onUp);
    saveCurrentDoc();
}

export function initRulerHandlers() {
    D.rulerH_stops_container.addEventListener('mousedown', e => {
        if (!state.showStops || !e.target.matches('.tri')) return;
        e.preventDefault();
        drag = e.target.classList.contains('left') ? 'left' : 'right';
        D.guideV.style.display = 'block';
        D.guideV.style.left = e.clientX + 'px';
        document.addEventListener('mousemove', onHMove);
        document.addEventListener('mouseup', onUp);
    });

    D.rulerV_stops_container.addEventListener('mousedown', e => {
        if (!state.showStops || !e.target.matches('.tri-v')) return;
        e.preventDefault();
        drag = e.target.classList.contains('top') ? 'top' : 'bottom';
        D.guideH.style.display = 'block';
        D.guideH.style.top = e.clientY + 'px';
        document.addEventListener('mousemove', onVMove);
        document.addEventListener('mouseup', onUp);
    });
}