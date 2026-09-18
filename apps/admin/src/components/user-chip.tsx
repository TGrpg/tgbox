import { useQuery } from "@tanstack/react-query";
import { BotIcon, MailIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/coss/ui/avatar.tsx";
import { type UserProfile, userProfileQueryOptions } from "@/functions/users.ts";
import { cn } from "@/lib/cn.ts";

// Fallback tints, picked per id so a user keeps their colour across the admin.
const tints = [
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-teal-500/15 text-teal-700 dark:text-teal-300",
];

const sizes = {
  sm: "size-6 text-[0.65rem]",
  md: "size-8 text-xs",
  lg: "size-12 text-base",
} as const;

export const profileName = (id: number, profile: UserProfile | null | undefined) =>
  profile?.name ?? (profile?.username ? `@${profile.username}` : `用户 ${id}`);

export function UserAvatar({
  id,
  profile,
  size = "md",
}: {
  id: number;
  profile: UserProfile | null | undefined;
  size?: keyof typeof sizes;
}) {
  const initial = Array.from(profileName(id, profile).replace(/^@|^用户 /, ""))[0] ?? "?";
  return (
    <Avatar className={sizes[size]}>
      {profile?.avatarUrl && <AvatarImage src={profile.avatarUrl} alt="" />}
      <AvatarFallback className={cn("font-semibold", tints[id % tints.length])}>
        {initial.toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * A Telegram user wherever the admin shows one: avatar, name, then @username and id. Profiles are
 * fetched in one batched request per page (see `userProfileQueryOptions`).
 */
export function UserChip({
  id,
  size = "md",
  showId = false,
  className,
}: {
  id: number;
  size?: keyof typeof sizes;
  /** Add the numeric id to the second line, for places where it's what the admin acts on. */
  showId?: boolean;
  className?: string;
}) {
  const { data: profile } = useQuery(userProfileQueryOptions(id));
  const secondary = [profile?.username && `@${profile.username}`, showId && String(id)]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <UserAvatar id={id} profile={profile} size={size} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-medium">{profileName(id, profile)}</span>
        {secondary && size !== "sm" && (
          <span className="truncate font-mono text-muted-foreground text-xs">{secondary}</span>
        )}
      </span>
    </span>
  );
}

/** Audit actors: `tg:<id>` is a user, `email:<addr>` an Access login, `system` the scheduled jobs. */
export function ActorChip({ actor, size = "sm" }: { actor: string; size?: keyof typeof sizes }) {
  if (actor.startsWith("tg:")) {
    const id = Number(actor.slice(3));
    if (Number.isSafeInteger(id)) return <UserChip id={id} size={size} />;
  }
  const email = actor.startsWith("email:") ? actor.slice(6) : null;
  const Icon = email ? MailIcon : BotIcon;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className={cn("grid shrink-0 place-items-center rounded-full bg-muted", sizes[size])}>
        <Icon className="size-3.5 text-muted-foreground" aria-hidden />
      </span>
      <span className="truncate">{email ?? (actor === "system" ? "系统" : actor)}</span>
    </span>
  );
}
