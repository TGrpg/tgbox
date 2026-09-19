import type { PostView } from "@tgbox/shared";
import { decodeEntities, divContent, htmlToText } from "./html.ts";

const MAX_TEXT = 500;

type Message = { id: number; chunk: string; service: boolean };

/** Splits a /s/ page into message chunks, each starting at its `data-post` element. */
function messages(html: string): Message[] {
  const starts = [
    ...html.matchAll(/<div class="tgme_widget_message ([^"]*)" data-post="[^"/]+\/(\d+)"/g),
  ];
  return starts.map((match, i) => ({
    id: Number(match[2]),
    service: /\bservice_message\b/.test(match[1] ?? ""),
    chunk: html.slice(match.index, starts[i + 1]?.index ?? html.length),
  }));
}

/** "18.8K" → 18800, "1.2M" → 1200000, "532" → 532 */
function parseViews(text: string): number | null {
  const match = /^([\d.]+)\s*([KM]?)$/i.exec(text.trim());
  if (!match?.[1]) return null;
  const scale = { "": 1, K: 1_000, M: 1_000_000 }[(match[2] ?? "").toUpperCase()] ?? 1;
  const value = Math.round(Number(match[1]) * scale);
  return Number.isFinite(value) ? value : null;
}

function truncate(text: string): string {
  const chars = [...text];
  return chars.length > MAX_TEXT ? `${chars.slice(0, MAX_TEXT).join("").trimEnd()}…` : text;
}

export function parseChannelPage(html: string): { posts: PostView[]; hasPreview: boolean } {
  const posts: PostView[] = [];
  for (const message of messages(html)) {
    if (message.service) continue;
    const date = /<time datetime="([^"]+)"/.exec(message.chunk)?.[1];
    if (!date) continue;
    const textHtml = divContent(message.chunk, "tgme_widget_message_text");
    const views = /<span class="tgme_widget_message_views">([^<]*)<\/span>/.exec(
      message.chunk,
    )?.[1];
    const thumb = /background-image:url\('([^']+)'\)/.exec(message.chunk)?.[1];
    const post: PostView = {
      id: message.id,
      date,
      text: textHtml === null ? "" : truncate(htmlToText(textHtml)),
      views: views === undefined ? null : parseViews(views),
    };
    if (thumb) post.mediaThumb = decodeEntities(thumb);
    posts.push(post);
  }
  const hasPreview = posts.length > 0 || html.includes('class="tgme_channel_history');
  return { posts, hasPreview };
}

/**
 * Creation date from a `/s/{u}/1` page or a `/{u}/1` embed: the "Channel created" service message,
 * else the earliest message.
 */
export function parseCreatedAt(html: string): string | null {
  let earliest: { id: number; date: string } | null = null;
  for (const message of messages(html)) {
    const date = /<time datetime="([^"]+)"/.exec(message.chunk)?.[1];
    if (!date) continue;
    const text = divContent(message.chunk, "tgme_widget_message_text");
    if (message.service && text !== null && /^(Channel|Group) created$/i.test(htmlToText(text))) {
      return date;
    }
    if (!earliest || message.id < earliest.id) earliest = { id: message.id, date };
  }
  return earliest?.date ?? null;
}
