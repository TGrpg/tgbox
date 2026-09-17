/** Build-time site configuration; the domain isn't fixed yet, so everything comes from env. */
export const siteUrl = (import.meta.env.SITE_URL ?? "http://localhost:4321").replace(/\/$/, "");

export const botUsername = (import.meta.env.PUBLIC_BOT_USERNAME ?? "tgboxccbot").replace(/^@/, "");

export const botUrl = `https://t.me/${botUsername}`;

/** Public source repository; shown in the footer and claimed in the Organization JSON-LD. */
export const repoUrl = "https://github.com/TGrpg/tgbox";

export const licence = { name: "AGPL-3.0", url: `${repoUrl}/blob/main/LICENSE` };

export function absoluteUrl(path: string) {
  return new URL(path, `${siteUrl}/`).toString();
}
