# notes.md

A markdown note-taking web app, used in the browser (no PWA), that stores every note as a plain `.md` file in the user's Google Drive. No backend: the browser talks to the Drive API directly. Hosted on GitHub Pages at `https://<username>.github.io/notes-dot-md/`.

**The full spec is in `SPEC.md`. Read the relevant sections before starting any milestone.** This file covers how to work in the repo; SPEC.md covers what to build.

## Golden rules

1. **The document is always plain markdown.** The live-preview editor only *decorates* text (CodeMirror decorations). Never transform, normalize or re-serialize the document text to render it. Copy, export and Drive all see the exact same string.
2. **No backend.** Everything runs in the browser. Do not add a server, database or serverless function without asking.
3. **Never lose user text.** On any save or auth failure, keep the text in the editor and show an error state. Never overwrite a newer Drive version silently (see "Saving and conflict handling" in SPEC.md).
4. **Never hard-delete.** Deleting a note or category moves it to the Drive trash (`trashed: true`).
5. **Access tokens stay in memory.** Never write tokens to `localStorage`, `sessionStorage`, cookies or logs.
6. **Notes are identified by Drive file id**, never by path or title.

## Workflow

- Build **one milestone at a time**, in the order listed in SPEC.md (M0, M1, ...).
- When a milestone is done: run checks, commit, then **stop**. Summarize what changed and list the manual test steps for its acceptance criteria. Do not start the next milestone until asked.
- If the spec is unclear or seems wrong, ask instead of guessing. Do not add features that are not in the spec; suggest them instead.
- Keep changes small and focused. Prefer editing existing modules over adding new layers of abstraction.

## Stack

Vite + TypeScript (strict) + Svelte 5 · CodeMirror 6 with `@codemirror/lang-markdown` and the GFM extension from `@lezer/markdown` · Google OAuth 2.0 redirect flow (`response_type=token`, no popups) · Google Drive REST API v3 via `fetch` · Vitest.

Package manager: npm.

## Commands

```sh
npm run dev       # dev server at http://localhost:5173/notes-dot-md/
npm run build     # production build to dist/
npm run preview   # serve the production build
npm run check     # svelte-check + tsc
npm run lint      # eslint + prettier --check
npm test          # vitest
```

Run `npm run check`, `npm run lint` and `npm test` before every commit.

## Layout

```
src/
  auth/google.ts         redirect sign-in, getToken(), renewal
  drive/client.ts        fetch wrapper: auth header, retries, 401 handling
  drive/notes.ts         list/read/create/save/rename/move/trash, folder bootstrap
  editor/setup.ts        CodeMirror configuration and keymaps
  editor/livePreview.ts  decoration plugin (rendering rules)
  editor/widgets.ts      checkbox, bullet, rule, image and table widgets
  editor/markdown.ts     markdown helpers: links, inline content, tables (no DOM)
  editor/commands.ts     format commands, shared by toolbar and shortcuts
  ui/                    Svelte components
  store/                 app state
```

`editor/commands.ts` and any markdown helpers must stay free of Svelte and DOM code so they can be unit-tested and reused by the future board view.

## Conventions

- TypeScript strict mode; no `any` without a comment explaining why.
- All Drive access goes through `drive/client.ts`. UI code never calls `fetch` for Drive directly.
- Request only the fields you need from Drive (`fields=` parameter).
- The OAuth scope lives in one constant in `auth/google.ts` (currently the full `drive` scope, decided 2026-10-29).
- Vite `base` is `/notes-dot-md/`. Use relative or `import.meta.env.BASE_URL`-based paths, never hard-coded `/` roots.
- Theme colors are CSS custom properties with light and dark values (`prefers-color-scheme`).
- Mobile: inputs and the editor use a font size of at least 16px; touch targets are at least 44px. Pinch zoom is intentionally disabled.
- Fonts are tokens too: `--font-body` (serif, note text), `--font-ui` / `--font-heading` (sans), `--font-mono`.
- Commits: Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).

## UI and design rules

The UI must look and behave the same everywhere. Before adding any control, look for an existing component that does the job and reuse it; only add a new one when nothing fits, and then use it everywhere that kind of control appears.

**Shared components (`src/ui/`). Use these, never a one-off version:**

| Need | Use |
| --- | --- |
| Rename something (note title, category name) | `InlineName`: edit in place; Enter or leaving saves, Escape cancels. Never a dialog or a "Rename" button. Non-editable names (Inbox, All notes, read-only notes) use it with `readonly` so they line up. |
| An icon action (pin, delete, back, sort...) | `IconButton` (44×44). Icons come only from `Icon.svelte`'s `ICONS`; add new icons there. No inline `<svg>` anywhere else. |
| Ask for a new name | `NameDialog` (creating things only). |
| Confirm a choice with consequences | `confirm()` only for bulk or hard-to-undo actions (e.g. moving all of a category's notes). |
| Feedback after an action | `Toast`, with Undo for anything undoable. |

**Same action, same control.** Delete is always the trash `IconButton` (and swipe left on touch), moves to the Drive trash, and offers Undo or confirms as above. Pin is always the pin icon. If two places do the same thing, they use the same component, icon, wording and order.

**Layout.**
- Any text that can be long (note titles, category names, file names) sits in a `flex: 1; min-width: 0` box with ellipsis, and the full text in a `title` tooltip. Controls next to it are compact (icon buttons), so the text keeps the room: in the 300px sidebar a name must show at least ~20 characters.
- Never use text-link buttons ("Rename", "Delete") for actions that have an icon; never let a row of controls squeeze its label.
- Colors, fonts and the scrollbar come from the tokens in `app.css`; no hard-coded colors in components (white text on the colored swipe actions is the one exception).
- Touch targets are at least 44×44px; inputs and the editor use at least 16px text.

**Check every UI change visually before committing.** Make a temporary `harness.html` in the repo root that mounts the changed components with sample data, serve it with `npx vite --port <free port>`, and screenshot it with headless Firefox (`firefox --headless --no-remote --profile <scratch dir> --window-size=W,H --screenshot out.png <url>`; a profile `user.js` with `user_pref("ui.systemUsesDarkTheme", 1);` gives dark mode). Cover:
- desktop (1000px wide, 300px sidebar) and phone (390px wide);
- light and dark;
- long content: a 40+ character note title and category name, many categories, an empty list.
Look at every screenshot, fix what's off, and delete `harness.html` before committing.

## Testing

- **Unit tests (Vitest)** for pure logic: format commands (wrap/unwrap, line prefixes, list switching), markdown helpers, and the Drive client with `fetch` mocked.
- **Never call the real Google APIs in automated tests.**
- Editor commands: test by creating an `EditorState`, applying the command, and asserting on the resulting document text and selection.
- Live preview and mobile behavior need manual testing. Mobile keyboards can misbehave around hidden text, so include a phone check in the manual test steps for any editor milestone.

## Environment

- Copy `.env.example` to `.env` and set `VITE_GOOGLE_CLIENT_ID`. The client ID is not secret, but `.env` stays out of git.
- Authorized JavaScript origins in Google Cloud: `http://localhost:5173` and `https://<username>.github.io` (origins never include the path). Authorized redirect URIs: `http://localhost:5173/notes-dot-md/` and `https://<username>.github.io/notes-dot-md/` (with path and trailing slash).
- Main dev machine: EndeavourOS with Hyprland (Wayland). Test in Chromium and Firefox on Linux, and in a mobile browser on a phone (currently Safari on iPhone).