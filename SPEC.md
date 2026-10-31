# notes.md — Spec

## Overview

**notes.md** is a web app for writing notes in markdown, with every note stored as a plain `.md` file in the user's Google Drive. It is open source on GitHub in the repo `notes-dot-md`. It runs in the browser on phones and desktop; it is not installed as an app (no PWA, decided 2026-10-30). The primary desktop is EndeavourOS with Hyprland.

**Guiding principle: the file is always plain markdown.** The editor renders markdown inline (live preview), but the document text never changes form. Copying, exporting and Drive all see exactly the same markdown.

Goals for v1:

- Google Drive is the only storage. No backend, no database.
- One editing mode: live preview. No toggle between editor and preview.
- GitHub-flavored markdown (GFM), including task lists.
- A format bar, categories, sorting, export to `.md`, and copy as markdown.
- A data model ready for two later phases: a task board that replaces Trello, Claude reading and writing notes, and sharing with other people.

Non-goals: offline support (the app requires a network connection) and installing it as an app (PWA). It is used in the browser.

## Tech stack and architecture

The app is a static single-page app that talks to Google Drive straight from the browser. There is no server.

| Layer | Choice |
| --- | --- |
| Build | Vite + TypeScript |
| UI shell (note list, dialogs, toolbar) | Svelte 5 |
| Editor | CodeMirror 6 with `@codemirror/lang-markdown` and the GFM extension from `@lezer/markdown` |
| Code highlighting in fenced blocks | `@codemirror/language-data` |
| Auth | OAuth 2.0 redirect flow for browser apps (`response_type=token`), no library. Changed from the GIS popup token client on 2026-10-29: popups can't hand the token back in iPhone Safari |
| Storage | Google Drive REST API v3 via `fetch` |
| Hosting | GitHub Pages at https://\<username>.github.io/notes-dot-md/, deployed by a GitHub Actions workflow; Vite base set to /notes-dot-md/ |

Suggested module layout:

```
src/
  auth/google.ts         redirect sign-in, getToken(), renewal
  drive/client.ts        fetch wrapper: auth header, retries, 401 handling
  drive/notes.ts         list/read/create/save/rename/move/trash, folder bootstrap
  editor/setup.ts        CodeMirror configuration and keymaps
  editor/livePreview.ts  decoration plugin (rendering rules)
  editor/widgets.ts      checkbox, bullet, rule and image widgets
  editor/tableEdit.ts    table cells, rows and columns as text changes (no DOM)
  editor/tableWidget.ts  the editable table widget
  editor/markdown.ts     markdown helpers: links and references, inline content, tables
  editor/commands.ts     format commands, shared by toolbar and shortcuts
  ui/                    Svelte components: NoteList, Toolbar, NoteHeader,
                         ConflictDialog, Toast
  store/                 app state: current note, note list, sort, save status
```

Keep all markdown logic (parsing helpers, format commands) free of UI code. The later board view reuses it.

## Google Drive storage and auth

Notes live in a `Notes/` folder in My Drive, one `.md` file per note and one subfolder per category. The app uses the full `drive` scope (`https://www.googleapis.com/auth/drive`), so notes created by other tools show up. It is a restricted scope, which works for personal use in testing mode but shows an "unverified app" warning. The app only reads and writes the `Notes/` folder.

```
My Drive/
  Notes/                 app root, created on first sign-in
    General/             default category (called Inbox before 2026-10-30)
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

- Sign in by redirecting to Google's OAuth page (`response_type=token`). Google sends the user back with the token in the URL fragment; read it, check the `state` value, and remove it from the URL right away. Tokens last about an hour.
- Keep the token in memory only, never in `localStorage`.
- A returning user (remembered login hint) is signed in automatically on page load with one `prompt=none` redirect, which has no UI. If Google needs a click, show the sign-in button.
- On a 401 or an expired token, requests wait and a "Session expired · Continue" banner appears. Renewing is a `prompt=none` redirect; it also happens on its own when the user returns to the app with less than 5 minutes left on the token.
- Before any redirect, keep the open note and unsaved text in `sessionStorage` and restore it afterwards (also done when the page is hidden, since iOS may discard background tabs). Never drop unsaved text.

Google Cloud setup (done by hand before milestone 1):

1. Create a Google Cloud project and enable the Google Drive API.
2. Configure the OAuth consent screen as External, in testing mode, with yourself as a test user.
3. Create an OAuth client ID of type Web application.
4. Add authorized JavaScript origins: `http://localhost:5173` and `https://<username>.github.io`. Origins are domain only, so the `/notes-dot-md/` path is not part of them. Add authorized redirect URIs, with the path and trailing slash: `http://localhost:5173/notes-dot-md/` and `https://<username>.github.io/notes-dot-md/`.
5. Put the client ID in `.env` as `VITE_GOOGLE_CLIENT_ID`. It is not a secret.

Because the full scope is used, `Notes/` can contain files the app did not create: `.md` files uploaded by hand or written by other tools, and also non-markdown files and shortcuts. The note list shows only markdown files and ignores the rest. The scope lives in one config constant.

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
| Link | `[text](url)`, `[text][label]`, `[label]` | Link-colored text; Ctrl+click or tap opens it. A reference link needs a matching `[label]: url`; otherwise it is plain text in brackets | Shown dimmed |
| Bare URL | `https://…`, `www.…`, `me@example.com` | Link; `www.` opens over https, emails as `mailto:` | Always visible |
| Link definition | `[label]: url` | Small, muted monospace | Always visible |
| Image | `![alt](url)` or `![alt][label]` | The image (http/https only, at most 24em tall). No usable source or a failed load shows the alt text in a dashed box | Source shown dimmed, image after it |
| Escape | `\*` | The character, without the backslash | Shown dimmed |
| Entity | `&amp;`, `&#169;` | The character | Shown as typed |
| Tag | `#school`, `#work/notes` (after a space or at a line start; letters, digits, `_ - /`, not only digits) | Accent-colored label, in notes and on board cards. Not in code, URLs or HTML | Always the same |
| Bullet list | ` -  ` or ` *  ` | Bullet dot widget | Shown dimmed |
| Numbered list | ` 1.  ` | Number kept, styled | Always visible |
| Task | ` - [ ]  ` / ` - [x]  ` | Clickable checkbox; checked items dimmed and struck | Never: always a checkbox |
| Quote | ` >  ` | Left border, muted text | Shown dimmed |
| Fenced code | ```` ``` ```` | Monospace block, syntax highlighting | Fences dimmed |
| Horizontal rule | `---` | Line widget | Shown dimmed |
| Table | GFM table | Always a table: header row, column alignment from `:--` / `:-:` / `--:`, inline formatting in cells; scrolls sideways when wide. Edited cell by cell (see Tables below) | Monospace text only after "Edit as text", until the cursor leaves it |
| Frontmatter | `---` YAML block at top | Small, muted, foldable | Always visible |

Behavior:

- **Checkbox click:** dispatch a change that swaps `[ ]` and `[x]`. The cursor does not move and the keyboard does not open on mobile.
- **Enter in a list** continues it, including tasks (new line starts with ` - [ ]  `). Use `insertNewlineContinueMarkup`. Enter on an empty item ends the list.
- **Tab / Shift+Tab** indents and outdents list items.
- **Alt+↑ / Alt+↓** move the current list item one line up or down, together with its children. Children are the lines right below the item that are indented further; a blank or unindented line ends them. Blank lines and plain text are passed one line at a time. Moving up from under another item's children jumps above that item; moving down onto an item with children jumps past them. Numbered lists are renumbered. Outside lists the keys move the selected lines. On phones the same moves are format bar buttons. (Added 2026-10-30. Touch-and-hold dragging of list markers was tried and dropped: Safari on iPhone starts selecting text instead.)
- **Shorthand:** typing `[]` right after a list marker expands to ` [ ]  `, and a line starting `-[ ]` is normalized to ` - [ ]  `.
- **Copy and cut** use CodeMirror's default behavior, which copies the document text. Do not add a custom HTML clipboard handler. Copying a rendered checklist must paste as `- [ ] item`.
- **Tables** (like Obsidian, added 2026-10-31) stay tables while editing. Tapping or clicking a cell turns it into a text box with that cell's markdown, and every keystroke writes it back into the cell's place in the line (a `|` typed in a cell is saved as `\|`). Tab / Shift+Tab go to the next / previous cell (Tab in the last cell adds a row), Enter goes to the cell below (a new row from the bottom row), ↑ / ↓ go to the row above or below and out of the table at its edges, Escape goes back to the text after the table. A "+" bar to the right adds a column and one below adds a row (shown on hover with a mouse, and while a cell is being edited). While editing, a tool row adds a row below or a column to the right, deletes the row or column (never the header row or the only column), sets the column's alignment (left / center / right, written as `:--` / `:-:` / `--:`; pressing the current one goes back to the default, since markdown aligns whole columns, not single cells), or shows the table as markdown text ("Edit as text") until the cursor leaves it. A cell's column grows as you type, up to about 20em, then the text wraps. Each change rewrites only the table lines it is about.
- **Text under a table stays text.** In markdown a table runs on until a blank line, so a line typed right under it would become a row. Typing at the table's start or end goes above or below it instead, typing on the line right under it first keeps a blank line, and Enter at the end of a table starts a new paragraph below a blank line.
- **Tapping below the last line** starts a new line there, with the cursor on it, instead of putting the cursor at the end of the last line. After a list, quote or table a blank line goes in between, so the new line is plain text. An empty last line is used as it is.
- **Paste** inserts plain text. One exception: an image copied from a web page (Copy Image; the clipboard holds HTML with only `<img>`) pastes as `![alt](url)`. Converting other pasted HTML to markdown is a later nice-to-have.
- **No comment shortcut:** CodeMirror's Ctrl+/ (toggle comment, `<!-- -->`) is removed. On Nordic and German keyboards Ctrl+Shift+7 arrives as Ctrl+/, and must make a numbered list.
- **Theme** follows `prefers-color-scheme`, with light and dark styles.
- **Fonts:** note text in a gentle serif (Source Serif 4), headings and app UI in a matching sans (Inter), code in JetBrains Mono (the locally installed JetBrainsMono Nerd Font is preferred when present). Fonts are bundled with the app.

Risk: mobile keyboards can misbehave next to hidden text, for example cursor jumps or autocorrect landing in the wrong place. Test on a real phone as soon as the first decorations exist.

## Format bar

The format bar edits the markdown text through the same commands as the keyboard shortcuts (`editor/commands.ts`, and `editor/lists.ts` for moving and indenting). Every format button toggles.

| Button | Type | Shortcut |
| --- | --- | --- |
| Undo / Redo | First in the bar, so they show without scrolling on phones. Same history as the keys | Ctrl+Z / Ctrl+Y (⌘Z / ⌘⇧Z) |
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
| Table | Insert an empty table (header row and one row, two columns) on its own lines, with blank lines around it; its first cell opens for typing. Not a toggle | Ctrl+Alt+T |
| Move up / Move down | Move the list item with its children, or the selected lines | Alt+↑ / Alt+↓ |
| Outdent / Indent | Un-nest or nest a list item; indent other lines | Shift+Tab / Tab |

Toggle behavior:

- **Wrap commands:** wrap the selection. If it is already wrapped, unwrap it. With an empty selection, insert the markers and put the cursor between them.
- **Line prefix commands:** apply to every line the selection touches. If all of them already have that prefix, remove it.
- **Switching list type** replaces the existing prefix. For example, a bullet list becomes a checklist instead of getting both markers. Numbered lists are renumbered in order.
- Buttons call `preventDefault` on `mousedown`/`pointerdown` so the editor keeps focus and the selection.

Placement: under the note title on every screen size, horizontally scrollable on narrow screens. (Changed 2026-10-29 from pinning it above the keyboard on mobile.) For now the app is not resized for the on-screen keyboard, so on iPhone the header and bar can scroll out of view while typing (see To do).

## Organization: categories and sorting

Categories are Drive folders, so the structure the app shows is the same one the user sees in Drive.

- **Note list:** a sidebar on screens ≥ 900px wide (36% of the width, 300–520px), its own screen with back navigation on mobile. On desktop the notes are cards in a grid: two columns when the sidebar has room (cards at least 190px), else one. On phones it is a single list.
- **Default category:** `General` (renamed from `Inbox` on 2026-10-30, which felt like a mail tool). It comes first and cannot be renamed or deleted. On start, a `Notes/Inbox/` folder is renamed to `General` when no `General` exists: same folder id, same notes.
- **Category filter:** "All notes" plus one chip per category folder, with the note count. On phones the chips are one row that scrolls sideways; on desktop they wrap.
- **Account:** no app header bar (dropped in M8 to give the note more room). The top of the note list shows the app name, the signed-in email (when there is room) and a sign-out icon button.
- **Category management:** create and rename. Delete is allowed only when the category is empty; otherwise offer to move its notes to General first.
- **Move a note:** a category dropdown in the note header, which runs the Drive move request.
- **Sort:** Last modified (default, newest first), Created, Title A–Z. Persist the choice in `localStorage`.
- **Search:** client-side filter on titles. Full-text search through Drive's `fullText contains` query is a nice-to-have.
- **Title:** the filename is the source of truth. Editing the title field in the note header renames the file.
- **New note:** created in the selected category (General under "All notes"), titled `Untitled`, with the title field focused.
- **Note or board:** each note in the list shows an icon for its type, the same icons as the header's switch between board and text: next to the category name under "All notes", before the date in a single category. The type is stored on the file as `appProperties.type = "board"`, so the list doesn't have to read every note. The board marker on the first line is what counts: new boards get the property when they are created, and opening or saving a note in the app corrects it (keeping the note's modified time). A note made a board by another tool shows its icon once it has been opened in the app.
- **Pinned notes:** `appProperties.pinned = "true"`, shown in a Pinned section above all other notes. Toggle with the pin button in the note header, the pin button that shows when hovering a note in the list (mouse only), or on touch screens by swiping a note left to right and releasing (like Apple Notes).
- **Delete a note:** the trash button in the note header, the trash button that shows when hovering a note in the list (mouse only), or on touch screens: swipe a note right to left to open a Delete button, then tap it. The swipe alone never deletes (changed 2026-10-30 to avoid accidents); the open button closes on a tap elsewhere or a swipe back. The note moves to the Drive trash, with an Undo toast that takes it back out.

## Export and copy

Both hand over the raw markdown text, unchanged.

- **Export button:** the download icon in the note header, next to pin and delete (also on read-only notes). It builds a `Blob` of the editor text (including unsaved edits) with type `text/markdown` and downloads it as `<title>.md`.
- **Copy:** selecting text and copying (Ctrl+C or the phone's copy menu) uses CodeMirror's default, which copies the markdown source. Select all and copy takes the whole note. There is no separate copy button (dropped 2026-10-30, since native copy already gives markdown).

Acceptance check: copy a rendered checklist from the app and paste it into a GitHub README editor. The result must be `- [ ] item` lines, not plain text or HTML.

## Saving and conflict handling

The app autosaves, and it never silently overwrites a version saved from another device.

- **Autosave** 2 seconds after the last keystroke, plus on Ctrl+S, on editor blur, and when the page becomes hidden (`visibilitychange`).
- **Save status** in the note header, under the title next to the category: Saved · Saving… · Unsaved changes · Couldn't save.
- **Conflict check:** store the file's `version` from the last load or save. Before each save, fetch `fields=version,modifiedTime`. If the version changed, do not save. Open a dialog with three choices: Load theirs, Keep mine (overwrite), Save mine as a copy.
- **On window focus,** re-check the open note. If it changed elsewhere and there are no unsaved local edits, reload it silently.
- **Network errors:** retry with backoff (2 s, 5 s, 15 s), then show "Couldn't save" with a retry button. Keep the text in the editor.
- **Leaving the page** with unsaved changes triggers the browser's `beforeunload` warning.

## Mobile

The app must feel good in a phone browser and on a Linux desktop. It runs in the browser only: no web manifest, no service worker, no install.

- **Viewport:** `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=resizes-content">`.
- **No zoom:** pinch and double-tap zoom are turned off (owner decision, 2026-10-29): `touch-action: pan-x pan-y`, plus cancelling Safari's gesture events, since iPhone Safari ignores `user-scalable=no`. Text inputs and the editor still use a font size of at least 16px so focusing them never zooms.
- **Layout:** two panes (list + editor) at ≥ 900px wide, one pane below that. The note header (title, category · status, actions) and the format bar form one block above the note, lined up with the note text column (760px max). On phones the note slides in from the right and the list from the left.
- **Motion:** short and quiet: 120ms color fades on hover, 180–220ms slides. With `prefers-reduced-motion`, all of it is instant.
- **Icons:** `favicon.svg`, a 32px PNG fallback and a 180px `apple-touch-icon.png` (Safari bookmarks and favorites).
- **Touch targets** of at least 44 × 44px for toolbar buttons and checkboxes.
- **Test targets:** a mobile browser on a phone (currently Safari on iPhone); Chromium and Firefox on Linux (Wayland/Hyprland). On Hyprland the app can also run as `chromium --app=<url>`.

## Later phase: task board (Trello replacement)

A board is just another markdown note, shown as columns of cards. The same file still opens in the normal editor, and Claude or any other tool can edit it as text. Every card holds full markdown: text, subtasks, images, code, tables. (Format decided 2026-10-31.)

File format:

```markdown
<!-- notes.md:board -->

# Todo

## Write internship report
#school 📅 2026-11-03

Description of the task.

- [ ] Outline
- [ ] First draft

More details.

## Email supervisor
#school

# Ongoing

# Done
```

- **Board marker:** a file whose first line is `<!-- notes.md:board -->` opens in board view by default, with a toggle to open it as text. The board's name is the note title (the filename), as for any note.
- **Columns** = `# ` headings, in file order. Empty columns are allowed. A space must follow the hashes (as in `# Todo`), so `#tag` is never a column or card.
- **Cards** = `## ` headings under a column. The card title is the heading text.
- **Card body** = every line after the card heading up to the next `#` or `##` heading. Any markdown is allowed, with no indentation needed. Headings inside a card start at `###`.
- **Metadata line (optional):** the first non-empty line of the body, if it holds only `#tag` labels and a due date `📅 YYYY-MM-DD`. Tags get the accent tag style (as everywhere); the due date shows as a gray chip. The date picker in the app inserts the `📅` date, so nobody has to type the emoji.
- **Done** = the card is in the board's last column (not counting `# Archive`). Cards have no checkbox of their own; task items inside the body are normal checkboxes. The card shows their progress, e.g. "1/2".
- **Text outside cards** (between the marker and the first column, or between a column heading and its first card) is kept as it is and shown at the top of the board or column.
- **New board** (a button like New note, next to it) creates a file with Todo / Ongoing / Done columns.
- **Images** are URLs, as in notes, until uploads are added.
- **Later still:** a "Tasks" view that collects cards and open tasks with due dates from all notes.

### Board view

A board file opens in its own view, not the note editor, with the rules below. The file is still one markdown string: every edit, drag or rename changes only the lines it touches and saves the whole file with the usual conflict check. The "open as text" toggle shows the same file in the normal editor, where any edit is allowed.

**Cards**
- Each card is a box with the title on top and the body below. The body is rendered as markdown with the same live preview as notes (its own small CodeMirror view on the card's lines), so checkboxes toggle and the reveal rule applies.
- **Editing in place:** tapping or clicking the body puts the cursor there. Edits go straight back into the card's lines in the file. The format bar sits under the header as for notes and acts on the card that has (or last had) the cursor. On boards it offers headings 3–6 and adds a due date button.
- **Copy and paste** work as in the normal editor: copying gives the markdown text, and pasting inserts plain text.
- **Title:** edited with `InlineName` (one line). Enter or leaving saves, Escape cancels. It writes only the text after `## `.
- **Card actions:** delete (trash `IconButton`, moves the card's lines into a hidden `# Archive` column at the end of the file, with Undo), and new card (at the bottom of each column; its title field gets focus).

**No headings that split a card.** A `#` or `##` line inside a card body would start a new column or card, so the card editor never creates one:
- Typing `# ` or `## ` at the start of a line turns into `### `. Pasted text has its headings moved down two levels (`#` → `###`, `##` → `####`, capped at `######`). Lines inside fenced code blocks are left alone, because they are not headings.
- The heading buttons in the card's format bar offer levels 3–6 only.
- A newline typed or pasted into the title field ends the edit instead of entering the title.
- This is the one place where the app changes text as it is entered. Rendering still never changes the text (golden rule 1).
- Agents follow the same rule; the format README in the notes folder says so.

**Drag and drop**
- A card is dragged by its title row (on touch, press and hold for about 300ms, so scrolling still works). The body is for editing, not dragging.
- Dropping moves the card's exact lines (heading + body) to the new place, then saves. Nothing else in the file changes.
- While dragging, the board scrolls when the card nears an edge.
- Columns are dragged by their heading to reorder them, with a mouse or (press and hold) on touch: sideways on desktop, up and down on phones where they are stacked. This moves the column's lines.

**Columns** (added 2026-10-31)
- **Rename:** tap or click the column title (`InlineName`). It writes only the text after `# `. "Archive" is refused, since that name hides a column.
- **Add:** "Add column" after the last column adds `# Untitled` before the hidden Archive and puts the cursor in its title.
- **Delete:** the trash `IconButton` in the column header (on hover with a mouse, always on touch). The column's cards move to the Archive column in order, and any text between its heading and first card becomes an archived card with the column's title, so no text is lost. A column with cards asks to confirm first; either way there is an Undo toast.

**Filter by tag** (added 2026-10-31)
- When cards use `#tags` (in the title or body, not in code), a row of chips above the columns shows "All cards" and each tag with how many cards have it, most used first. Choosing a tag shows only the cards that have it (any case); choosing it again or "All cards" shows all. Column counts show the cards shown.
- The filter is not saved; it resets when the board is opened again.
- A card added while filtering gets the tag as its first line, so it doesn't vanish.
- Drag and drop still works while filtering: a card dropped between shown cards lands between them in the file, with hidden cards kept in place.

**Layout**
- **Desktop (≥ 900px):** like Trello. Columns side by side, about 280px wide, and the board scrolls sideways. Each column scrolls on its own when it is taller than the screen. Cards show their full body.
- **Phone (< 900px):** vertical. Columns are stacked top to bottom as sections, each with its heading and then its cards, full width. The whole page scrolls as one list.
- Colors, fonts, motion and touch targets follow the same tokens and rules as the rest of the app.

The parser and the card move/replace helpers live in `editor/markdown.ts` (or a sibling module without DOM code) and are unit-tested with sample boards, including cards with code blocks: a `#` line inside a fenced code block is not a heading.

What v1 must already get right for this: GFM task lists, heading rendering, and markdown helpers kept separate from the UI.

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
- [x] **M1 Sign-in:** redirect sign-in, sign in and sign out, token renewal. *Done when* sign-in works on desktop and mobile, and a save made more than an hour after sign-in still succeeds.
- [x] **M2 Drive layer:** `drive/notes.ts` with list, read, create, save, rename, move and trash; `Notes/` and the default category folder created on first run. *Done when* a note created in the app appears in Drive as a `.md` file and survives a round trip.
- [x] **M3 Plain editor and saving:** CodeMirror without rendering rules, autosave, save status, conflict dialog. *Done when* edits reach Drive within 3 seconds, and editing the same note on two devices shows the conflict dialog.
- [x] **M4 Live preview:** every rendering rule in the editor table, checkbox widgets, list continuation, the `[]` shorthand. *Done when* all rules render, markers reappear on the active line, checkboxes toggle, and a copied checklist pastes into GitHub as `- [ ]` lines. Tested on a phone.
- [x] **M5 Format bar:** all buttons and shortcuts with toggle behavior, pinned above the keyboard on mobile. *Done when* each button applies and removes its format and the selection survives a tap.
- [x] **M6 Organization:** category filter and management, move note, sort, title search. *Done when* folders in Drive match categories in the app and the sort choice survives a reload.
- [ ] **M7 Export and GFM rendering:** export button; rendered tables and images, reference links, escapes and entities (copy stays native, no button). *Done when* the exported file opens unchanged in another editor, and tables and images render in the editor while their text stays plain markdown.
- [x] **M8 Polish:** responsive layout and dark mode pass, favicon. No PWA. *Done when* the app looks and works right in Safari on iPhone and in Chromium and Firefox on Linux, at every width.
- [x] **M9 Task board:** board view for files starting with `<!-- notes.md:board -->`. *Done when* cards can be edited, renamed, added, deleted (to Archive) and dragged between columns on desktop and phone, and every change shows up as the expected lines in the text view.
- [ ] **Later — M10 Claude access:** route B, then route C.
- [ ] **Later — M11 Sharing:** steps 1–3 of the sharing section.

## Out of scope and open questions

Out of scope for v1: offline editing, installing as an app (PWA), real-time collaboration, uploading images and attachments (images are shown from URLs only), footnotes, GitHub alerts (`> [!NOTE]`), rendering inline HTML, nested categories, a version history view (Drive keeps revisions), and sharing.

Open questions:

- [x] Keep `drive.file`, or switch to the full `drive` scope so notes created by Claude or other tools show up? **Decided 2026-10-29: full `drive` scope.** The notes on `drive.file` limits in the later-phase sections no longer apply.
- [x] Due date syntax for board cards? **Decided 2026-10-31: `📅 YYYY-MM-DD`** (see task board).
- [ ] Use a custom domain instead of `<username>.github.io/notes-dot-md/`?

To do (later):

- [ ] **More table editing:** drag rows and columns to reorder them, set a column's alignment, sort by a column, and keep the pipes aligned in the text.
- [ ] **Paste image data** (screenshots, photos, and images copied on iPhone, which often come without a URL): upload the image to Drive next to the note and insert `![alt](…)` pointing at it. Needs a way to show Drive images (they are not public URLs).
- [ ] **Keep the header and format bar visible above the iPhone keyboard.** Goal: like Apple Notes, the header and bar stay at the top and the note area shrinks to fit above the keyboard, with the cursor line kept visible. Tried on 2026-10-29: (1) sizing the app to the `visualViewport` and following its `offsetTop` made the tapped line end up hidden; (2) adding a scroll-cursor-into-view step after each resize made the screen flicker until the editor was tapped again, likely a loop between Safari panning the page, the app scrolling it back and the editor scrolling. Needs testing on a real iPhone; ideas: only react to `resize` (not `scroll`), avoid `window.scrollTo`, debounce until the keyboard animation ends, or remember the keyboard height and shrink before Safari pans.

## Handing this to Claude Code

Export this doc as Markdown, save it in the repo as `SPEC.md`, and add a `CLAUDE.md` that points to it. Then ask Claude Code to build one milestone at a time and stop after each one for testing.
