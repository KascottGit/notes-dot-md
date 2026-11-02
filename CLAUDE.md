# notes.md

How to work in this repo. **What to build is in `SPEC.md`: read the relevant sections before starting any work.** Setup, commands and deployment are in `README.md`. Each topic lives in one of these files only; when something changes, change it there and nowhere else.

## Golden rules

1. **The document is always plain markdown.** The live-preview editor only *decorates* text (CodeMirror decorations). Never transform, normalize or re-serialize the document text to render it. Copy, export and Drive all see the exact same string.
2. **No backend.** Everything runs in the browser. Do not add a server, database or serverless function without asking.
3. **Never lose user text.** On any save or auth failure, keep the text in the editor and show an error state. Never overwrite a newer Drive version silently (see "Saving and conflict handling" in SPEC.md).
4. **Never hard-delete.** Deleting a note, category, card image or other file moves it to the Drive trash (`trashed: true`).
5. **Access tokens stay in memory.** Never write tokens to `localStorage`, `sessionStorage`, cookies or logs.
6. **Notes are identified by Drive file id**, never by path or title.

## Workflow

- Build **one milestone or to-do item at a time**, in the order listed in SPEC.md.
- When it is done: run `npm run check`, `npm run lint` and `npm test`, commit, then **stop**. Summarize what changed and list the manual test steps for its acceptance criteria. Do not start the next one until asked.
- Update SPEC.md in the same commit when behavior changes: describe it in the section it belongs to, and tick it off in the milestones or to-do list.
- If the spec is unclear or seems wrong, ask instead of guessing. Do not add features that are not in the spec; suggest them instead.
- Keep changes small and focused. Prefer editing existing modules over adding new layers of abstraction.
- Commits: Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).

## Code layout

```
src/
  auth/google.ts         redirect sign-in, getToken(), renewal
  drive/client.ts        fetch wrapper: auth header, retries, 401 handling
  drive/notes.ts         notes, categories, settings file and images in Drive; folder bootstrap
  drive/names.ts         file names and query quoting
  drive/fakeDrive.ts     an in-memory Drive for tests (and visual checks)
  editor/setup.ts        CodeMirror configuration and keymaps
  editor/livePreview.ts  decoration plugin (rendering rules)
  editor/widgets.ts      checkbox, bullet, rule and image widgets
  editor/tableEdit.ts    table cells, rows and columns as text changes (no DOM)
  editor/tableWidget.ts  the editable table widget
  editor/markdown.ts     markdown helpers: links, inline content, tables, previews (no DOM)
  editor/commands.ts     format commands, shared by toolbar and shortcuts
  editor/lists.ts        moving and indenting list items
  editor/tags.ts         finding #tags in text
  editor/tagComplete.ts  tag autocomplete
  editor/board.ts        task boards: parse columns/cards, move/add/rename/archive, attachments (no DOM)
  editor/cardRules.ts    card editor rules: no # / ## lines, date chips
  store/noteSession.ts   one open note: autosave, conflict check, app properties
  store/noteList.ts      list filtering, search results, sorting
  store/route.ts         the note in the URL, last open note
  store/tagColors.ts     tag colors and the settings file
  ui/                    Svelte components (Workspace.svelte ties them together)
  ui/keyboardFit.ts      fitting the app above the iPhone keyboard
  ui/images.ts           preparing and showing card images
  app.css                theme tokens and shared styles
scripts/make-icons.py    draws the app icons
```

Markdown and board logic (`editor/commands.ts`, `editor/markdown.ts`, `editor/board.ts`, `editor/tags.ts`, `editor/tableEdit.ts`) stays free of Svelte and DOM code, so it can be unit-tested and reused.

## Conventions

- TypeScript strict mode; no `any` without a comment explaining why.
- All Drive access goes through `drive/client.ts`. UI code never calls `fetch` for Drive directly.
- Request only the fields you need from Drive (`fields=` parameter).
- The OAuth scope lives in one constant in `auth/google.ts`.
- Vite `base` is `/notes-dot-md/`. Use relative or `import.meta.env.BASE_URL`-based paths, never hard-coded `/` roots.

## UI and design rules

The UI must look and behave the same everywhere. Before adding any control, look for an existing component that does the job and reuse it; only add a new one when nothing fits, and then use it everywhere that kind of control appears.

**Shared components (`src/ui/`). Use these, never a one-off version:**

| Need | Use |
| --- | --- |
| Rename something (note title, category name) | `InlineName`: edit in place; Enter or leaving saves, Escape cancels. Never a dialog or a "Rename" button. With `wrap`, long names wrap instead of being cut off (board card titles). Non-editable names (General, All notes, read-only notes) use it with `readonly` so they line up. |
| An icon action (pin, delete, back, sort...) | `IconButton` (44×44). Icons come only from `ICONS` in `ui/icons.ts` (drawn by `Icon.svelte`, or `iconSvg()` in editor widgets); add new icons there. No inline `<svg>` anywhere else. |
| Ask for a new name | `NameDialog` (creating things only). |
| A short list of choices under a button (heading levels, New note or board) | `Menu`: opens under its button, closes on a tap outside or Escape. |
| Confirm a choice with consequences | `confirm()` only for bulk or hard-to-undo actions (e.g. moving all of a category's notes). |
| Feedback after an action | `Toast`, with Undo for anything undoable. Inside an open dialog, render it in the dialog (the rest of the page can't be tapped then). |
| Pick one filter from a row (categories, board tags) | `Chip` inside a `ChipRow` (wraps on desktop, scrolls sideways on phones). |
| Swipe actions on a touch screen row | `SwipeItem`: swipe left opens a Delete button to tap (never delete on release); swipe right pins, where pinning exists. |

**Same action, same control.** Delete is always the trash `IconButton` (plus `SwipeItem` on touch screens) and offers Undo, or confirms as above. Pin is always the pin icon. If two places do the same thing, they use the same component, icon, wording and order.

**Layout.**
- Any text that can be long (note titles, category names, file names) sits in a `flex: 1; min-width: 0` box with ellipsis, and the full text in a `title` tooltip. Controls next to it are compact (icon buttons), so the text keeps the room: a note card or a 300px sidebar must show at least ~20 characters of a name.
- Buttons that only matter with a mouse show on hover, under `@media (hover: hover) and (pointer: fine)`; touch screens use swipes or another place instead. Every button that shows on hover uses the shared `.reveal` style from `app.css` (`reveal-host` on the item, `reveal` on the buttons, `mouse-only` when touch screens shouldn't show them): it sweeps in from the side, anchored at the item's top right.
- Never use text-link buttons ("Rename", "Delete") for actions that have an icon; never let a row of controls squeeze its label.
- Keep it calm: no extra bars or borders when spacing does the job, one accent color for the current choice.
- Motion: interactive elements fade their hover color (`transition` ~120ms); larger moves are 180–220ms slides. `app.css` turns all motion off under `prefers-reduced-motion`.
- Colors, fonts and the scrollbar come from the tokens in `app.css`, each color with a light and a dark value; no hard-coded colors in components (white text on the colored swipe actions and on the dark image view are the exceptions). Font tokens: `--font-body` (note text), `--font-ui` / `--font-heading` (app UI), `--font-mono`.
- Touch targets are at least 44×44px; inputs and the editor use at least 16px text (smaller makes iPhone Safari zoom in on focus).

**Check every UI change visually before committing.** Make a temporary `harness.html` in the repo root that mounts the changed components with sample data (`drive/fakeDrive.ts` can stand in for Drive), serve it with `npx vite --port <free port>`, and screenshot it with headless Firefox (`firefox --headless --no-remote --profile <scratch dir> --window-size=W,H --screenshot out.png <url>`; a profile `user.js` with `user_pref("ui.systemUsesDarkTheme", 1);` gives dark mode), or with Chromium through Playwright where Firefox isn't installed. Cover:
- desktop at 1280px (two columns of note cards) and 1000px (one column), and phone (390px wide). Headless Firefox reports no mouse, so add `user_pref("ui.primaryPointerCapabilities", 6);` to the profile to see hover-only controls;
- light and dark;
- long content: a 40+ character note title and category name, many categories, an empty list.
Look at every screenshot, fix what's off, and delete `harness.html` before committing.

## Testing

- **Unit tests (Vitest)** for pure logic: format commands (wrap/unwrap, line prefixes, list switching), markdown and board helpers, and the Drive layer against `drive/fakeDrive.ts`.
- **Never call the real Google APIs in automated tests.**
- Editor commands: test by creating an `EditorState`, applying the command, and asserting on the resulting document text and selection.
- Live preview and mobile behavior need manual testing. Mobile keyboards can misbehave around hidden text, so include a phone check in the manual test steps for any editor change.
