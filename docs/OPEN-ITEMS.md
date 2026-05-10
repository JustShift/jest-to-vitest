# Open work items

Tracked items that are scoped, understood, and not yet implemented. Each one represents a known gap between what a user might reasonably expect and what the converter does today.

When implementing one of these, drop the entry from this file and update `docs/SUPPORT-CHECKLIST.md` to reflect the new state.

## Open

- [ ] **Detect `globalSetup` / `globalTeardown` with a CommonJS export and emit a manual-review warning.**
  - Today: `src/converter.ts` maps `globalSetup` straight through to `test.globalSetup` with no inspection of the referenced file or its export shape.
  - Expected: Vitest requires an ESM default export. When the Jest config points at a `.js`/`.cjs` file that uses `module.exports = ...`, surface a warning like `globalSetup uses CommonJS export — Vitest expects ESM default export. Convert by hand.`
  - The converter only sees the config file, not the referenced setup file, so detection has to be heuristic. Two options:
    - **Extension-based:** warn for `.js` and `.cjs`, allow `.mjs` / `.ts` / `.mts` to pass silently
    - **Always-on:** warn whenever `globalSetup` is present, with copy that explains both shapes
  - Pick one, ship it, and re-add the bullet to whatever "Unsupported options" list the website surfaces.
