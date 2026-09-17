---
title: "Telegram channels vs groups vs bots"
description: "A channel is one-way broadcast, a group is a conversation, a bot is a program running inside Telegram. Here are the member limits, posting rights and use cases side by side, plus how a basic group actually becomes a supergroup."
keywords:
  - telegram channel vs group
  - telegram supergroup limit
  - telegram group member limit
  - what is a telegram bot
  - channel or group
publishedAt: 2026-09-12
updatedAt: 2026-09-16
locale: en
slug: "channels-groups-bots"
faq:
  - q: "What is the difference between a basic group and a supergroup?"
    a: "A basic group holds at most 200 members and has fewer features. A supergroup holds up to 200,000, and adds public usernames, granular per-admin rights and full visible history. Clients migrate a basic group to a supergroup automatically as soon as an admin does something only supergroups support."
  - q: "Is there a limit on channel subscribers?"
    a: "No. Telegram states that a channel can have an unlimited number of subscribers. The limits apply to groups - 200 members for a basic group, 200,000 for a supergroup."
  - q: "Will a bot message me first?"
    a: "No. Bots cannot initiate a conversation; you have to start one (press Start) or add the bot to a group. An unsolicited direct message from something calling itself a bot is almost always an ordinary account in disguise."
---

Telegram has three containers whose names sound similar and whose purposes are not: channels, groups and bots. Picking the wrong one hurts — running a discussion in a channel, or announcements in a group, tends to force a rebuild a few months later. Here is the whole distinction in one place.

## The one-line version

- **Channel** — one-to-many broadcast. Only admins publish, everyone else reads, and there is **no subscriber limit**.
- **Group** — many-to-many conversation. Every member can post, subject to permissions; a supergroup holds up to **200,000** members.
- **Bot** — a program written by a third-party developer against the Bot API and run inside Telegram. It isn't a container; it's a participant.

## Channels: broadcast

Channels exist to push messages to large audiences. Telegram's own wording is that a channel "can have an unlimited number of subscribers".

The properties that matter:

- **Posts are signed by the channel, not by you.** A message carries the channel's name and photo rather than the account that posted it, which matters as soon as more than one person runs it.
- **Every post has a public view counter**, and views from forwarded copies are added to the original's total.
- **Public channels have a username**, so anyone can find them in Telegram search and join. Private channels are joinable only through an invite link.
- **The owner can add the first 200 subscribers directly**; beyond that people have to join themselves. That's a startup allowance most people forget they have.

Channels have no discussion area of their own. If you want readers to comment, the correct pattern is to **link a discussion group to the channel**: every new post is forwarded there automatically, comments happen in the group, and the channel itself stays clean.

## Groups: conversation

There are three kinds, differing mainly in scale and features.

A **basic group** holds at most **200 members** and has fewer features — no public username, no granular admin rights.

A **supergroup** holds up to **200,000 members** and is what almost every real community actually uses. It adds:

- a public username and a `t.me/xxx` link; for a public group the **entire message history is visible to anyone**, who can then join and post;
- per-member permissions — whether they may send media, links, pin messages, and so on;
- per-admin rights, instead of a single "is an admin" flag.

A **broadcast group (gigagroup)** is a supergroup variant with **the member ceiling removed**, at the cost that only admins can write. It fits the case of "I need a visible member list but in practice I only broadcast". Note that converting a supergroup into a gigagroup is **one way only** and is offered by Telegram to admins rather than being freely available.

### How a basic group becomes a supergroup

This is the most-asked question, and the answer is: **you usually don't do anything**.

Telegram's client specification is explicit — clients should migrate a basic group to a supergroup automatically as soon as an admin tries to perform an action only supergroups support. Setting a public link or crossing 200 members both trigger it.

When the migration happens, everyone in the old chat receives a service message pointing at the new supergroup, and all further messages go to the new one. In the app you see the familiar "the group was upgraded to a supergroup" notice. There is no downgrade button in the clients, so plan it as a one-way change.

## Bots: programs inside Telegram

A bot isn't a third kind of room. It's a special account implemented by an outside developer through the **Bot API** — think of it as a participant that only responds programmatically.

Worth knowing:

- **A bot cannot contact you first.** You start it, or someone adds it to a group. Anything that DMs you out of nowhere and calls itself a bot deserves suspicion.
- **It can be added to a group or channel as an admin**, which is how anti-spam, welcome messages, polls and scheduled posting are usually implemented.
- **It doesn't see everything in a group.** Unless it's an admin or privacy mode is off, it only receives commands and messages that mention it.
- **It is third-party software.** It can read whatever you deliberately send it, so don't hand sensitive material to a bot you don't know.

This directory's submission flow is itself a bot: you send it a channel link, it fetches the public profile, and the review result comes back as a private message.

## Which one should you use

| What you want to do | Use |
|---|---|
| Publish announcements, updates or news with no reader posts | Channel |
| Publish, but with a comment section | Channel + linked discussion group |
| Let people talk to each other and help each other | Supergroup |
| Broadcast at huge scale but keep a visible member list | Broadcast group |
| Automate moderation, welcomes, lookups, scheduled posts | Bot inside a channel or group |
| Offer a lookup or utility service | A standalone bot |

Some rules of thumb:

- **When in doubt, start with a channel.** You can attach a discussion group later to open up conversation. Turning a group that has been noisy for six months into a quiet announcement feed is much harder.
- **Any group past a hundred or two needs rules configured.** Supergroup permissions are per-item; turning off links and forwards for new members up front is far cheaper than cleaning up afterwards.
- **Public really means public.** A public group's history is readable by any passer-by, and a public channel has a web preview page. If you want privacy, don't set a username.

## What this means when you're looking for something

As a reader, keeping the three straight saves a lot of time. If you want to passively receive information on a topic, you want a **channel**. If you want your questions answered, you want a **group**. If you want something to convert a currency or fetch a file for you, you want a **bot**.

This directory lists the three separately — browse [channels](/en/channel/), [groups](/en/group/) and [bots](/en/bot/). To learn how to judge whether a channel is worth subscribing to, read [how to find good Telegram channels](/en/guides/find-telegram-channels/).
