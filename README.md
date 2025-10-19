# Typewriter

Typewriter is a browser-based typewriter simulator that renders each keystroke onto a virtual sheet of paper. The interface recreates margin-aware typing, caret movement, rulers, and document management features entirely in the client.

## Raw document export fix

The latest change restores the ability to download the active document as raw JSON. The serializer that prepares the document data now lives in `js/storage.js` where it can be reused. `js/fileManager.js` imports this serializer so the **Save → Raw JSON** option can package the current state and trigger a download through either the File System Access API or a classic download link fallback.

You do not need to take any manual action to benefit from this fix—open the save dialog and pick the Raw option to export the JSON snapshot.
