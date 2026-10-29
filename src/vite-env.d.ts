/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

/** Short commit id of this build, or 'dev'. Set in vite.config.ts. */
declare const __BUILD_ID__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
