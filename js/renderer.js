import * as C from './constants.js';
import * as D from './dom.js';
import { state, effectiveDark } from './state.js';
import { positionRuler } from './ruler.js';

export function getPageLayout() {
    const layout = [];
    let lineStart = 0;
    for (let i = 0; ; i++) {
        const margins = state.pageMargins[i] || { top: state.defaultMarginTop, bottom: state.defaultMarginBottom };
        const linesOnPage = Math.max(1, Math.floor((C.PAGE_H - margins.top - margins.bottom) / C.LINE_HEIGHT));
        layout.push({ lineStart, linesOnPage, margins });
        lineStart += linesOnPage;
        if (lineStart > state.lines.length) break;
    }
    return layout;
}

export function mapRowToPagePos(globalRow) {
    const pageLayout = getPageLayout();
    for (let i = 0; i < pageLayout.length; i++) {
        const page = pageLayout[i];
        if (globalRow >= page.lineStart && globalRow < page.lineStart + page.linesOnPage) {
            return { pageIndex: i, lineOnPage: globalRow - page.lineStart, pageTopY: i * (C.PAGE_H + C.PAGE_GAP), margins: page.margins };
        }
    }
    const lastPage = pageLayout[pageLayout.length - 1];
    return { pageIndex: pageLayout.length - 1, lineOnPage: globalRow - lastPage.lineStart, pageTopY: (pageLayout.length - 1) * (C.PAGE_H + C.PAGE_GAP), margins: lastPage.margins };
}

function colorFor(code) {
    const DARK_PAGE = getComputedStyle(document.documentElement).getPropertyValue('--page-bg-dark').trim() || '#1c1c1c';
    return (code === 'r') ? '#b00000' : (code === 'w') ? '#ffffff' : DARK_PAGE;
}

export function render() {
    const pageLayout = getPageLayout();
    const numPages = pageLayout.length;
    while (state.pageMargins.length < numPages) {
        state.pageMargins.push({ top: state.defaultMarginTop, bottom: state.defaultMarginBottom });
    }

    const totalHeight = numPages * C.PAGE_H + (numPages - 1) * C.PAGE_GAP;
    if (D.canvas.height !== totalHeight) D.canvas.height = totalHeight;
    D.pageWrap.style.height = totalHeight + 'px';

    D.ctx.clearRect(0, 0, D.canvas.width, D.canvas.height);
    for (let i = 0; i < numPages; i++) {
        const pageTop = i * (C.PAGE_H + C.PAGE_GAP);
        D.ctx.save();
        D.ctx.shadowColor = effectiveDark() ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.1)';
        D.ctx.shadowBlur = 24;
        D.ctx.shadowOffsetY = 8;
        D.ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--page-bg').trim();
        D.ctx.fillRect(0, pageTop, C.PAGE_W, C.PAGE_H);
        D.ctx.restore();
    }

    D.ctx.font = C.FONT_STYLE;
    D.ctx.textBaseline = 'top';
    for (let i = 0; i < numPages; i++) {
        const page = pageLayout[i];
        const pageTop = i * (C.PAGE_H + C.PAGE_GAP);
        for (let l = 0; l < page.linesOnPage; l++) {
            const r = page.lineStart + l;
            if (r >= state.lines.length) break;
            const y = pageTop + page.margins.top + l * C.LINE_HEIGHT;
            const left = state.lineLeft[r] ?? state.marginL;
            for (let c = 0; c < state.lines[r].length; c++) {
                const x = left + c * C.CHAR_WIDTH;
                const stk = state.lines[r][c];
                if (!stk.length) continue;
                for (let s = 0; s < stk.length; s++) {
                    D.ctx.fillStyle = colorFor(stk[s].col);
                    D.ctx.fillText(stk[s].ch, x, y);
                }
            }
        }
    }

    const { lineOnPage, pageTopY, margins } = mapRowToPagePos(state.row);
    const cx = (state.lineLeft[state.row] ?? state.marginL) + state.col * C.CHAR_WIDTH;
    const cy = pageTopY + margins.top + lineOnPage * C.LINE_HEIGHT;
    D.ctx.fillStyle = effectiveDark() ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.44)';
    if (state.caretOn) D.ctx.fillRect(Math.floor(cx), Math.floor(cy - 2), 2, C.LINE_HEIGHT + 4);

    positionRuler();
}

function offsetWithin(el, ancestor) {
    let x = 0, y = 0, e = el;
    while (e && e !== ancestor) {
        x += e.offsetLeft || 0;
        y += e.offsetTop || 0;
        e = e.offsetParent;
    }
    return { x, y };
}

export const afterLayout = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

export function centerCaret() {
    const { pageTopY, lineOnPage, margins } = mapRowToPagePos(state.row);
    const cx = (state.lineLeft[state.row] ?? state.marginL) + state.col * C.CHAR_WIDTH;
    const cy = pageTopY + margins.top + lineOnPage * C.LINE_HEIGHT;
    const pos = offsetWithin(D.pageWrap, D.stage);
    D.stage.scrollTop = Math.max(0, pos.y + cy - D.stage.clientHeight / 2);
    D.stage.scrollLeft = Math.max(0, pos.x + cx - D.stage.clientWidth / 2);
    positionRuler();
}