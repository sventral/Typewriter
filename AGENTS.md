# Repository Instructions
- Before creating a commit, run only these basic automated checks by default:
  - `npm test`
  - `node --check js/main.js` (and `node --check` for any JS files you changed)
- Do not run browser automation (Playwright or similar) unless the user explicitly asks for it.
- For UI behavior (load/typing/basic interactions), rely on brief manual verification guidance for the user instead of automated browser tests.
- Keep documentation concise and current: update `README.md` when user-facing features, labels, controls, export options, or workflows change.
- If relevant, advise the user about which practical tests they should perform to check any modifications.
- Every change set must increment the visible version banner in index.html (.app-version) by increasing the numeric portion by 0.1 (e.g., v.1.7b → v.1.8b).
- Prefer extracting or extending focused modules instead of expanding already large files, unless there’s a clear reason not to.
