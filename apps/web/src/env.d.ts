interface ImportMetaEnv {
  readonly SITE_URL?: string;
  readonly PUBLIC_BOT_USERNAME?: string;
  /** Directory serving `pagefind.js`, e.g. `${R2_PUBLIC_URL}/pagefind`; defaults to `/pagefind`. */
  readonly PUBLIC_PAGEFIND_URL?: string;
}
