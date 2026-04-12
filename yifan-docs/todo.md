# Future Work

## Per-element-type color/style memory

**Status:** Proposed, not started

**Problem:** Changing a rectangle's color updates the global default, so the next text element inherits that color. Styles bleed across element types.

**Proposed design:** Store `lastUsedStyles: Record<ElementType, Partial<ElementStyle>>` in appState. When any style property is changed on an element, snapshot that element's full style into `lastUsedStyles[element.type]`. When creating a new element, merge `lastUsedStyles[type]` with global defaults.

**Scope:**
- `types.ts` — add `lastUsedStyles` to AppState
- `appState.ts` — default value + storage config
- `actions/actionProperties.tsx` — snapshot helper called from each style-change action
- `components/App.tsx` — merge helper at each element creation site
- ~200-300 lines, 4-5 files

**Open question:** Should editing an existing element update the per-type default, or only creating new elements? Editing is more intuitive ("this is my new style for rectangles") but means one quick experiment permanently changes the default.
