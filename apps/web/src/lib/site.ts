/** Build-time site configuration; the domain isn't fixed yet, so everything comes from env. */
export const siteUrl = (import.meta.env.SITE_URL ?? "http://localhost:4321").replace(/\/$/, "");

export const botUsername = (import.meta.env.PUBLIC_BOT_USERNAME ?? "tgboxccbot").replace(/^@/, "");

export const botUrl = `https://t.me/${botUsername}`;

/** Deep link that drops the visitor straight into the bot's submit flow. */
export const botSubmitUrl = `${botUrl}?start=submit`;

/** Deep link into the bot's link-exchange application. */
export const botLinksUrl = `${botUrl}?start=links`;

/** Public to read only: all rights reserved, no deployment and no commercial use. */
export const repoUrl = "https://github.com/TGrpg/tgbox";

/** The largest entries mirrored as a GitHub awesome list, regenerated daily from /data/awesome.json. */
export const awesomeUrl = "https://github.com/TGrpg/awesome-telegram";

export function absoluteUrl(path: string) {
  return new URL(path, `${siteUrl}/`).toString();
}
