# notes.md — Spec

## Overview

**notes.md** is a web app for writing notes in markdown, with every note stored as a plain `.md` file in the user's Google Drive. It is open source on GitHub in the repo `notes-dot-md`. It runs in any browser and installs as a PWA on Android and desktop. The primary desktop is EndeavourOS with Hyprland.

**Guiding principle: the file is always plain markdown.** The editor renders markdown inline (live preview), but the document text never changes form. Copying, exporting and Drive all see exactly the same markdown.

Goals for v1:

- Google Drive is the only storage. No backend, no database.
- One editing mode: live preview. No toggle between editor and preview.
- GitHub-flavored markdown (GFM), including task lists.
- A format bar, categories, sorting, export to `.md`, and copy as markdown.
- A data model ready for two later phases: a task board that replaces Trello, Claude reading and writing notes, and sharing with other people.

Non-goal: offline support. The app requires a network connection.

## Tech stack and architecture

The app is a static single-page app that talks to Google Drive straight from the browser. There is no server.

| Layer | Choice |
| --- | --- |
| Build | Vite + TypeScript |
| UI shell (note list, dialogs, toolbar) | Svelte 5 |
| Editor | CodeMirror 6 with `@codemirror/lang-markdown` and the GFM extension from `@lezer/markdown` |
| Code highlighting in fenced blocks | `@codemirror/language-data` |
| Auth | Google Identity Services token client (`https://accounts.google.com/gsi/client`) |
| Storage | Google Drive REST API v3 via `fetch` |
| PWA | `vite-plugin-pwa` |
| Hosting | GitHub Pages at https://\<username>.github.io/notes-dot-md/, deployed by a GitHub Actions workflow; Vite base set to /notes-dot-md/ |

Suggested module layout:

```
src/
  auth/google.ts         token client, getToken(), silent refresh
  drive/client.ts        fetch wrapper: auth header, retries, 401 handling
  drive/notes.ts         list/read/create/save/rename/move/trash, folder bootstrap
  editor/setup.ts        CodeMirror configuration and keymaps
  editor/livePreview.ts  decoration plugin (rendering rules)
  editor/widgets.ts      checkbox, bullet and horizontal-rule widgets
  editor/commands.ts     format commands, shared by toolbar and shortcuts
  ui/                    Svelte components: NoteList, Toolbar, NoteHeader,
                         ConflictDialog, Toast
  store/                 app state: current note, note list, sort, save status
```

Keep all markdown logic (parsing helpers, format commands) free of UI code. The later board view reuses it.

## Google Drive storage and auth

Notes live in a `Notes/` folder in My Drive, one `.md` file per note and one subfolder per category. The app uses the `drive.file` scope (`https://www.googleapis.com/auth/drive.file`), which needs no Google app verification.

```
My Drive/
  Notes/                 app root, created on first sign-in
    Inbox/               default category
    School/
    Projects/
      Drive layer.md
```

Storage rules:

- A note is one file. Filename = `<title>.md`, mimeType `text/markdown`.
- A category is a direct subfolder of `Notes/`. One level only in v1.
- Tag every file and folder the app creates with `appProperties: { app: "mdnotes" }`.
- Find the root on start with `name='Notes' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`. Cache its id in `localStorage`.
- Deleting a note moves it to the Drive trash (`trashed: true`). The app never hard-deletes.
- Sanitize filenames: strip `/ \ : * ? " < > |`, and add `  (2) ` on duplicates.

Drive API calls:

| Action | Request |
| --- | --- |
| List notes in a category | `GET /drive/v3/files?q='<folderId>' in parents and trashed=false&fields=files(id,name,createdTime,modifiedTime,version,parents,appProperties)` |
| Read a note | `GET /drive/v3/files/{id}?alt=media` |
| Create a note | `POST /upload/drive/v3/files?uploadType=multipart` (metadata + content) |
| Save content | `PATCH /upload/drive/v3/files/{id}?uploadType=media` |
| Rename | `PATCH /drive/v3/files/{id}` with `{ name }` |
| Move to another category | `PATCH /drive/v3/files/{id}?addParents=<new>&removeParents=<old>` |
| Delete | `PATCH /drive/v3/files/{id}` with `{ trashed: true }` |

Token handling:

- Request an access token with the GIS token client. Tokens last about an hour.
- Keep the token in memory only, never in `localStorage`.
- On a 401, request a new token with `prompt: ''`. This is silent while the Google session is alive. Queue the failed request and retry it once.
- If silent refresh fails, show a "Sign in again" banner. Never drop unsaved text.

Google Cloud setup (done by hand before milestone 1):

1. Create a Google Cloud project and enable the Google Drive API.
2. Configure the OAuth consent screen as External, in testing mode, with yourself as a test user.
3. Create an OAuth client ID of type Web application.
4. Add authorized JavaScript origins: `http://localhost:5173` and `https://<username>.github.io`. Origins are domain only, so the `/notes-dot-md/` path is not part of them.
5. Put the client ID in `.env` as `VITE_GOOGLE_CLIENT_ID`. It is not a secret.

Known limit of `drive.file`: the app only sees files it created or that the user explicitly opened with it. A `.md` file uploaded to `Notes/` some other way will not show up. Keep the scope in one config constant so it can be widened later (see the Claude section).

## Editor: live preview

There is one editing mode. The document is markdown text in CodeMirror 6, and a decoration plugin draws it as formatted text (like Obsidian's live preview). Typing ` - [ ]  ` turns into a checkbox right away, and copying it still gives ` - [ ]  `.

Implementation:

- A `ViewPlugin` walks the syntax tree for the visible ranges and builds a `DecorationSet`. Rebuild on `docChanged`, `viewportChanged` and `selectionSet`.
- `Decoration.mark` styles text (bold, heading size). `Decoration.replace` hides syntax markers. `Decoration.replace` with a `WidgetType` draws checkboxes, bullets and rules.
- **Reveal rule:** markers are hidden except on the line(s) the cursor or selection touches. There they show as dimmed text so the user can edit them. Checkboxes are the exception and always render as checkboxes.
- Rendering must never change the document text. All formatting lives in decorations.

Rendering rules:

| Element | Markdown | Rendered as | Markers on active line |
| --- | --- | --- | --- |
| Heading 1–6 | ` #  ` … ` ######  ` | Bold, larger text, size per level | Shown dimmed |
| Bold | `**text**` | Bold | Shown dimmed |
| Italic | `*text*` or `_text_` | Italic | Shown dimmed |
| Strikethrough | `~~text~~` | Struck through | Shown dimmed |
| Inline code | `` `code` `` | Monospace with a tinted background | Shown dimmed |
| Link | `[text](url)` | Link-colored text; Ctrl+click or tap opens it | Shown dimmed |
| Bullet list | ` -  ` or ` *  ` | Bullet dot widget | Shown dimmed |
| Numbered list | ` 1.  ` | Number kept, styled | Always visible |
| Task | ` - [ ]  ` / ` - [x]  ` | Clickable checkbox; checked items dimmed and struck | Never: always a checkbox |
| Quote | ` >  ` | Left border, muted text | Shown dimmed |
| Fenced code | ```` ``` ```` | Monospace block, syntax highlighting | Fences dimmed |
| Horizontal rule | `---` | Line widget | Shown dimmed |
| Table | GFM table | v1: monospace text only | Always visible |
| Frontmatter | `---` YAML block at top | Small, muted, foldable | Always visible |

Behavior:

- **Checkbox click:** dispatch a change that swaps `[ ]` and `[x]`. The cursor does not move and the keyboard does not open on mobile.
- **Enter in a list** continues it, including tasks (new line starts with ` - [ ]  `). Use `insertNewlineContinueMarkup`. Enter on an empty item ends the list.
- **Tab / Shift+Tab** indents and outdents list items.
- **Shorthand:** typing `[]` right after a list marker expands to ` [ ]  `, and a line starting `-[ ]` is normalized to ` - [ ]  `.
- **Copy and cut** use CodeMirror's default behavior, which copies the document text. Do not add a custom HTML clipboard handler. Copying a rendered checklist must paste as `- [ ] item`.
- **Paste** inserts plain text. Converting pasted HTML to markdown is a later nice-to-have.
- **Theme** follows `prefers-color-scheme`, with light and dark styles.

Risk: Android keyboards (Gboard) can misbehave next to hidden text, for example cursor jumps or autocorrect landing in the wrong place. Test on a real Android phone as soon as the first decorations exist.

## Format bar

The format bar edits the markdown text through the same commands as the keyboard shortcuts (`editor/commands.ts`). Every button toggles.

| Button | Type | Shortcut |
| --- | --- | --- |
| Bold | Wrap `**` | Ctrl+B |
| Italic | Wrap `*` | Ctrl+I |
| Strikethrough | Wrap `~~` | Ctrl+Shift+X |
| Inline code | Wrap `` ` `` | Ctrl+E |
| Link | Wrap as `[text](url)`, cursor placed in `url` | Ctrl+K |
| Heading (H1/H2/H3 menu) | Line prefix ` #  ` / ` ##  ` / ` ###  ` | Ctrl+Alt+1/2/3 |
| Bullet list | Line prefix ` -  ` | Ctrl+Shift+8 |
| Numbered list | Line prefix ` 1.  `, ` 2.  `, … | Ctrl+Shift+7 |
| Checklist | Line prefix ` - [ ]  ` | Ctrl+Shift+9 |
| Quote | Line prefix ` >  ` | Ctrl+Shift+. |
| Code block | Wrap lines in ```` ``` ```` fences | Ctrl+Alt+C |

Toggle behavior:

- **Wrap commands:** wrap the selection. If it is already wrapped, unwrap it. With an empty selection, insert the markers and put the cursor between them.
- **Line prefix commands:** apply to every line the selection touches. If all of them already have that prefix, remove it.
- **Switching list type** replaces the existing prefix. For example, a bullet list becomes a checklist instead of getting both markers. Numbered lists are renumbered in order.
- Buttons call `preventDefault` on `mousedown`/`pointerdown` so the editor keeps focus and the selection.

Placement: sticky at the top on desktop. On mobile, pinned just above the on-screen keyboard (use the `visualViewport` API) and horizontally scrollable.

## Organization: categories and sorting

Categories are Drive folders, so the structure the app shows is the same one the user sees in Drive.

- **Note list:** a sidebar on screens ≥ 900px wide, its own screen with back navigation on mobile.
- **Category filter:** "All notes" plus one entry per category folder. Show the note count per category.
- **Category management:** create and rename. Delete is allowed only when the category is empty; otherwise offer to move its notes to Inbox first.
- **Move a note:** a category dropdown in the note header, which runs the Drive move request.
- **Sort:** Last modified (default, newest first), Created, Title A–Z. Persist the choice in `localStorage`.
- **Search:** client-side filter on titles. Full-text search through Drive's `fullText contains` query is a nice-to-have.
- **Title:** the filename is the source of truth. Editing the title field in the note header renames the file.
- **New note:** created in the selected category (Inbox under "All notes"), titled `Untitled`, with the title field focused.
- **Pinned notes (nice-to-have):** `appProperties.pinned = "true"`, shown at the top of the list.

## Export and copy

Both features hand over the raw markdown text, unchanged.

- **Export button:** build a `Blob` of the note text with type `text/markdown` and trigger a download named `<title>.md`.
- **Copy button:** `navigator.clipboard.writeText(text)` copies the whole note as markdown, then shows a short "Copied as markdown" toast.
- **Copying a selection** (Ctrl+C or the mobile copy menu) uses CodeMirror's default, which copies the markdown source of the selection.

Acceptance check: copy a rendered checklist from the app and paste it into a GitHub README editor. The result must be `- [ ] item` lines, not plain text or HTML.

## Saving and conflict handling

The app autosaves, and it never silently overwrites a version saved from another device.

- **Autosave** 2 seconds after the last keystroke, plus on Ctrl+S, on editor blur, and when the page becomes hidden (`visibilitychange`).
- **Save status** in the note header: Saved · Saving… · Unsaved changes · Couldn't save.
- **Conflict check:** store the file's `version` from the last load or save. Before each save, fetch `fields=version,modifiedTime`. If the version changed, do not save. Open a dialog with three choices: Load theirs, Keep mine (overwrite), Save mine as a copy.
- **On window focus,** re-check the open note. If it changed elsewhere and there are no unsaved local edits, reload it silently.
- **Network errors:** retry with backoff (2 s, 5 s, 15 s), then show "Couldn't save" with a retry button. Keep the text in the editor.
- **Leaving the page** with unsaved changes triggers the browser's `beforeunload` warning.

## Mobile and PWA

The app must feel native on an Android phone and on a Linux desktop.

- **PWA:** web manifest (name, icons 192/512 px, `display: standalone`, theme color) with start\_url and scope set to /notes-dot-md/, and a minimal service worker that caches the app shell for installability. Notes are not cached.
- **Viewport:** `<meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content">`. Do not block pinch zoom.
- **No unwanted zoom:** text inputs and the editor use a font size of at least 16px, and `html, body` set `touch-action: manipulation`.
- **Layout:** two panes (list + editor) at ≥ 900px wide, one pane below that.
- **Touch targets** of at least 44 × 44px for toolbar buttons and checkboxes.
- **Test targets:** Chrome on Android; Chromium and Firefox on Linux (Wayland/Hyprland). On Hyprland the app can also run as `chromium --app=<url>`.

## Later phase: task board (Trello replacement)

A board is just another markdown note, shown as columns of cards. The same file still opens in the normal editor, and Claude or any other tool can edit it as text. This follows the same idea as the Obsidian Kanban plugin's format.

File format:

```markdown
---
type: board
---

## Todo

- [ ] Write internship report #school @2026-11-03
    - [ ] Outline
    - [ ] First draft
- [ ] Email supervisor

## Doing

- [ ] Build Drive layer #notes-app

## Done

- [x] Set up Google Cloud project
```

- A file with `type: board` in its frontmatter opens in board view by default, with a toggle to open it as text.
- **Columns** = ` ##  ` headings, in file order. **Cards** = top-level task items under a heading.
- **Card details** = lines indented under the item: subtasks, notes, links. Shown when the card is opened.
- **Metadata inline:** `#tag` for labels and `@YYYY-MM-DD` for due dates. Both render as chips.
- **Drag and drop** moves the card's lines (item + indented children) to another section, then saves. Must work with touch. Use SortableJS or pointer events.
- **Checking a card** sets `[x]`. Optional per board: moving a card to the last column checks it.
- **New board** creates a file with Todo / Doing / Done columns.
- **Later still:** a "Tasks" view that collects open tasks with due dates from all notes.

What v1 must already get right for this: GFM task lists, frontmatter rendering, and markdown helpers kept separate from the UI.

## Later phase: letting Claude write in the notes

Yes, this is possible, and because notes are plain `.md` files in Drive there are several routes. **Recommendation:** use route B (Claude Code + an rclone mount) now for free, and build route C (your own connector) once the board exists, if you want Claude to edit notes from the Claude app on your phone.

| Route | How it works | Claude can | Effort |
| --- | --- | --- | --- |
| A. Google Drive connector in claude.ai | The built-in connector, already available | Read notes, create new files, rename and move files. Its update tool changes metadata only, so it **cannot edit an existing note's text** | None |
| B. Claude Code on your Linux machine | `rclone mount` Google Drive to e.g. `~/Notes`; Claude Code edits the `.md` files directly | Full read and edit of any note or board, from the terminal | Low |
| C. Own MCP server as a custom connector | A small remote server exposing note tools over the Drive API, added in claude.ai under Customize → Connectors | Format-aware edits (add a card, check a task, append to a note) from claude.ai, desktop and the mobile app | Medium–high |
| D. "Ask Claude" inside the app | The app calls the Claude API from the browser with your own API key | Rewrite, summarize or extend the open note in place | Medium; pay per use |

Notes per route:

- **A:** fine for reading and asking questions about notes. Files it creates are invisible to the app under `drive.file`.
- **B:** files changed through rclone stay the same Drive files, so the app keeps seeing them. Files rclone *creates* are invisible to the app under `drive.file`, like A.
- **C:** custom connectors must be reachable from the public internet; they can be authless or use OAuth, and they work on Free (one connector), Pro, Max, Team and Enterprise plans ([Anthropic help article](https://support.anthropic.com/en/articles/11176164-pre-built-connectors-using-remote-mcp), [setup guide](https://help.boomi.com/docs/Atomsphere/Platform/Connect_claude_setup)). The same server also works in Claude Code with `claude mcp add --transport http`. Host it on Cloudflare Workers or similar, using the **same Google Cloud project** as the web app; `drive.file` access should then cover files created by either (verify early). Suggested tools: `list_notes`, `read_note`, `create_note`, `append_to_note`, `replace_in_note`, `add_card`, `move_card`, `check_task`.
- **D:** a browser call to the Claude API needs the `anthropic-dangerous-direct-browser-access: true` header. The API key stays in the browser, which is acceptable only for a personal app.

Design rule for v1 so every route works: notes stay plain markdown with no app-only state outside the file, and the app re-reads a note when it changes elsewhere (already covered by the conflict check).

## Later phase: sharing and collaboration

Sharing can stay clean because Drive already handles it; real-time co-editing cannot, because it needs a server. Build it one step at a time and stop when it is good enough.

| Step | What it adds | How | Backend needed |
| --- | --- | --- | --- |
| 1. Drive-native sharing | Share a note or category with someone by email, as viewer or editor | Drive `permissions.create`. The recipient adds it to their notes.md through the Google Picker, which grants `drive.file` access to that file | No |
| 2. Read-only public link | A URL anyone can open to read a note | Set the file to "anyone with the link" and open it on a `/view/<fileId>` route, read with an API key | No |
| 3. Take-turns collaboration | Two people edit the same note at different times, and non-overlapping edits merge automatically | Three-way merge of base, mine and theirs (for example with `diff-match-patch`) instead of always showing the conflict dialog | No |
| 4. Real-time co-editing | Live cursors and simultaneous typing, like Google Docs | Yjs CRDT with the `y-codemirror.next` binding and a WebSocket relay (self-hosted `y-websocket` or a hosted service). Drive keeps the saved `.md` snapshot | Yes |

Recommendation: steps 1–3 fit the no-backend design. Step 4 is only worth it if live co-editing turns out to be a real need.

What v1 should already do so this stays easy:

- Identify notes by Drive file id, never by path or title.
- Keep the text as loaded from Drive (the base) next to the edited text. Step 3 needs it.
- Do not assume the user owns every file. Read `capabilities.canEdit` and show a read-only mode when it is false.
- Keep sharing out of the note text. Permissions live in Drive, not in the markdown.

Open point: whether sharing a whole category folder through the Picker also gives access to the notes inside it under `drive.file`. Test this before building step 1 for categories.

## Milestones

Build in this order. Each milestone ends with a working deployed app and its acceptance criteria checked.

- [x] **M0 Project setup:** Vite + Svelte + TypeScript, ESLint and Prettier, GitHub Actions deploy to GitHub Pages under /notes-dot-md/. *Done when* an empty app shell is live at the Pages URL.
- [ ] **M1 Sign-in:** GIS token client, sign in and sign out, silent token refresh. *Done when* sign-in works on desktop and Android, and a save made more than an hour after sign-in still succeeds.
- [ ] **M2 Drive layer:** `drive/notes.ts` with list, read, create, save, rename, move and trash; `Notes/` and `Inbox/` created on first run. *Done when* a note created in the app appears in Drive as a `.md` file and survives a round trip.
- [ ] **M3 Plain editor and saving:** CodeMirror without rendering rules, autosave, save status, conflict dialog. *Done when* edits reach Drive within 3 seconds, and editing the same note on two devices shows the conflict dialog.
- [ ] **M4 Live preview:** every rendering rule in the editor table, checkbox widgets, list continuation, the `[]` shorthand. *Done when* all rules render, markers reappear on the active line, checkboxes toggle, and a copied checklist pastes into GitHub as `- [ ]` lines. Tested on Android.
- [ ] **M5 Format bar:** all buttons and shortcuts with toggle behavior, pinned above the keyboard on mobile. *Done when* each button applies and removes its format and the selection survives a tap.
- [ ] **M6 Organization:** category filter and management, move note, sort, title search. *Done when* folders in Drive match categories in the app and the sort choice survives a reload.
- [ ] **M7 Export and copy:** export button and copy button with toast. *Done when* the exported file opens unchanged in another editor.
- [ ] **M8 PWA and polish:** manifest, icons, service worker, dark mode, responsive layout. *Done when* the app installs on Android and opens standalone.
- [ ] **Later — M9 Task board:** board view for `type: board` files.
- [ ] **Later — M10 Claude access:** route B, then route C.
- [ ] **Later — M11 Sharing:** steps 1–3 of the sharing section.

## Out of scope and open questions

Out of scope for v1: offline editing, real-time collaboration, images and attachments, nested categories, a version history view (Drive keeps revisions), sharing, and rendered tables.

Open questions:

- [ ] Keep `drive.file`, or switch to the full `drive` scope so notes created by Claude or other tools show up? The full scope is restricted by Google but works for personal use in testing mode. Decide before M2.
- [ ] Due date syntax for board cards: `@2026-11-03` as proposed, or another format?
- [ ] Use a custom domain instead of `<username>.github.io/notes-dot-md/`?

## Handing this to Claude Code

Export this doc as Markdown, save it in the repo as `SPEC.md`, and add a `CLAUDE.md` that points to it. Then ask Claude Code to build one milestone at a time and stop after each one for testing.
