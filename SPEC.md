# notes.md — Spec

What the app does and how it is built: features, storage, stack, milestones and what is still to do. How to work in the repo (golden rules, code layout, UI rules, testing) is in `CLAUDE.md`; setup and deployment are in `README.md`. Each topic lives in one of these files only.

## Overview

**notes.md** is a web app for writing notes in markdown, with every note stored as a plain `.md` file in the user's Google Drive. It is open source on GitHub in the repo `notes-dot-md`, and runs in the browser on phones and desktop. The golden rules in `CLAUDE.md` hold for everything below.

- Google Drive is the only storage.
- One editing mode: live preview. No toggle between editor and preview.
- GitHub-flavored markdown (GFM), including task lists.
- Notes and task boards (a Trello replacement) are both plain markdown files.

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
| Hosting | GitHub Pages at https://\<username>.github.io/notes-dot-md/, deployed by a GitHub Actions workflow (see README) |

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
- Sanitize filenames: strip `/ \ : * ? " < > |`, and add `  (2) ` on duplicates.

Token handling:

- Sign in by redirecting to Google's OAuth page (`response_type=token`). Google sends the user back with the token in the URL fragment; read it, check the `state` value, and remove it from the URL right away. Tokens last about an hour.
- A returning user (remembered login hint) is signed in automatically on page load with one `prompt=none` redirect, which has no UI. If Google needs a click, show the sign-in button. That first page load only fetches a small entry script (a few kB) that starts the redirect; the app itself is loaded when the page stays (after Google sends the user back, or when there is no remembered account).
- On a 401 or an expired token, requests wait and a "Session expired · Continue" banner appears. Renewing is a `prompt=none` redirect; it also happens on its own when the user returns to the app with less than 5 minutes left on the token.
- Before any redirect, keep the open note and unsaved text in `sessionStorage` and restore it afterwards (also done when the page is hidden, since iOS may discard background tabs).

Because the full scope is used, `Notes/` can contain files the app did not create: `.md` files uploaded by hand or written by other tools, and also non-markdown files and shortcuts. The note list shows only markdown files and ignores the rest.

## Editor: live preview

There is one editing mode. The document is markdown text in CodeMirror 6, and a decoration plugin draws it as formatted text (like Obsidian's live preview). Typing ` - [ ]  ` turns into a checkbox right away, and copying it still gives ` - [ ]  `.

Implementation:

- A `ViewPlugin` walks the syntax tree for the visible ranges and builds a `DecorationSet`. Rebuild on `docChanged`, `viewportChanged` and `selectionSet`.
- `Decoration.mark` styles text (bold, heading size). `Decoration.replace` hides syntax markers. `Decoration.replace` with a `WidgetType` draws checkboxes, bullets and rules.
- **Reveal rule:** markers are hidden except on the line(s) the cursor or selection touches. There they show as dimmed text so the user can edit them. Checkboxes are the exception and always render as checkboxes.

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
| Image | `![alt](url)` or `![alt][label]` | The image (http/https only, at most 24em tall). Images in Drive (`https://drive.google.com/file/d/<id>/view`) aren't public, so they are loaded through the Drive API, like card images. No usable source or a failed load shows the alt text in a dashed box | Source shown dimmed, image after it |
| Escape | `\*` | The character, without the backslash | Shown dimmed |
| Entity | `&amp;`, `&#169;` | The character | Shown as typed |
| Tag | `#school`, `#work/notes` (after a space or at a line start; letters, digits, `_ - /`, not only digits) | A label in its saved color (see Tags), else the accent color, in notes and on board cards. Not in code, URLs or HTML | Always the same |
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
- **Paste** inserts plain text. An image copied from a web page (Copy Image; the clipboard holds HTML with only `<img>`) pastes as `![alt](url)`. A web address (`http://` or `https://`, nothing else on the clipboard) pasted over selected text makes that text a link, `[text](url)`, with the cursor after it (added 2026-11-10); not when the selection spans lines, has brackets, is in code, or is a link or an address already: then the paste replaces it as usual. Converting other pasted HTML to markdown is a later nice-to-have.
- **Images in notes** (added 2026-11-03): pasting or dropping image files (screenshots, photos, images copied on iPhone, which come without a URL), or picking them with the format bar's image button, uploads them like card images (to `Notes/.attachments/`, scaled down the same way) and puts `![](https://drive.google.com/file/d/<fileId>/view)` on a line of its own where the cursor was. That spot moves along with any typing while the upload runs. A toast says "Adding the image…" until it is in.
- **Find in note** (added 2026-11-10): Ctrl+F (⌘F), or "Find in note" in the note header's more menu, opens a find bar above the text: a field, the number of matches ("2 of 9"), previous and next buttons and a close button. Matches are highlighted as you type (any case, the text as typed, not a pattern) and the first one from the cursor on is shown; Enter / Shift+Enter (also F3 and Ctrl+G) step through them, Escape closes the bar. It only finds; there is no replace. The browser's own find can't be used, since the editor only draws the lines near the screen. For notes and boards opened as text; not in board view.
- **No comment shortcut:** CodeMirror's Ctrl+/ (toggle comment, `<!-- -->`) is removed. On Nordic and German keyboards Ctrl+Shift+7 arrives as Ctrl+/, and must make a numbered list.
- **Theme** follows `prefers-color-scheme`, with light and dark styles.
- **Fonts:** note text in a gentle serif (Source Serif 4), headings and app UI in a matching sans (Inter), code in JetBrains Mono (the locally installed JetBrainsMono Nerd Font is preferred when present). Fonts are bundled with the app.

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
| Image (notes only) | Pick photos or image files; each goes in at the cursor (see "Images in notes") | — |
| Move up / Move down | Move the list item with its children, or the selected lines | Alt+↑ / Alt+↓ |
| Outdent / Indent | Un-nest or nest a list item; indent other lines | Shift+Tab / Tab |

Toggle behavior:

- **Wrap commands:** wrap the selection. If it is already wrapped, unwrap it. With an empty selection, insert the markers and put the cursor between them.
- **Line prefix commands:** apply to every line the selection touches. If all of them already have that prefix, remove it.
- **Switching list type** replaces the existing prefix. For example, a bullet list becomes a checklist instead of getting both markers. Numbered lists are renumbered in order.
- Buttons call `preventDefault` on `mousedown`/`pointerdown` so the editor keeps focus and the selection.

Placement: under the note title on every screen size, horizontally scrollable on narrow screens. (Changed 2026-10-29 from pinning it above the keyboard on mobile.) On iPhone it stays at the top while typing (see Mobile, "Keyboard").

## Organization: categories and sorting

Categories are Drive folders, so the structure the app shows is the same one the user sees in Drive.

- **Note list:** a sidebar on screens ≥ 900px wide (36% of the width, 300–520px), its own screen with back navigation on mobile. On desktop the notes are cards in a grid: two columns when the sidebar has room (cards at least 190px), else one. On phones it is a single list. Each card shows the title, a preview line and the date (see below). **Instant start** (added 2026-11-03): the list as last seen (categories, notes with their app properties, the folder ids; no note text, no tokens) is kept in `localStorage` for the signed-in account and shown at once on the next start, while Drive refreshes it in the background (a failed refresh keeps it and says so in a toast). With the folders known from the saved list, that refresh asks for the categories and the notes at the same time (two requests instead of four in a row); if General is no longer among them, the folders are looked up again as on a first start. Signing out clears it. Without a saved list, grey placeholder cards in the same shape stand in while it loads, so the layout doesn't jump. On wider screens the sidebar can be hidden while a note is open (added 2026-11-02): a sidebar icon button at the left of the note header slides it closed or open (200ms), so the note gets the whole width. The choice is remembered on the device (`localStorage`). With no note open, the list always shows. Phones don't show the button (they show one pane at a time).
- **Default category:** `General` (renamed from `Inbox` on 2026-10-30, which felt like a mail tool). It comes first and cannot be renamed or deleted. On start, a `Notes/Inbox/` folder is renamed to `General` when no `General` exists: same folder id, same notes.
- **Category filter:** "All notes" plus one chip per category folder, with the note count. On phones the chips are one row that scrolls sideways; on desktop they wrap.
- **Account:** no app header bar (dropped in M8 to give the note more room). The top of the note list shows the app name, the signed-in email (when there is room) and a sign-out icon button.
- **Category management:** create and rename. Delete is allowed only when the category is empty; otherwise offer to move its notes to General first.
- **Move a note:** a category dropdown in the note header, which runs the Drive move request.
- **Sort:** Last modified (default, newest first), Created, Title A–Z. Persist the choice in `localStorage`.
- **Search:** titles filter as you type (client-side). Once typing pauses (300 ms), the note text is searched too, through Drive's `fullText contains` query on the category folders, plus the notes kept in memory (Drive indexes new text after a delay). Title matches come first; notes found only in their text follow under "In note text". If the text search fails, titles still work and a line says so. Opening a note from the results while a search is typed shows the find bar at the first place the searched text is in the note (the whole search if it is there as typed, else the first of its words that is), without opening the keyboard on phones (added 2026-11-10).
- **Preview line:** each note card shows the first words of the note under the title, in muted text, one line with ellipsis. The text is stored on the file as `appProperties.preview` when the app saves the note, so the list doesn't have to read every note (Drive allows 124 bytes per property, key plus value). Every card keeps this line's room, also boards and empty notes (blank there), so all cards are the same height. Markdown markers are left out, a first heading that repeats the title is skipped, and boards show none. Saving sends the preview in the same request as the text (only when it changed), and opening a note corrects a missing or stale one without changing the note's modified time, like the board mark. Notes changed by another tool show a stale preview until saved in the app.
- **Title:** the filename is the source of truth. Editing the title field in the note header renames the file.
- **Opening a note** (added 2026-11-02): tapping a note shows its screen right away, with the title, category and "Opening…" in the header, the format bar dimmed, and grey placeholders (only if loading takes more than a moment): lines for a note, columns with cards in the board's layout for a board (changed 2026-11-02). The text fades in when Drive has sent it. Tapping another note while one loads opens that one instead; going back to the list while it loads keeps you on the list. If loading fails, the header says "Couldn't open" with a Retry button, and the previous note's text is never shown under the new title. The text of the last 20 opened notes, as last loaded or saved, is kept in memory (not `localStorage`): reopening one shows it at once, then checks its `version` as the window-focus check does (a newer text with no local edits replaces it; local edits follow the usual conflict rules).
- **Address bar:** the open note's Drive file id is in the URL (`#/n/<fileId>`), so a reload reopens the note and a bookmark opens it. On phones, opening a note adds a history entry, so the browser's Back (and the in-app back button) returns to the list; on wider screens, where the list is always shown, the entry is replaced. A start with no note in the URL (a new tab, the home screen) shows the note list; no note is reopened by itself (changed 2026-11-03). A note that is gone or trashed falls back to the list without an error. The sign-in redirect keeps the route in `sessionStorage` and puts it back after Google sends the user back.
- **New note:** the New button opens a menu with Note and Board. A note is created in the selected category (General under "All notes"), titled `Untitled`, with the title field focused. Its screen opens at once and the file is created in the background (changed 2026-11-02): the status says "Creating…", the title and text can be typed right away (the title is given to the file and the text saved as soon as it exists), and pin, delete, export and the category wait until then. Opening another note waits for the file first. If it can't be created, the text stays in the editor with a Retry button, and leaving the note is refused until it is created.
- **Note or board:** each note in the list shows an icon for its type, the same icons as the header's switch between board and text: next to the category name under "All notes", before the date in a single category. The type is stored on the file as `appProperties.type = "board"`, so the list doesn't have to read every note. The board marker on the first line is what counts: new boards get the property when they are created, and opening or saving a note in the app corrects it (keeping the note's modified time). A note made a board by another tool shows its icon once it has been opened in the app.
- **Pinned notes:** `appProperties.pinned = "true"`, shown in a Pinned section above all other notes. Toggle with the pin button in the note header, the pin button that shows when hovering a note in the list (mouse only), or on touch screens by swiping a note left to right and releasing (like Apple Notes).
- **Delete a note:** the trash button in the note header (in its more menu on phones), the trash button that shows when hovering a note in the list (mouse only), or on touch screens: swipe a note right to left to open a Delete button, then tap it. The swipe alone never deletes (changed 2026-10-30 to avoid accidents); the open button closes on a tap elsewhere or a swipe back. The note moves to the Drive trash, with an Undo toast that takes it back out.
- **Recently deleted** (added 2026-11-03): a button at the top of the note list (a trash can with an arrow up, next to sign out) opens a dialog of the notes and boards in the Drive trash that came from the categories (a trashed file keeps its folder), most recently deleted first, with type, category and when. Each has a restore `IconButton` that takes it out of the trash and back into the list. Drive empties its trash after 30 days; the dialog says so. Notes are not deleted for good from here (golden rule 4); that is done in Drive.

## Tags

Tags are `#words` in the text (see the rendering rules), in notes and on board cards alike. (Decided 2026-11-02; saved tags per document since 2026-11-03.)

- **Saved tags:** each note and each board has its own saved tags, each with a color, added in its Tags list. They color that document's tags and are suggested while typing in it; another document with the same tag is not affected. Other tags in the text still work and show in the accent style.
- **Autocomplete:** typing `#` and at least one letter in a note or a card body suggests the document's saved tags first, then the other tags already in it (for a card: the whole board), each with its color. Enter or a tap inserts the tag and a space. Not in code, and not in card titles (they are plain text fields).
- **Colors:** a fixed set of theme colors with light and dark values (red, orange, yellow, green, teal, blue, purple, pink, gray). A saved tag has its color everywhere in its document: in the text, on cards, in the board's tag chips and in the suggestions. Tags are matched without regard to case; saved tags are kept in lower case.
- **Where they are stored:** on the document's own file, one app property per tag (`appProperties["tag.school"] = "green"`), so they sync between devices and go along when a file is shared. The markdown never changes. Drive allows 30 app properties per file and 124 bytes per key and value, so a document has at most 24 saved tags and a tag name at most about 110 characters; the Tags list says so when adding one more. Each change sets only its own property, so changes made on two devices to different tags don't overwrite each other.
- **Tags list:** a tag icon button in the note header (not on read-only notes) opens a dialog with the open document's saved tags only (no usage counts), A–Z. The plus button adds one (`NameDialog`; `#` optional; same characters as a tag; no duplicates); it gets the first color no saved tag has yet, and its swatches open. The dialog closes right away and the tag shows at once; Drive is updated in the background (changes are saved one after another, so quick ones don't overwrite each other; a failed save undoes that change with a message). Tapping a tag shows the swatches; a pick applies at once. The trash button removes a saved tag (the text stays as it is), with an Undo toast, shown inside the dialog while it is open. As in the note list, the trash button shows on hover with a mouse, and on touch screens a tag is swiped left to open a Delete button.
- **Earlier versions:** the saved tags were one list for all documents, in a settings file `Notes/.notes-md.json`; the app no longer reads it (owner decision, 2026-11-03: start fresh) and leaves the file in place. An even earlier version stored each note's tags on its file (`appProperties.tags`); saving or opening a note removes that.

## Export and copy

Both hand over the raw markdown text, unchanged.

- **Export button:** the download icon in the note header, next to pin and delete (also on read-only notes; in the header's more menu on phones, see Mobile). It builds a `Blob` of the editor text (including unsaved edits) with type `text/markdown` and downloads it as `<title>.md`.
- **Copy:** selecting text and copying (Ctrl+C or the phone's copy menu) uses CodeMirror's default, which copies the markdown source. Select all and copy takes the whole note. There is no separate copy button (dropped 2026-10-30, since native copy already gives markdown).

Acceptance check: copy a rendered checklist from the app and paste it into a GitHub README editor. The result must be `- [ ] item` lines, not plain text or HTML.

## Saving and conflict handling

The app autosaves. These rules carry out golden rule 3 (never lose text, never silently overwrite a newer version).

- **Autosave** 2 seconds after the last keystroke, plus on Ctrl+S, on editor blur, and when the page becomes hidden (`visibilitychange`).
- **Save status** in the note header, under the title next to the category: Saved · Saving… · Unsaved changes · Couldn't save.
- **Word count** (added 2026-11-10): after the save status, e.g. "Saved · 312 words", for notes (not boards). It counts words as read: markdown markers, checkboxes, link and image addresses and comments are left out. Updated once typing pauses (300 ms).
- **Conflict check:** store the file's `version` from the last load or save, and the text as loaded or saved (the base). Before each save, fetch `fields=version,modifiedTime`. If the version changed and the content did too (a rename alone also bumps it), merge the edits before saving.
- **Merging edits** (added 2026-11-03; step 3 of sharing): a three-way merge of the base, mine and theirs (`editor/merge.ts`, no library), line by line. Edits to different lines are both kept, even on neighboring lines (two devices ticking off two tasks next to each other). Where both changed the same lines, it compares the words in them: edits to different words with at least one unchanged word or space between them are both kept. The editor then shows the merged text, changing only the words that differ, so the cursor stays where it was and Undo doesn't take the other device's edits back. The version is checked once more and the merged text saved. The same applies to boards (two devices moving different cards).
- **Conflict dialog:** only when the edits overlap (the same word, words right next to each other, both adding text at the same place, or one deleting a line the other edited), nothing is saved and a dialog says both changed the same lines and offers three choices: Load theirs (Undo brings mine back), Keep mine (overwrite), Save mine as a copy.
- **On window focus,** re-check the open note. If it changed elsewhere and there are no unsaved local edits, reload it silently.
- **Network errors:** retry with backoff (2 s, 5 s, 15 s), then show "Couldn't save" with a retry button.
- **Leaving the page** with unsaved changes triggers the browser's `beforeunload` warning.

## Mobile

The app must feel good in a phone browser and on a Linux desktop.

- **Viewport:** `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=resizes-content">`.
- **No zoom:** pinch and double-tap zoom are turned off (owner decision, 2026-10-29): `touch-action: pan-x pan-y`, plus cancelling Safari's gesture events, since iPhone Safari ignores `user-scalable=no`.
- **Layout:** two panes (list + editor) at ≥ 900px wide, one pane below that. The note header (title, category · status, actions) and the format bar form one block above the note. The header spans the whole width; the format bar is as wide as its buttons and centered, the same for notes and boards (changed 2026-11-02). The header ends in a more menu (`⋯`, the shared `Menu`) for what has no button of its own (Find in note). On screens under 600px wide, Export and Delete move from the header into it too, so the title keeps its room next to the board switch, Tags and pin (added 2026-11-03); read-only notes keep Export in the header. On phones the note slides in from the right and the list from the left.
- **Keyboard (iPhone):** the header and format bar stay at the top while typing, and the note area shrinks to fit above the keyboard with the tapped line in view, like Apple Notes (`ui/keyboardFit.ts`, confirmed 2026-11-02). The app never follows Safari's page panning: after the viewport has been still for 120 ms it sizes itself to the visual viewport, scrolls the caret into view inside its scroller (32px above the keyboard) and undoes Safari's pan with `scrollTo(0, 0)`, so nothing loops. The keyboard height is remembered per orientation (`localStorage`), so from the second time the app shrinks on focus, before the keyboard arrives. (Two earlier tries were dropped: following `offsetTop` hid the tapped line, and scrolling after every resize flickered.)
- **Icons:** ".md" in Source Serif 4, the note text font (changed 2026-11-02; drawn as outlines by `scripts/make-icons.py`). `favicon.svg` is just the text, dark, and light in dark mode; the 32px PNG fallback and the 180px `apple-touch-icon.png` (Safari bookmarks and favorites, square corners) show it on a white tile. The app name "notes.md" (note list, sign-in screen) is in the same serif.
- **Test targets:** a mobile browser on a phone (currently Safari on iPhone); Chromium and Firefox on Linux (Wayland/Hyprland). On Hyprland the app can also run as `chromium --app=<url>`.

## Task board (Trello replacement)

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
- **Metadata line (optional):** the first non-empty line of the body, if it holds only `#tag` labels and a due date `📅 YYYY-MM-DD`. Tags get the tag style (as everywhere); the due date shows as a chip: red when overdue, amber when due today (by the device's date), gray otherwise and for cards in the done column (added 2026-11-03). The date picker in the app inserts the `📅` date, so nobody has to type the emoji.
- **Done** = the card is in the board's last column (not counting `# Archive`). Cards have no checkbox of their own; task items inside the body are normal checkboxes. The card shows their progress, e.g. "1/2".
- **Text outside cards** (between the marker and the first column, or between a column heading and its first card) is kept as it is and shown at the top of the board or column.
- **New board** (Board in the New button's menu) creates a file with Todo / Ongoing / Done columns.
- **Images:** uploaded to a card's image board (see "Image attachments on cards" below), or any image URL, as in notes.

### Board view

A board file opens in its own view, not the note editor, with the rules below. The file is still one markdown string: every edit, drag or rename changes only the lines it touches and saves the whole file with the usual conflict check. The "open as text" toggle shows the same file in the normal editor, where any edit is allowed.

**Cards**
- Each card is a box with the title on top and the body below. The body is rendered as markdown with the same live preview as notes (its own small CodeMirror view on the card's lines), so checkboxes toggle and the reveal rule applies. A card's editor is made when the card comes within about a screen of what shows (until then its text shows as it is), and a card keeps its editor when other cards are added, moved or archived, so large boards open and change quickly (added 2026-11-10).
- **Editing in place:** tapping or clicking the body puts the cursor there. Edits go straight back into the card's lines in the file. The format bar sits under the header as for notes and acts on the card that has (or last had) the cursor. On boards it offers headings 3–6 and adds a due date button.
- **Copy and paste** work as in the normal editor: copying gives the markdown text, and pasting inserts plain text.
- **Undo and redo** (changed 2026-11-10): a board has one history for the whole file, not one per card. The format bar's Undo and Redo, and Ctrl+Z / Ctrl+Y (⌘Z / ⌘⇧Z) in a card or with no text field focused, take back the last change to the board whatever it was: typing in any card, a drag, an archive, a rename, a new card or column. A run of typing is one step; every other change is a step of its own. Edits merged in from another device are not undone.
- **Title:** edited with `InlineName` (one line). Enter or leaving saves, Escape cancels. It writes only the text after `## `.
- **Card actions:** delete (moves the card's lines into a hidden `# Archive` column at the end of the file, with Undo): the trash `IconButton` on hover with a mouse, or on touch screens a swipe left that opens a Delete button to tap (`SwipeItem`, as in the note list; added 2026-11-03; not while the card is being dragged); on touch screens, a swipe from left to right past the threshold moves the card to the top of the last column (Done), with Undo, like pinning in the note list (a green action with a check and the column's name; not for cards already there), and new card (at the bottom of each column; its title field gets focus).
- **Archive** (added 2026-11-03): when the Archive column has cards, an "Archive (n)" button after "Add column" opens a dialog listing them (title and first line, oldest first). Each has a restore `IconButton` that moves the card's lines to the end of the board's first column, with an Undo toast inside the dialog. A card can also be deleted for good (added 2026-11-03): the trash `IconButton` on hover with a mouse, or swipe left on touch screens (`SwipeItem`). Its lines leave the file and its card images go to the Drive trash, with Undo (the lines and images come back).

**No headings that split a card.** A `#` or `##` line inside a card body would start a new column or card, so the card editor never creates one:
- Typing `# ` or `## ` at the start of a line turns into `### `. Pasted text has its headings moved down two levels (`#` → `###`, `##` → `####`, capped at `######`). Lines inside fenced code blocks are left alone, because they are not headings.
- The heading buttons in the card's format bar offer levels 3–6 only.
- A newline typed or pasted into the title field ends the edit instead of entering the title.
- This is the one place where the app changes text as it is entered. Rendering still never changes the text (golden rule 1).
- Other tools editing a board should follow the same rule (see the Claude access phase).

**Drag and drop**
- A card is dragged by its title row (on touch, press and hold for about 300ms, so scrolling still works). The body is for editing, not dragging.
- Dropping moves the card's exact lines (heading + body) to the new place, then saves. Nothing else in the file changes.
- While dragging, the board scrolls when the card nears an edge.
- Columns are dragged by their heading to reorder them, with a mouse or (press and hold) on touch: sideways on desktop, up and down on phones where they are stacked. This moves the column's lines.

**Columns** (added 2026-10-31)
- **Rename:** tap or click the column title (`InlineName`). It writes only the text after `# `. "Archive" is refused, since that name hides a column.
- **Add:** "Add column" after the last column adds `# Untitled` before the hidden Archive and puts the cursor in its title.
- **Delete:** the trash `IconButton` in the column header (on hover with a mouse, always on touch). The column's cards move to the Archive column in order, and any text between its heading and first card becomes an archived card with the column's title, so no text is lost. A column with cards asks to confirm first; either way there is an Undo toast.

**Image attachments on cards** (added 2026-11-02)
- Each card has an attachment (paperclip) `IconButton` next to its trash button. With images it always shows, with their count; without, it shows on hover with a mouse and always on touch screens. It opens the card's image board: a dialog titled with the card's title.
- **The image board** shows the card's images as a tidy grid in their order. Images are added by pasting (Ctrl+V; on iPhone, long-press and Paste), by dropping image files on it, or with an "Add photo" button (the photo library or camera on phones, a file picker on desktop). Several at once is fine; each shows as a placeholder tile while it uploads. Drag a tile to reorder (with a mouse, just drag; on touch, press and hold first). Images only (PNG, JPEG, GIF, WebP). Captions are not part of this step.
- **Viewing large** (added 2026-11-02): tapping (or clicking) a tile, without dragging, shows the image as large as fits on a dark full-screen view inside the dialog, with "2 / 5", previous and next buttons (and the arrow keys), the trash button and a close button. Escape closes the large view first, then the dialog.
- **Removing** (added 2026-11-02): the trash `IconButton` in the large view, and on each tile on hover with a mouse. It removes the image line from the card and moves the file to the Drive trash, with an Undo toast (shown inside the dialog) that takes the file back out and puts the image back in its place. After a removal the large view shows the next image, or closes when none are left.
- **Files:** images are uploaded to `Notes/.attachments/` in Drive (created when first needed; folders whose name starts with `.` are never categories). Photos larger than 2048px on the long side, or over 2 MB, are scaled down and saved as JPEG (quality 0.85) before uploading; smaller images are uploaded as they are.
- **In the markdown:** each image is one line at the end of the card body, `![](https://drive.google.com/file/d/<fileId>/view)`, after a blank line. So attachments move and archive with their card, the order is the line order, and Claude or other tools can see them. The card's body editor doesn't show these lines (the board splits them off and puts them back when the body changes); the text view shows them as they are.
- **Showing images:** Drive images are not public, so the app downloads each one through the Drive API with the user's token and shows it from memory (kept for the session).

**Filter by tag** (added 2026-10-31)
- When cards use `#tags` (in the title or body, not in code), a centered row of chips above the columns shows "All cards" and each tag with how many cards have it, most used first. Choosing a tag shows only the cards that have it (any case); choosing it again or "All cards" shows all. Column counts show the cards shown.
- The filter is not saved; it resets when the board is opened again.
- A card added while filtering gets the tag as its first line, so it doesn't vanish.
- Drag and drop still works while filtering: a card dropped between shown cards lands between them in the file, with hidden cards kept in place.

**Layout**
- **Desktop (≥ 900px):** like Trello. Columns side by side, about 280px wide, and the board scrolls sideways. Each column scrolls on its own when it is taller than the screen. Cards show their full body.
- **Phone (< 900px):** vertical. Columns are stacked top to bottom as sections, each with its heading and then its cards, full width. The whole page scrolls as one list.

## Later phase: letting Claude write in the notes

Yes, this is possible, and because notes are plain `.md` files in Drive there are several routes. **Recommendation:** use route B (Claude Code + an rclone mount) now for free, and build route C (your own connector) later, if you want Claude to edit notes from the Claude app on your phone.

| Route | How it works | Claude can | Effort |
| --- | --- | --- | --- |
| A. Google Drive connector in claude.ai | The built-in connector, already available | Read notes, create new files, rename and move files. Its update tool changes metadata only, so it **cannot edit an existing note's text** | None |
| B. Claude Code on your Linux machine | `rclone mount` Google Drive to e.g. `~/Notes`; Claude Code edits the `.md` files directly | Full read and edit of any note or board, from the terminal | Low |
| C. Own MCP server as a custom connector | A small remote server exposing note tools over the Drive API, added in claude.ai under Customize → Connectors | Format-aware edits (add a card, check a task, append to a note) from claude.ai, desktop and the mobile app | Medium–high |
| D. "Ask Claude" inside the app | The app calls the Claude API from the browser with your own API key | Rewrite, summarize or extend the open note in place | Medium; pay per use |

Notes per route:

- **A:** fine for reading and asking questions about notes.
- **B:** files changed or created through rclone are ordinary Drive files, so the app sees them.
- **C:** custom connectors must be reachable from the public internet; they can be authless or use OAuth, and they work on Free (one connector), Pro, Max, Team and Enterprise plans ([Anthropic help article](https://support.anthropic.com/en/articles/11176164-pre-built-connectors-using-remote-mcp), [setup guide](https://help.boomi.com/docs/Atomsphere/Platform/Connect_claude_setup)). The same server also works in Claude Code with `claude mcp add --transport http`. Host it on Cloudflare Workers or similar, using the **same Google Cloud project** as the web app. Suggested tools: `list_notes`, `read_note`, `create_note`, `append_to_note`, `replace_in_note`, `add_card`, `move_card`, `check_task`.
- **D:** a browser call to the Claude API needs the `anthropic-dangerous-direct-browser-access: true` header. The API key stays in the browser, which is acceptable only for a personal app.

So every route works, the note text is all another tool needs: what the app keeps outside it (pins, previews, tag colors, the board type) is optional, and the app re-reads a note when it changes elsewhere (the conflict check). Tools that edit boards should be told the board rules (no `#`/`##` lines inside a card body), for example in a format note in the `Notes/` folder.

## Later phase: sharing and collaboration

Sharing can stay clean because Drive already handles it; real-time co-editing cannot, because it needs a server. Build it one step at a time and stop when it is good enough.

| Step | What it adds | How | Backend needed |
| --- | --- | --- | --- |
| 1. Drive-native sharing | Share a note or category with someone by email, as viewer or editor | Drive `permissions.create`. How a shared note shows up in the recipient's notes.md is decided when this is built | No |
| 2. Read-only public link | A URL anyone can open to read a note | Set the file to "anyone with the link" and open it on a `/view/<fileId>` route, read with an API key | No |
| 3. Take-turns collaboration | Two people edit the same note at different times, and non-overlapping edits merge automatically | Done (2026-11-03): see "Merging edits" in "Saving and conflict handling" | No |
| 4. Real-time co-editing | Live cursors and simultaneous typing, like Google Docs | Yjs CRDT with the `y-codemirror.next` binding and a WebSocket relay (self-hosted `y-websocket` or a hosted service). Drive keeps the saved `.md` snapshot | Yes |

Recommendation: steps 1–3 fit the no-backend design. Step 4 is only worth it if live co-editing turns out to be a real need.

What v1 should already do so this stays easy:

- Keep the text as loaded from Drive (the base) next to the edited text. Merging edits uses it.
- Do not assume the user owns every file. Read `capabilities.canEdit` and show a read-only mode when it is false.
- Keep sharing out of the note text. Permissions live in Drive, not in the markdown.

## Milestones

Built in this order. Each milestone ends with a working deployed app and its acceptance criteria checked. After M9, work continues from the To do list below; M10 and M11 come later.

- [x] **M0 Project setup:** Vite + Svelte + TypeScript, ESLint and Prettier, GitHub Actions deploy to GitHub Pages under /notes-dot-md/. *Done when* an empty app shell is live at the Pages URL.
- [x] **M1 Sign-in:** redirect sign-in, sign in and sign out, token renewal. *Done when* sign-in works on desktop and mobile, and a save made more than an hour after sign-in still succeeds.
- [x] **M2 Drive layer:** `drive/notes.ts` with list, read, create, save, rename, move and trash; `Notes/` and the default category folder created on first run. *Done when* a note created in the app appears in Drive as a `.md` file and survives a round trip.
- [x] **M3 Plain editor and saving:** CodeMirror without rendering rules, autosave, save status, conflict dialog. *Done when* edits reach Drive within 3 seconds, and editing the same note on two devices shows the conflict dialog (since 2026-11-03 only when the edits overlap; otherwise they merge).
- [x] **M4 Live preview:** every rendering rule in the editor table, checkbox widgets, list continuation, the `[]` shorthand. *Done when* all rules render, markers reappear on the active line, checkboxes toggle, and a copied checklist pastes into GitHub as `- [ ]` lines. Tested on a phone.
- [x] **M5 Format bar:** all buttons and shortcuts with toggle behavior. *Done when* each button applies and removes its format and the selection survives a tap.
- [x] **M6 Organization:** category filter and management, move note, sort, title search. *Done when* folders in Drive match categories in the app and the sort choice survives a reload.
- [x] **M7 Export and GFM rendering:** export button; rendered tables and images, reference links, escapes and entities (copy stays native, no button). *Done when* the exported file opens unchanged in another editor, and tables and images render in the editor while their text stays plain markdown.
- [x] **M8 Polish:** responsive layout and dark mode pass, favicon. No PWA. *Done when* the app looks and works right in Safari on iPhone and in Chromium and Firefox on Linux, at every width.
- [x] **M9 Task board:** board view for files starting with `<!-- notes.md:board -->`. *Done when* cards can be edited, renamed, added, deleted (to Archive) and dragged between columns on desktop and phone, and every change shows up as the expected lines in the text view.
- [ ] **Later — M10 Claude access:** route B, then route C.
- [ ] **Later — M11 Sharing:** steps 1–3 of the sharing section.

## Out of scope and open questions

Out of scope: offline editing (the app needs a network connection), installing it as an app (no PWA, web manifest or service worker; decided 2026-10-30), real-time collaboration, footnotes, GitHub alerts (`> [!NOTE]`), rendering inline HTML, nested categories, and a version history view (Drive keeps revisions).

Open questions:

- [ ] Use a custom domain instead of `<username>.github.io/notes-dot-md/`?

## To do

Open work, roughly in priority order. When an item is done, describe it in the section it belongs to and remove it here.

- [ ] **Import from the device** (added 2026-11-03): bring markdown files from the phone or computer into the app.
  - **How:** the New menu gets "Import files…" (a file picker for `.md`, `.markdown` and `.txt`, several at once; on iPhone it opens the Files app, iCloud included) and, where the browser can pick folders (desktop Chromium, Firefox, Safari; not iPhone), "Import folder…". Dropping such files on the note list does the same.
  - **Each file becomes a note** with its text exactly as it is (golden rule 1), titled after the file name without the extension (sanitized, ` (2)` on clashes like any note), in the selected category (General under "All notes"). A file whose first line is the board marker becomes a board. Its preview line and board mark are set when it is created.
  - **Folders** (e.g. an Obsidian vault): each top-level subfolder becomes a category (an existing one with the same name, any case, is used); files in deeper folders go into their top-level folder's category; files at the folder's root go to the selected category. Hidden folders (`.obsidian`, `.git`) and other files (images, PDFs) are skipped, so relative image links in imported notes won't show; `[[wiki links]]` stay plain text.
  - **Progress and undo:** a toast counts "Importing 12 of 40…", then says "Imported 40 notes" with Undo, which moves them all to the Drive trash (new categories too, if empty). Files are created a few at a time; one that fails is reported by name, the rest carry on. Files over 1 MB are skipped and named.
- [ ] **Import a Trello board** (added 2026-11-03): in Trello, Menu → Print, export and share → Export as JSON; pick that `.json` file with "Import files…" (recognized by its contents) to make a board note in the selected category, titled with the board's name. It is converted once; nothing stays linked to Trello.
  - Open lists, in Trello's order → `# ` columns; open cards, in order → `## ` cards.
  - Card description → the card body (its `#` / `##` headings moved down to `###`, as for any card body).
  - Labels → `#tags` on the metadata line (name in lower case, spaces as `-`; a label without a name uses its color); due date → `📅 YYYY-MM-DD`.
  - Checklists → task items (`- [ ]` / `- [x]`), under a `### <checklist name>` heading when a card has more than one.
  - Archived cards, and the cards of archived lists → the `# Archive` column.
  - Attachments → markdown links (Trello's own files need a Trello login to open). Comments, members, covers and stickers are left out.
- [ ] **Due soon view** (added 2026-11-02): a view that collects dated cards (and open tasks with dates) from all boards, soonest first, with overdue ones on top.
- [ ] **Image captions** (added 2026-11-02): a short caption under each image on a card's image board, stored as the image's alt text (`![caption](…)`).
- [ ] **More table editing:** drag rows and columns to reorder them, sort by a column, and keep the pipes aligned in the text.
