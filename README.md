# notes.md

A markdown note-taking app that keeps every note as a plain `.md` file in your own Google Drive.

notes.md runs entirely in the browser and installs as a PWA on phones and desktop. There is no backend and no database: the app talks to the Google Drive API directly, and your notes stay in a `Notes/` folder you can open, back up or edit with any other tool.

**Status:** early development. Notes with live preview, a format bar, categories, sorting and search work; export and PWA install come next. See [Roadmap](#roadmap).

Live app: https://kascottgit.github.io/notes-dot-md/

## Why

- **Your notes are just files.** Each note is one `.md` file in Drive. Categories are folders. What you see in the app is what you see in Drive.
- **The text is always plain markdown.** The editor renders markdown inline (live preview, like Obsidian), but it never rewrites your text. Copy, export and Drive all get exactly the markdown you typed. A copied checklist pastes into GitHub as `- [ ] item`.
- **No server to trust.** Sign-in goes straight to Google, and the access token lives in memory only.

## Planned features (v1)

- Live-preview editor (CodeMirror 6) with GitHub-flavored markdown, including clickable task lists and list items you can reorder by touch
- Format bar and keyboard shortcuts that toggle bold, italic, headings, lists, checklists, quotes and code
- Categories (Drive folders), sorting by modified, created or title, and title search
- Autosave with conflict detection, so a version saved on another device is never silently overwritten
- Export a note as `.md` and copy it as markdown
- Installable PWA with light and dark themes, built for phones and desktop

Later phases: a Trello-style task board stored as a markdown note, letting Claude read and edit notes, and sharing through Drive.

Offline editing is not a goal: the app needs a network connection.

## How notes are stored

```
My Drive/
  Notes/                 created on first sign-in
    Inbox/               default category
    School/
    Projects/
      Drive layer.md
```

- One note = one file named `<title>.md`.
- One category = one subfolder of `Notes/` (one level deep).
- Deleting a note moves it to the Drive trash. The app never permanently deletes anything.
- The app asks for full Drive access (the `drive` scope), so notes created by other tools, such as Claude, rclone or a manual upload, show up too. It only reads and writes the `Notes/` folder.

## Tech stack

Vite · TypeScript · Svelte 5 · CodeMirror 6 · Google OAuth (redirect flow) · Google Drive REST API v3 · `vite-plugin-pwa` · Vitest. Hosted on GitHub Pages.

## Development

### Prerequisites

- Node.js (current LTS) and npm
- A Google Cloud project with an OAuth client ID (see below)

### Google Cloud setup

1. Create a Google Cloud project and enable the **Google Drive API**.
2. Configure the OAuth consent screen as **External**, in testing mode, and add yourself as a test user. Under **Data access**, add the scope `https://www.googleapis.com/auth/drive`. It is a restricted scope, so Google shows an "unverified app" warning at sign-in; that is expected for a personal app in testing mode.
3. Create an OAuth client ID of type **Web application**.
4. Add these authorized JavaScript origins (domain only, no path):
   - `http://localhost:5173`
   - `https://<username>.github.io`
5. Add these authorized redirect URIs (with the path and the trailing slash):
   - `http://localhost:5173/notes-dot-md/`
   - `https://<username>.github.io/notes-dot-md/`
6. Copy `.env.example` to `.env` and set `VITE_GOOGLE_CLIENT_ID`. The client ID is not secret, but `.env` stays out of git.
7. For the deployed site, add the same value as a repository variable: **Settings → Secrets and variables → Actions → Variables → New repository variable**, named `VITE_GOOGLE_CLIENT_ID`. The deploy workflow passes it to the build.

### Deployment

Every push to `main` runs `.github/workflows/deploy.yml`: check, lint, test, build, then deploy to GitHub Pages. One-time setup: in **Settings → Pages**, set **Source** to **GitHub Actions**.

### Commands

```sh
npm install
npm run dev       # dev server at http://localhost:5173/notes-dot-md/
npm run build     # production build to dist/
npm run preview   # serve the production build
npm run check     # svelte-check + tsc
npm run lint      # eslint + prettier --check
npm test          # vitest
```

## Roadmap

- [x] **M0** Project setup and GitHub Pages deploy
- [x] **M1** Google sign-in with token renewal
- [x] **M2** Drive layer (list, read, create, save, rename, move, trash)
- [x] **M3** Plain editor, autosave and conflict handling
- [ ] **M4** Live preview rendering
- [ ] **M5** Format bar and shortcuts
- [ ] **M6** Categories, sorting and search
- [ ] **M7** Export and copy as markdown
- [ ] **M8** PWA, dark mode and polish
- [ ] Later: task board, Claude access, sharing

## Project docs

- [`SPEC.md`](SPEC.md): the full product and technical spec
- [`CLAUDE.md`](CLAUDE.md): working rules for this repo (used by Claude Code)

## License

[MIT](LICENSE)
