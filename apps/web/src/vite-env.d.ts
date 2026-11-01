/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_GATEWAY_DASHBOARD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
