# notes.md

A markdown note-taking app for phone and desktop browsers that keeps every note as a plain `.md` file in your own Google Drive. What it does and how it is built is in [`SPEC.md`](SPEC.md).

Live app: https://kascottgit.github.io/notes-dot-md/

## Docs

Each topic lives in one place:

- **This README:** setting up, developing and deploying.
- [`SPEC.md`](SPEC.md): what the app does and how it is built (features, storage, stack, milestones, to do).
- [`CLAUDE.md`](CLAUDE.md): how to work in this repo (rules, code layout, conventions, UI rules, testing). Used by Claude Code.

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

The app icons are drawn by `scripts/make-icons.py`; how to run it is at the top of that file.

### Deployment

Every push to `main` runs `.github/workflows/deploy.yml`: check, lint, test, build, then deploy to GitHub Pages. One-time setup: in **Settings → Pages**, set **Source** to **GitHub Actions**.

## License

[MIT](LICENSE)
