import * as C from './constants.js';

export const state = {
    marginL: 6 * C.CHAR_WIDTH,
    marginR: C.PAGE_W - 6 * C.CHAR_WIDTH,
    lines: [[]],
    lineLeft: [],
    pageMargins: [],
    defaultMarginTop: 40,
    defaultMarginBottom: 40,
    row: 0,
    col: 0,
    ink: 'b',
    docPolarity: false,
    caretOn: true,
    blinkTimer: null,
    currentDocId: null,
    themeOverride: 'auto',
    showStops: false,
    systemDark: C.MEDIA_DARK_MODE.matches,
};

state.lineLeft[0] = state.marginL;
state.pageMargins[0] = { top: state.defaultMarginTop, bottom: state.defaultMarginBottom };

export function effectiveDark() {
    return state.themeOverride === 'dark' ? true : state.themeOverride === 'light' ? false : state.systemDark;
}

export function restartBlink(renderFunc) {
    state.caretOn = true;
    if (state.blinkTimer) clearInterval(state.blinkTimer);
    state.blinkTimer = setInterval(() => {
        state.caretOn = !state.caretOn;
        renderFunc();
    }, 520);
}

function ensureCell(r, c) {
    while (state.lines.length <= r) {
        state.lines.push([]);
        state.lineLeft.push(state.marginL);
    }
    while (state.lines[r].length <= c) {
        state.lines[r].push([]);
    }
}

const maxCols = () => Math.max(1, Math.floor((state.marginR - state.marginL) / C.CHAR_WIDTH));
const isSpaceCell = cell => cell.length && cell[cell.length - 1].ch === ' ';

function wrapLineAtSpaces(r) {
    const max = maxCols();
    if (state.lines[r].length <= max) return false;
    let breakPos = -1;
    const scanFrom = Math.min(max - 1, state.lines[r].length - 1);
    for (let i = scanFrom; i >= 0; i--) {
        if (isSpaceCell(state.lines[r][i])) {
            breakPos = i;
            break;
        }
    }
    if (breakPos === -1) return false;
    while (breakPos >= 0 && isSpaceCell(state.lines[r][breakPos])) breakPos--;
    const moveStart = breakPos + 1;
    let segment = state.lines[r].splice(moveStart);
    let leadingSpaces = 0;
    while (segment.length && isSpaceCell(segment[0])) {
        segment.shift();
        leadingSpaces++;
    }
    if (!segment.length) return true;
    if (!state.lines[r + 1]) {
        state.lines[r + 1] = [];
        state.lineLeft[r + 1] = state.marginL;
    }
    state.lines[r + 1] = segment.concat(state.lines[r + 1]);
    if (state.row === r) {
        if (state.col >= moveStart) {
            state.row = r + 1;
            state.col = Math.max(0, state.col - moveStart - leadingSpaces);
        }
    } else if (state.row === r + 1) {
        state.col += segment.length;
    }
    return true;
}

export function reflowFromRow(start) {
    for (let r = Math.max(0, start); r < state.lines.length; r++) {
        let wrapped;
        do {
            wrapped = wrapLineAtSpaces(r);
        } while (wrapped);
    }
}

export function insertChar(ch) {
    ensureCell(state.row, state.col);
    if (ch === '\n') {
        const rest = state.lines[state.row].splice(state.col);
        state.lines.splice(state.row + 1, 0, rest);
        state.lineLeft.splice(state.row + 1, 0, state.marginL);
        state.row++;
        state.col = 0;
    } else {
        if (state.lines[state.row].length === 0) state.lineLeft[state.row] = state.lineLeft[state.row] ?? state.marginL;
        state.lines[state.row][state.col].push({ ch, col: state.ink });
        state.col++;
    }
}

export function deleteBackwardOne() {
    if (state.col > 0) {
        state.lines[state.row].splice(state.col - 1, 1);
        state.col--;
    } else if (state.row > 0) {
        state.row--;
        state.col = state.lines[state.row].length;
    }
}

export function moveLeft() {
    if (state.col > 0) state.col--;
    else if (state.row > 0) {
        state.row--;
        state.col = state.lines[state.row].length;
    }
}

export function moveRight() {
    if (state.col < state.lines[state.row].length) state.col++;
    else if (state.row < state.lines.length - 1) {
        state.row++;
        state.col = 0;
    }
}

export function moveUp() {
    if (state.row > 0) {
        state.row--;
        state.col = Math.min(state.col, state.lines[state.row].length);
    }
}

export function moveDown() {
    if (state.row < state.lines.length - 1) {
        state.row++;
        state.col = Math.min(state.col, state.lines[state.row].length);
    }
}

export function swapInksInDocument() {
    for (let r = 0; r < state.lines.length; r++) {
        for (let c = 0; c < state.lines[r].length; c++) {
            const stk = state.lines[r][c];
            for (let i = 0; i < stk.length; i++) {
                if (stk[i].col === 'b') stk[i].col = 'w';
                else if (stk[i].col === 'w') stk[i].col = 'b';
            }
        }
    }
}