import * as D from './dom.js';
import { state } from './state.js';
import { render, centerCaret } from './renderer.js';
import { saveCurrentDoc, deserializeDoc } from './storage.js';
import { createNewDoc, deleteCurrentDoc } from './document.js';

function exportAsMarkdown(options) {
    let out = '';
    for (let r = 0; r < state.lines.length; r++) {
        let lineOut = '';
        let isUnderlined = false;
        let isStruck = false;
        const line = state.lines[r] || [];

        for (let c = 0; c < line.length; c++) {
            const cell = line[c] || [];
            if (!cell.length) {
                lineOut += ' ';
                continue;
            }

            const topChar = cell[cell.length - 1].ch;
            const isXOvertype = cell.length > 1 && topChar.toLowerCase() === 'x';

            let finalChar;
            if (options.deleteX && isXOvertype) {
                finalChar = ' ';
            } else if (options.preserveUnderline || options.preserveStrike) {
                let contentChar = null;
                for (let i = cell.length - 1; i >= 0; i--) {
                    const ch = cell[i].ch;
                    if (ch !== '_' && ch !== '-') {
                        contentChar = ch;
                        break;
                    }
                }
                finalChar = contentChar !== null ? contentChar : topChar;
            } else {
                finalChar = topChar;
            }

            const hasUnderline = cell.some(s => s.ch === '_');
            const hasStrike = cell.some(s => s.ch === '-');

            const shouldBeStruck = options.preserveStrike && hasStrike;
            if (shouldBeStruck !== isStruck) {
                lineOut += shouldBeStruck ? '~' : '~';
                isStruck = shouldBeStruck;
            }

            const shouldBeUnderlined = options.preserveUnderline && hasUnderline;
            if (shouldBeUnderlined !== isUnderlined) {
                lineOut += shouldBeUnderlined ? '<ins>' : '</ins>';
                isUnderlined = shouldBeUnderlined;
            }

            lineOut += finalChar;
        }

        if (isStruck) { lineOut += '~'; }
        if (isUnderlined) { lineOut += '</ins>'; }

        out += lineOut;
        if (r < state.lines.length - 1) {
            out += '\n';
        }
    }
    return out;
}

async function saveAsTxt() {
    const options = {
        preserveUnderline: D.preserveUnderlineCheckbox.checked,
        preserveStrike: D.preserveStrikeCheckbox.checked,
        deleteX: D.deleteXCheckbox.checked
    };
    const text = exportAsMarkdown(options);
    try {
        if (window.showSaveFilePicker) {
            const handle = await window.showSaveFilePicker({ suggestedName: (D.docTitleInput.value || 'Typewriter') + '.txt', types: [{ description: 'Text Files', accept: { 'text/plain': ['.txt'] } }] });
            const writable = await handle.createWritable();
            await writable.write(new Blob([text], { type: 'text/plain' }));
            await writable.close();
            return;
        }
    } catch (err) { if (err?.name === 'AbortError') return; }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = (D.docTitleInput.value || 'Typewriter') + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function saveRawData() {
    const rawData = JSON.stringify(serializeDoc(), null, 2);
    try {
        if (window.showSaveFilePicker) {
            const handle = await window.showSaveFilePicker({ suggestedName: (D.docTitleInput.value || 'Typewriter') + '.json', types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }] });
            const writable = await handle.createWritable();
            await writable.write(new Blob([rawData], { type: 'application/json' }));
            await writable.close();
            return;
        }
    } catch (err) { if (err?.name === 'AbortError') return; }
    const blob = new Blob([rawData], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = (D.docTitleInput.value || 'Typewriter') + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (deserializeDoc(data)) {
                createNewDoc(); // Save current doc first
                deserializeDoc(data); // Then load new data into current doc
                D.docTitleInput.value = file.name.replace(/\.json$/i, '') || 'Imported Document';
                saveCurrentDoc();
                render();
                centerCaret();
            } else {
                alert('Invalid or unsupported file format.');
            }
        } catch (err) {
            alert('Failed to read or parse the file.');
        }
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset file input
}

export function initFileHandlers() {
    D.saveBtn.onclick = () => { D.saveDialog.classList.add('show'); };
    D.cancelSaveBtn.onclick = () => { D.saveDialog.classList.remove('show'); };
    D.confirmSaveBtn.onclick = () => {
        if (D.saveRawCheckbox.checked) {
            saveRawData();
        } else {
            saveAsTxt();
        }
        D.saveDialog.classList.remove('show');
    };

    D.saveRawCheckbox.addEventListener('change', () => {
        const disabled = D.saveRawCheckbox.checked;
        D.textOptions.style.opacity = disabled ? 0.5 : 1;
        [D.preserveUnderlineCheckbox, D.preserveStrikeCheckbox, D.deleteXCheckbox].forEach(cb => {
            cb.disabled = disabled;
            cb.parentElement.classList.toggle('disabled', disabled);
        });
    });

    D.importBtn.onclick = () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';
        fileInput.onchange = handleFileImport;
        fileInput.click();
    };

    D.newDocBtn.onclick = createNewDoc;
    D.deleteDocBtn.onclick = deleteCurrentDoc;
}