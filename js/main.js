import * as C from './constants.js';
import * as D from './dom.js';
import { state } from './state.js';
import { render, centerCaret, afterLayout } from './renderer.js';
import { buildRuler, positionRuler, initRulerHandlers } from './ruler.js';
import { getDocIndex, saveCurrentDoc } from './storage.js';
import { loadDoc, createNewDoc, setThemeOverride } from './document.js';
import { initUIHandlers, updateDocsList } from './ui.js';
import { initInputHandlers } from './inputHandler.js';
import { initFileHandlers } from './fileManager.js';

function init() {
    buildRuler();
    initUIHandlers();
    initInputHandlers();
    initRulerHandlers();
    initFileHandlers();

    C.MEDIA_DARK_MODE.addEventListener('change', (e) => {
        state.systemDark = e.matches;
        if (state.themeOverride === 'auto') {
            setThemeOverride('auto');
        }
    });

    const lastDocId = localStorage.getItem('typewriter.last_doc.v1');
    if (lastDocId && loadDoc(lastDocId)) {
        // Successfully loaded last doc
    } else {
        const index = getDocIndex();
        if (index.length > 0 && loadDoc(index[0].id)) {
            // Successfully loaded first doc in index
        } else {
            createNewDoc();
        }
    }
    updateDocsList();
    D.shim.focus();
}

window.addEventListener('resize', () => {
    render();
    afterLayout(() => {
        positionRuler();
        centerCaret();
    });
});
D.stage.addEventListener('scroll', () => { positionRuler(); }, { passive: true });
window.addEventListener('beforeunload', saveCurrentDoc);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.activeElement !== D.docTitleInput) D.shim.focus();
});

requestAnimationFrame(init);
