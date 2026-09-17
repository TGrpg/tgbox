import { PostView } from "@tgbox/shared";
import { describe, expect, test } from "vitest";
import { parseChannelPage, parseCreatedAt } from "./channel.ts";
import { fixture } from "./fixtures.ts";

describe("parseChannelPage", () => {
  const page = parseChannelPage(fixture("channel-posts.html"));

  test("extracts the recent posts as valid PostViews", () => {
    expect(page.hasPreview).toBe(true);
    expect(page.posts).toHaveLength(20);
    for (const post of page.posts) expect(PostView.parse(post)).toEqual(post);
  });

  test("post fields: id, date, plain text, views, media thumb", () => {
    const post = page.posts.find((p) => p.id === 443);
    expect(post).toMatchObject({
      id: 443,
      date: "2026-05-14T16:09:19+00:00",
      views: 1730000,
    });
    expect(post?.text.startsWith("Custom AI Styles. The text editor allows anyone")).toBe(true);
    expect(post?.text).not.toMatch(/<|&nbsp;|&amp;/);
    expect(post?.mediaThumb).toMatch(/^https:\/\/cdn1\.telesco\.pe\/file\//);
  });

  test("long text is trimmed", () => {
    const body = "a".repeat(2000);
    const html = `<div class="tgme_widget_message js-widget_message" data-post="c/5"><div class="tgme_widget_message_text js-message_text">${body}</div><span class="tgme_widget_message_views">18.8K</span><time datetime="2026-01-01T00:00:00+00:00" class="time">x</time></div>`;
    const [post] = parseChannelPage(html).posts;
    expect(post?.text.length).toBeLessThanOrEqual(501);
    expect(post?.views).toBe(18800);
    expect(post?.mediaThumb).toBeUndefined();
  });

  test("pages without a message list have no preview", () => {
    expect(parseChannelPage(fixture("profile-group.html"))).toEqual({
      posts: [],
      hasPreview: false,
    });
    expect(parseChannelPage(fixture("malformed.html"))).toEqual({ posts: [], hasPreview: false });
  });
});

describe("parseCreatedAt", () => {
  test("uses the 'Channel created' service message", () => {
    expect(parseCreatedAt(fixture("channel-first-post.html"))).toBe("2015-09-21T02:14:24+00:00");
  });

  test("falls back to the earliest post date", () => {
    const html = `<div class="tgme_widget_message js-widget_message" data-post="c/9"><time datetime="2020-02-02T00:00:00+00:00"></time></div><div class="tgme_widget_message js-widget_message" data-post="c/3"><time datetime="2020-01-01T00:00:00+00:00"></time></div>`;
    expect(parseCreatedAt(html)).toBe("2020-01-01T00:00:00+00:00");
  });

  test("null when there are no posts", () => {
    expect(parseCreatedAt(fixture("malformed.html"))).toBeNull();
  });
});
