import type { EntryKind } from "@tgbox/shared";
import { decodeEntities, divContent, htmlToText, parseCount } from "./html.ts";

export type ProfileKind = EntryKind | "user";

/**
 * entity: a real profile (avatar and/or extra line); contact: "Telegram: Contact @u" placeholder;
 * view: "Telegram: View @u" placeholder; malformed: no `tgme_page` structure (challenge, error page).
 */
export type PageShape = "entity" | "contact" | "view" | "malformed";

export type Profile = {
  kind: ProfileKind | null;
  title: string | null;
  description: string | null;
  avatarUrl: string | null;
  verified: boolean;
  /** channel subscribers or group members */
  members: number | null;
  /** group online count */
  online: number | null;
  /** bot monthly users */
  monthlyUsers: number | null;
  pageShape: PageShape;
};

const COUNT = String.raw`(\d[\d\s,.   ']*)`;

export function parseProfile(html: string, username: string): Profile {
  const profile: Profile = {
    kind: null,
    title: null,
    description: null,
    avatarUrl: null,
    verified: false,
    members: null,
    online: null,
    monthlyUsers: null,
    pageShape: "malformed",
  };
  const start = html.indexOf('<div class="tgme_page">');
  if (start === -1) return profile;
  const page = html.slice(start);

  const avatarUrl = /<img class="tgme_page_photo_image" src="([^"]+)"/.exec(page)?.[1];
  // Bots have two extra lines ("@u" and "N monthly users").
  const extras = [...page.matchAll(/<div class="tgme_page_extra">([\s\S]*?)<\/div>/g)].map((m) =>
    htmlToText(m[1] ?? ""),
  );
  const extra = extras.length ? extras.join("\n") : null;

  if (!avatarUrl && extra === null) {
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
    const lower = `@${username.toLowerCase()}`;
    if (/^Telegram: View @/i.test(title) && title.toLowerCase().endsWith(lower)) {
      profile.pageShape = "view";
      return profile;
    }
    const ogTitle = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1] ?? "";
    if (/^Telegram: Contact @/i.test(ogTitle) && ogTitle.toLowerCase().endsWith(lower)) {
      profile.pageShape = "contact";
      return profile;
    }
    // Neither placeholder nor a real profile: treat as a structure we don't understand.
    if (divContent(page, "tgme_page_title") === null) return profile;
  }

  profile.pageShape = "entity";
  profile.avatarUrl = avatarUrl ? decodeEntities(avatarUrl) : null;
  const titleHtml = divContent(page, "tgme_page_title");
  profile.title =
    titleHtml === null
      ? null
      : htmlToText(titleHtml.replace(/<i class="verified-icon"[\s\S]*?<\/i>/g, "")) || null;
  const descriptionHtml = divContent(page, "tgme_page_description");
  profile.description = descriptionHtml === null ? null : htmlToText(descriptionHtml) || null;
  profile.verified = /<i class="verified-icon"/.test(page);

  const button = /<a class="tgme_action_button_new[^"]*"[^>]*>([^<]*)<\/a>/.exec(page)?.[1]?.trim();
  const subscribers = new RegExp(`${COUNT} subscribers?`, "i").exec(extra ?? "");
  const members = new RegExp(`${COUNT} members?(?:,\\s*${COUNT} online)?`, "i").exec(extra ?? "");
  const monthly = new RegExp(`${COUNT} monthly users?`, "i").exec(extra ?? "");

  if (subscribers?.[1]) {
    profile.kind = "channel";
    profile.members = parseCount(subscribers[1]);
  } else if (monthly?.[1] || button === "Start Bot") {
    profile.kind = "bot";
    profile.monthlyUsers = monthly?.[1] ? parseCount(monthly[1]) : null;
  } else if (members?.[1]) {
    profile.kind = "group";
    profile.members = parseCount(members[1]);
    profile.online = members[2] ? parseCount(members[2]) : null;
  } else if (
    extras.length &&
    extras.every((e) => e.toLowerCase() === `@${username.toLowerCase()}`)
  ) {
    profile.kind = "user";
  }
  return profile;
}
