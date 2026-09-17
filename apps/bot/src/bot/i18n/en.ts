import type { EntryStatusSummary, SubmissionSummary, zh } from "./zh.ts";

export const en: typeof zh = {
  welcome:
    "Welcome to the TGbox submission bot!\n\nSend a link to a channel, group or bot (https://t.me/xxx, t.me/xxx or @xxx) to submit it.",
  submitButton: "Submit",
  help: "Listing criteria: public channels, groups or bots with legal content, regular updates and no fake subscribers.\n\nHow to submit: send a t.me link or @username, then pick a category and tags.\nYou'll get a private message with the review result. Contact the admins with any questions.",
  sendLink:
    "Send the link of the channel, group or bot to submit (https://t.me/xxx, t.me/xxx or @xxx).",
  invalidLink:
    "That link wasn't recognized. Send a public username as https://t.me/xxx, t.me/xxx or @xxx (invite links aren't supported).",
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
