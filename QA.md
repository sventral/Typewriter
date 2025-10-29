# Manual QA Checklist

## Load & Save State
1. Open the app in a browser and type text across multiple pages.
2. Refresh the page and confirm the content, caret position, and settings restore from localStorage.
3. Clear the document via **New Document** and verify the saved state resets.

## Ink Opacity Controls
1. Adjust each ink opacity slider and confirm the numeric labels update.
2. Release the slider and ensure the rendered page updates with the new opacity.
3. Reload the page to verify the selected values persist.

## Stage Size Inputs
1. Modify the stage width and height percentage inputs; ensure stage bounds update immediately.
2. Blur each input to confirm values sanitize to the allowed range and persist after refresh.

## Dialog Toggles
1. Open and close the Fonts, Settings, and Ink Settings panels via their buttons.
2. Press `Esc` to ensure all dialogs close.
3. Select a font radio button and confirm the font loads and the stage regains focus.
