/// <reference types="vite/client" />

/**
 * Ambient typing for the `VITE_*` env vars this app actually reads (Phase 2).
 * Both are optional and documented in `web/.env.example`.
 */
interface ImportMetaEnv {
  /** Base URL prefixed to every API request (web/src/api/client.ts). Defaults to `/api`. */
  readonly VITE_API_BASE?: string;
  /**
   * Dev-only mock `initDataRaw`, read only when `import.meta.env.DEV` is true
   * and no real Telegram launch data is present — see
   * web/src/telegram/launchData.ts and Phase 2.5 of the implementation plan.
   * Never set in a committed env file; never shipped in a production build.
   */
  readonly VITE_DEV_INIT_DATA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
