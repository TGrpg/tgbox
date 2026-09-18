import { isEntryProduct, type ProductKind } from "@tgbox/shared";
import {
  type AdOrderSummary,
  type EntryStatusSummary,
  type OrderSummary,
  type ProductLabel,
  type PromotionTarget,
  type SubmissionSummary,
  type SupportUser,
  utcTime,
  type zh,
} from "./zh.ts";

const enProductKinds: Record<ProductKind, string> = {
  highlight: "highlight",
  category_pin: "category pin",
  pin: "site-wide pin",
  banner: "home banner",
  announcement: "announcement bar",
};

const enProductNames: Record<ProductKind, string> = {
  highlight: "Highlight",
  category_pin: "Category pin",
  pin: "Site-wide pin",
  banner: "Home banner",
  announcement: "Announcement bar",
};

const enProductEffects: Record<ProductKind, string> = {
  highlight: "A gold tint and a “Promoted” tag in every list, same position.",
  category_pin: "First place in its own category; includes the highlight.",
  pin: "First on home, overviews, categories and detail pages' “discover more”; includes the highlight.",
  banner: "A large home sponsor card, also beside every detail page; can carry an image. Reviewed.",
  announcement: "One line of text at the top of every page; a single slot. Reviewed.",
};

const enTarget = (t: PromotionTarget) =>
  t.username
    ? `${enProductKinds[t.kind]} @${t.username}`
    : `${enProductKinds[t.kind]} "${t.bannerTitle ?? ""}"`;

export const en: typeof zh = {
  welcome:
    "Welcome to the TGbox submission bot!\n\nSend a link to a channel, group or bot (https://t.me/xxx, t.me/xxx or @xxx) to submit it.",
  submitButton: "Submit",
  promoteButton: "Buy promotion",
  submissionsClosed: "Submissions are closed for now. Please come back later.",
  support: (username: string | null) =>
    username
      ? `Contact support: @${username}`
      : "Support isn't set up yet. Please try again later.",
  help: "Listing criteria: public channels, groups or bots with legal content, regular updates and no fake subscribers.\n\nHow to submit: send a t.me link or @username, then pick a category and tags.\nYou'll get a private message with the review result.\n\n/lang switches the language, /support reaches the team.",
  menuButtonApp: "Open TGbox",
  menuButtonAdmin: "Admin panel",
  openApp: "📱 Open in the app",
  openAppMy: "📱 View my submissions",
  langButton: "🌐 语言 / Language",
  commands: {
    submit: "Submit a listing",
    promote: "Buy promotion",
    support: "Contact support",
    lang: "切换语言 / Language",
    help: "How it works",
  },
  lang: {
    choose: "Choose the bot language:",
    zh: "中文",
    en: "English",
    auto: "自动 / Auto",
    saved: "✅ Language set to English.",
    savedAuto: "✅ The bot now follows your Telegram client language.",
  },
  supportChat: {
    ask: "Just send your question here and the team will get back to you.",
    sent: "✅ Sent to support. Hang tight.",
    unavailable: "Support can't take messages right now. Please try again later.",
  },
  sendLink:
    "Send the link of the channel, group or bot to submit (https://t.me/xxx, t.me/xxx or @xxx).",
  invalidLink:
    "That link wasn't recognized. Send a public username as https://t.me/xxx, t.me/xxx or @xxx (invite links aren't supported).",
  maybeSubmission: "想收录这个链接？请用 /submit 提交。 / To submit a link, use /submit.",
  alreadyListed: (username: string) => `@${username} is already listed.`,
  alreadyPending: (username: string) => `@${username} is already awaiting review.`,
  dailyLimit: (limit: number) =>
    `You've reached today's submission limit (${limit}). Please try again tomorrow.`,
  notFound: (username: string) => `@${username} doesn't exist. Check the username.`,
  banned: (username: string) => `@${username} is banned or restricted by Telegram.`,
  checking: (username: string) => `Checking @${username}…`,
  unavailable: "Couldn't fetch the profile right now. Please try again later.",
  userAccount: (username: string) =>
    `@${username} is a personal account. Only public channels, groups and bots can be listed.`,
  kinds: { channel: "Channel", group: "Group", bot: "Bot" },
  members: "Members",
  profile: (kind: string, title: string, username: string) => `${kind}: ${title} (@${username})`,
  chooseCategory: "Choose a category:",
  chooseCategorySuggested: "Choose a category (✨ is a guess from the description — change it):",
  chooseTags: (count: number, max: number) => `Choose tags (optional, ${count}/${max} selected):`,
  tagsDone: "Done",
  prevPage: "« Prev",
  nextPage: "Next »",
  confirmTitle: "Please confirm your submission:",
  category: "Category",
  tags: "Tags",
  none: "None",
  confirm: "✅ Confirm",
  editCategory: "Edit category",
  editTags: "Edit tags",
  cancel: "Cancel",
  cancelled: "Cancelled. Send a link any time to start again.",
  expired: "This button has expired. Send the link again to restart.",
  submitted: "Submitted and awaiting review. You'll get a private message with the result.",
  noPermission: "Not allowed.",
  alreadyHandled: "Already handled.",
  approvedNotice: (username: string) =>
    `🎉 Your submission @${username} was approved and listed. The site updates in a few minutes.`,
  rejectedNotice: (username: string, reason: string) =>
    `Sorry, your submission @${username} was not approved. Reason: ${reason}`,
  openTelegram: "Open in Telegram",
  openSite: "Details",
  promote: {
    intro: (advertiseUrl: string) =>
      [
        "📣 Buy a promotion",
        "",
        "Pick a placement first; the next step shows durations and prices.",
        "🔸 Promote my listing: a listed channel, group or bot, live once paid",
        "🖼 Brand ad: any link, live after review",
        "",
        `What each placement looks like: ${advertiseUrl}`,
      ].join("\n"),
    placement: (kind: ProductKind) =>
      `${isEntryProduct(kind) ? "🔸" : "🖼"} ${enProductNames[kind]}`,
    chooseDuration: (kind: ProductKind) =>
      [enProductNames[kind], enProductEffects[kind], "", "Choose a duration:"].join("\n"),
    back: "← Back to placements",
    unavailable:
      "Promotions can't be bought right now. Try again later or contact support (/support).",
    product: (p: ProductLabel) =>
      `${p.name} · ${[p.stars === null ? "" : `⭐${p.stars}`, p.usdt === null ? "" : `${p.usdt} USDT`].filter(Boolean).join(" / ")}`,
    askTarget:
      "Send the channel, group or bot to promote (@username or t.me link). It must already be listed.",
    askTitle: "Send the ad title (1–20 characters):",
    askSubtitle: "Send the ad subtitle (1–40 characters):",
    askHref: "Send the ad link (starting with https://, t.me links work too):",
    askImage: "Optional: send a banner image (jpg/png/webp, up to 1MB), or send /skip.",
    invalidTarget: "That wasn't recognized. Send an @username or t.me link.",
    targetNotListed: (username: string) =>
      `@${username} isn't listed yet; only listed entries can be promoted. Send /submit to submit it first.`,
    invalidTitle: "The title must be 1–20 characters. Please send it again.",
    invalidSubtitle: "The subtitle must be 1–40 characters. Please send it again.",
    invalidHref: "The link must start with https://. Please send it again.",
    invalidImage: "Only jpg/png/webp images up to 1MB are supported. Send another one, or /skip.",
    imageFailed: "The image could not be uploaded, so this banner goes out without one.",
    noSlots: (nextFreeAt: number | null) =>
      nextFreeAt
        ? `All slots are taken. The next one frees up on ${new Date(nextFreeAt).toISOString().slice(0, 10)}.`
        : "All slots are taken. Please try again later.",
    productUnavailable: "That product is no longer available. Send /promote to choose again.",
    order: (o: OrderSummary) =>
      [
        `Order #${o.id}`,
        `Product: ${o.product}`,
        `Content: ${enTarget(o)}`,
        `Price: ${[o.stars === null ? "" : `⭐${o.stars}`, o.usdt === null ? "" : `${o.usdt} USDT`].filter(Boolean).join(" or ")}`,
      ].join("\n"),
    choosePayment: "Choose a payment method:",
    noPaymentMethod: "Online payment isn't available right now. Please contact support (/support).",
    payStars: (stars: number) => `⭐ Telegram Stars (${stars})`,
    payUsdt: (usdt: string) => `💵 USDT (${usdt})`,
    payUsdtSelf: (usdt: string) => `💵 USDT·TRC20 (${usdt})`,
    usdtTransfer: (o: { address: string; amount: string; minutes: number }) =>
      [
        "💵 <b>USDT (TRC20) transfer</b>",
        "",
        "Send to (tap to copy):",
        `<code>${o.address}</code>`,
        "",
        "Exact amount (tap to copy):",
        `<code>${o.amount}</code>`,
        "",
        "⚠️ <b>Send exactly this amount.</b> The last decimals identify your order. Paying more or less cannot be confirmed automatically and needs support to sort out by hand.",
        "",
        `Transfer within ${o.minutes} minutes; it is confirmed automatically within about 5 minutes of arriving.`,
      ].join("\n"),
    usdtNoAmount: "A lot of orders are open right now — please try again shortly.",
    orderExpired: "This order is no longer valid. Send /promote to order again.",
    invoiceDescription: (t: PromotionTarget, days: number) => `${enTarget(t)}, ${days} days`,
    usdtInvoice: (amount: string) =>
      `Please pay ${amount} USDT within 1 hour. You'll be notified once the payment arrives.`,
    payNow: "Pay",
    invoiceFailed: "Couldn't create the invoice. Please try again later.",
    cancelled: "Cancelled.",
    checkoutInvalid: "This order is no longer valid. Please order again.",
    checkoutNoSlots: "All slots are taken; you haven't been charged.",
    paidEntry: (t: PromotionTarget, days: number) =>
      `✅ Payment received! Your ${enTarget(t)} is live for ${days} days. The site updates in a few minutes.`,
    paidAd: "✅ Payment received! Your ad is awaiting review; you'll be notified of the result.",
    adApproved: (t: PromotionTarget, endsAt: number) =>
      `🎉 Your ad (${enTarget(t)}) was approved and is live until ${utcTime(endsAt)}.`,
    adRejectedRefunded: "Sorry, your ad was not approved. Your Stars were refunded.",
    adRejectedManual: (orderId: number, support: string | null) =>
      `Sorry, your ad was not approved. Please contact support${support ? ` @${support}` : ""} for a refund (order #${orderId}).`,
    orphanRefunded: "This order is no longer valid, so your Stars were refunded.",
    expired: (t: PromotionTarget) =>
      `Your promotion (${enTarget(t)}) has ended. Send /promote to buy again.`,
    expiringSoon: (t: PromotionTarget, endsAt: number) =>
      `Your promotion (${enTarget(t)}) ends at ${utcTime(endsAt)}. Send /promote to renew.`,
  },
  admin: {
    newSubmission: (s: SubmissionSummary) =>
      [
        "📥 New submission",
        `${s.kind}: ${s.title}`,
        `https://t.me/${s.username}`,
        `Members: ${s.members ?? "unknown"}`,
        `Category: ${s.category}`,
        `Tags: ${s.tags.length ? s.tags.join(", ") : "none"}`,
        `Submitted by: ${s.submitter}${s.submitterUsername ? ` @${s.submitterUsername}` : ""} (${s.submitterId})`,
        "",
        s.description.slice(0, 500),
      ].join("\n"),
    approve: "✅ Approve",
    reject: "❌ Reject",
    back: "« Back",
    approvedBy: (name: string) => `✅ Approved (${name})`,
    rejectedBy: (name: string, reason: string) => `❌ Rejected (${name}): ${reason}`,
    reasons: {
      content: "Content violation",
      grey: "Grey/black market",
      fake_subs: "Fake subscribers",
      inactive: "Inactive",
      duplicate: "Duplicate",
      other: "Other",
    },
    reviewChatSet: "✅ This chat is now the review chat.",
    support: {
      topicName: (name: string, userId: number) => `${name} (${userId})`,
      header: (u: SupportUser) =>
        [
          `👤 ${u.name}`,
          `ID: ${u.id}`,
          `Username: ${u.username ? `@${u.username}` : "none"}`,
          `Language: ${u.language ?? "unknown"}`,
          "",
          "Reply in this topic to relay to the user. /ban [reason] blocks them, /done closes it.",
        ].join("\n"),
      banned: (userId: number, reason: string | null) =>
        `Banned user ${userId}${reason ? ` (${reason})` : ""}; their messages are no longer relayed.`,
      done: "✅ Session closed. It reopens automatically when the user writes again.",
      relayFailed: (reason: string) =>
        `⚠️ Support relay failed: ${reason}\nCheck that the support group has topics enabled and the bot is an admin with "Manage topics".`,
    },
    adReview: (o: AdOrderSummary) =>
      [
        "🖼 Ad awaiting review",
        `Order #${o.id}: ${o.product}`,
        `Title: ${o.title}`,
        `Subtitle: ${o.subtitle}`,
        `Link: ${o.href}`,
        ...(o.imageUrl ? [`Image: ${o.imageUrl}`] : []),
        `Paid: ${o.amount} ${o.currency}`,
        `Buyer: ${o.buyerId}`,
      ].join("\n"),
    adRejected: (name: string, refunded: boolean, amount: string) =>
      `❌ Rejected (${name})${refunded ? ", refunded automatically" : `, refund ${amount} by hand`}`,
    orphanPayment: (orderId: number, provider: string, chargeId: string, amount: string) =>
      `⚠️ Payment for invalid order #${orderId} (${provider} ${chargeId}, ${amount}). Check and refund by hand.`,
    banUsage: "Usage: /ban <userId|@username> [reason]",
    unbanUsage: "Usage: /unban <userId|@username>",
    banned: (target: string) => `Banned ${target}`,
    unbanned: (target: string) => `Unbanned ${target}`,
    notBanned: (target: string) => `${target} is not banned`,
    entryUsage: (command: string) => `Usage: /${command} @username`,
    setcatUsage: "Usage: /setcat @username <category-slug>",
    settagsUsage: "Usage: /settags @username tag1,tag2",
    entryNotFound: (username: string) => `No entry @${username}`,
    statusSet: (username: string, status: string, changed: boolean) =>
      changed ? `@${username} status set to ${status}` : `@${username} is already ${status}`,
    unknownCategory: (slug: string, kind: string) => `Unknown category "${slug}" for ${kind}`,
    categorySet: (username: string, slug: string, changed: boolean) =>
      changed ? `@${username} category set to ${slug}` : `@${username} category unchanged`,
    unknownTags: (slugs: string[]) => `Unknown tags: ${slugs.join(", ")}`,
    tooManyTags: (max: number) => `At most ${max} tags`,
    tagsSet: (username: string, slugs: string[], changed: boolean) =>
      changed
        ? `@${username} tags set to ${slugs.join(", ") || "none"}`
        : `@${username} tags unchanged`,
    status: (s: EntryStatusSummary) =>
      [
        `@${s.entry.username} (${s.entry.kind}) ${s.entry.title}`,
        `Status: ${s.entry.status}`,
        `Liveness: ${s.entry.liveness}, ${s.entry.failCount} consecutive failures${s.entry.lastFailAt ? `, last at ${new Date(s.entry.lastFailAt).toISOString()}` : ""}`,
        `Members: ${s.members ?? "unknown"}`,
        `Category: ${s.category}`,
        `Tags: ${s.tags.join(", ") || "none"}`,
        `Listed at: ${new Date(s.entry.listedAt).toISOString()}`,
      ].join("\n"),
  },
};
