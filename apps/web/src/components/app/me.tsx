import type { AppOrder, AppSubmission, Locale, OrderStatus, SubmissionStatus } from "@tgbox/shared";
import { PrefsResult } from "@tgbox/shared";
import {
  ChevronRightIcon,
  HeadsetIcon,
  LanguagesIcon,
  MegaphoneIcon,
  MousePointerClickIcon,
  PlusIcon,
  SendIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/coss/ui/button";
import { localizePath } from "@/i18n/locale.ts";
import { appUi } from "@/i18n/ui-app.ts";
import { daysLeft, meCounts } from "@/lib/app-me.ts";
import { cn } from "@/lib/cn.ts";
import { fill } from "@/lib/format.ts";
import { apiCall } from "./api.ts";
import { appAmount, appDate } from "./format.ts";
import { storeLocale } from "./locale.ts";
import { ErrorScreen, LoadingScreen, screenPaths, useWebApp } from "./shell.tsx";
import { launchUser } from "./telegram.ts";
import { useMe } from "./use-me.ts";

type Tab = "submissions" | "orders";

/** What the records list shows: a tab, optionally narrowed to one status from the overview. */
type View =
  | { tab: "submissions"; status: SubmissionStatus | null }
  | { tab: "orders"; status: OrderStatus | null };

const statusTone: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  approved: "bg-success text-success-foreground",
  rejected: "bg-error text-error-foreground",
  paid: "bg-warning text-warning-foreground",
  active: "bg-success text-success-foreground",
  expired: "bg-muted text-muted-foreground",
  refunded: "bg-info text-info-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

// Fallback tints, picked per id so a user keeps their colour (same palette as the admin's chips).
const tints = [
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-teal-500/15 text-teal-700 dark:text-teal-300",
];

/** Links leave the Mini App for Telegram's in-app browser; outside Telegram a new tab does. */
function useOpen() {
  const webApp = useWebApp();
  return {
    link: (url: string) => (webApp ? webApp.openLink(url) : window.open(url, "_blank", "noopener")),
    telegram: (url: string) =>
      webApp ? webApp.openTelegramLink(url) : window.open(url, "_blank", "noopener"),
  };
}

function Badge({ label, status }: { label: string; status: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 font-medium text-[0.7rem]",
        statusTone[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function Avatar({ id, name, photoUrl }: { id: number; name: string; photoUrl: string | null }) {
  const [broken, setBroken] = useState(false);
  const initial = Array.from(name)[0]?.toUpperCase() ?? "?";
  return photoUrl && !broken ? (
    <img
      src={photoUrl}
      alt=""
      className="size-14 shrink-0 rounded-full object-cover"
      onError={() => setBroken(true)}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        "grid size-14 shrink-0 place-items-center rounded-full font-semibold text-xl",
        tints[Math.abs(id) % tints.length],
      )}
    >
      {initial}
    </span>
  );
}

/** Saves the choice server-side (so the bot speaks it too) before reloading in the other locale. */
function LanguageSwitch({ locale }: { locale: Locale }) {
  const other: Locale = locale === "zh" ? "en" : "zh";
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      className="shrink-0 rounded-full"
      loading={busy}
      onClick={() => {
        setBusy(true);
        storeLocale(other);
        void apiCall("/prefs", PrefsResult, { json: { locale: other } }).finally(() => {
          window.location.href = localizePath(screenPaths.me, other);
        });
      }}
    >
      <LanguagesIcon aria-hidden />
      {appUi(locale).common.switchLang}
    </Button>
  );
}

/** Who is signed in, straight from the launch data: no request, and never used for auth. */
function ProfileHeader({ locale, userId }: { locale: Locale; userId: number }) {
  const strings = appUi(locale).me;
  const user = launchUser();
  const name =
    [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
    (user?.username ? `@${user.username}` : strings.anonymous);
  return (
    <header className="flex items-center gap-3">
      <Avatar id={userId} name={name} photoUrl={user?.photo_url ?? null} />
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate font-semibold text-lg leading-tight">{name}</h1>
        {user?.username && (
          <p className="truncate text-muted-foreground text-sm">@{user.username}</p>
        )}
      </div>
      <LanguageSwitch locale={locale} />
    </header>
  );
}

function Overview({
  locale,
  counts,
  onPick,
}: {
  locale: Locale;
  counts: ReturnType<typeof meCounts>;
  onPick: (view: View) => void;
}) {
  const labels = appUi(locale).me.overview;
  const cells: { key: keyof typeof counts; view: View; alert?: boolean }[] = [
    { key: "listed", view: { tab: "submissions", status: "approved" } },
    { key: "reviewing", view: { tab: "submissions", status: "pending" } },
    { key: "running", view: { tab: "orders", status: "active" } },
    { key: "unpaid", view: { tab: "orders", status: "pending" }, alert: counts.unpaid > 0 },
  ];
  return (
    <div className="grid grid-cols-4 rounded-2xl border border-border bg-card py-3">
      {cells.map(({ key, view, alert }) => (
        <button
          key={key}
          type="button"
          onClick={() => onPick(view)}
          className="flex flex-col items-center gap-0.5 rounded-xl px-1 transition-colors active:bg-muted"
        >
          <span
            className={cn(
              "font-semibold text-xl tabular-nums",
              alert ? "text-warning-foreground" : counts[key] === 0 && "text-muted-foreground",
            )}
          >
            {counts[key]}
          </span>
          <span
            className={cn(
              "text-xs",
              alert ? "font-medium text-warning-foreground" : "text-muted-foreground",
            )}
          >
            {labels[key]}
          </span>
        </button>
      ))}
    </div>
  );
}

function Shortcut({
  icon,
  label,
  href,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="grid size-11 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground [&_svg]:size-5">
        {icon}
      </span>
      <span className="text-xs">{label}</span>
    </>
  );
  const className =
    "flex flex-col items-center gap-1.5 rounded-xl py-1 transition-colors active:bg-muted";
  return href ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

function Shortcuts({
  locale,
  siteUrl,
  botUrl,
}: {
  locale: Locale;
  siteUrl: string;
  botUrl: string;
}) {
  const strings = appUi(locale).me.actions;
  const open = useOpen();
  return (
    <nav aria-label={strings.label} className="grid grid-cols-4">
      <Shortcut
        icon={<PlusIcon aria-hidden />}
        label={strings.submit}
        href={localizePath(screenPaths.submit, locale)}
      />
      <Shortcut
        icon={<MegaphoneIcon aria-hidden />}
        label={strings.promote}
        href={localizePath(screenPaths.promote, locale)}
      />
      <Shortcut
        icon={<SparklesIcon aria-hidden />}
        label={strings.advertise}
        onClick={() => open.link(`${siteUrl}${localizePath("/advertise/", locale)}`)}
      />
      <Shortcut
        icon={<HeadsetIcon aria-hidden />}
        label={strings.support}
        onClick={() => open.telegram(`${botUrl}?start=support`)}
      />
    </nav>
  );
}

function SubmissionRow({
  item,
  locale,
  siteUrl,
}: {
  item: AppSubmission;
  locale: Locale;
  siteUrl: string;
}) {
  const strings = appUi(locale).me;
  const open = useOpen();
  // Moderators pick from a fixed list; anything else is free text the reviewer typed.
  const reasons: Record<string, string> = strings.rejectReasons;
  const reason =
    item.rejectReason === null ? null : (reasons[item.rejectReason] ?? item.rejectReason);
  const listed = item.status === "approved";
  const head = (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-semibold text-sm">@{item.username}</span>
      <Badge label={strings.status[item.status]} status={item.status} />
      {listed && <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />}
    </div>
  );
  const dates = (
    <p className="text-muted-foreground text-xs">
      {fill(strings.submitted, { date: appDate(item.createdAt, locale) })}
      {item.reviewedAt !== null &&
        ` · ${fill(strings.reviewed, { date: appDate(item.reviewedAt, locale) })}`}
    </p>
  );
  const card = "flex w-full flex-col gap-1.5 rounded-2xl border border-border bg-card p-3";
  return (
    <li>
      {listed ? (
        <button
          type="button"
          aria-label={`${strings.viewListing} @${item.username}`}
          onClick={() =>
            open.link(`${siteUrl}${localizePath(`/detail/${item.username}/`, locale)}`)
          }
          className={cn(card, "text-left transition-colors active:bg-muted")}
        >
          {head}
          {dates}
        </button>
      ) : (
        <div className={card}>
          {head}
          {dates}
          {item.status === "rejected" && reason && (
            <p className="rounded-xl bg-error/10 px-2.5 py-2 text-xs">
              <span className="font-medium">{strings.rejectReason}：</span>
              {reason}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function OrderRow({ item, locale }: { item: AppOrder; locale: Locale }) {
  const strings = appUi(locale);
  const left = item.endsAt === null ? null : daysLeft(item.endsAt, Date.now());
  return (
    <li className="flex flex-col gap-1.5 rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-sm">{item.productName}</span>
        <Badge label={strings.me.orderStatus[item.status]} status={item.status} />
      </div>
      <p className="text-muted-foreground text-xs">
        {strings.promote.productKind[item.kind]} · {appAmount(item.amount, item.currency)} ·{" "}
        {fill(strings.me.created, { date: appDate(item.createdAt, locale) })}
      </p>
      {item.targetUsername && (
        <p className="text-muted-foreground text-xs">
          {strings.me.target}: @{item.targetUsername}
        </p>
      )}
      {item.startsAt !== null && item.endsAt !== null && (
        <p className="text-muted-foreground text-xs">
          {fill(strings.me.period, {
            start: appDate(item.startsAt, locale),
            end: appDate(item.endsAt, locale),
          })}
        </p>
      )}
      {item.status === "active" && (
        <p className="flex items-center gap-3 text-primary-accent text-xs">
          {left !== null && (
            <span className="font-medium">
              {left === 0
                ? strings.me.endingSoon
                : left === 1
                  ? strings.me.oneDayLeft
                  : fill(strings.me.daysLeft, { n: left })}
            </span>
          )}
          <span className="flex items-center gap-1">
            <MousePointerClickIcon className="size-3.5" aria-hidden />
            {fill(strings.me.clicks, { n: item.clicks })}
          </span>
        </p>
      )}
      {item.status === "pending" && (
        <Button
          size="sm"
          className="self-start"
          render={<a href={`${localizePath(screenPaths.promote, locale)}?order=${item.id}`} />}
        >
          {strings.me.pay}
        </Button>
      )}
    </li>
  );
}

function Empty({ text, action, href }: { text: string; action: string; href: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <p className="text-muted-foreground text-sm">{text}</p>
      <Button size="sm" variant="outline" className="rounded-full" render={<a href={href} />}>
        {action}
      </Button>
    </div>
  );
}

/**
 * The user's own corner of the app: who they are, where their submissions and orders stand,
 * shortcuts to everything they can do, then the records themselves (with the rejection reason,
 * which users cannot see anywhere else). All of it from the one `/me` request of the session.
 */
export function MeScreen({
  locale,
  siteUrl,
  botUrl,
}: {
  locale: Locale;
  siteUrl: string;
  botUrl: string;
}) {
  const strings = appUi(locale);
  const { state, reload } = useMe();
  const [view, setView] = useState<View>({ tab: "submissions", status: null });
  const records = useRef<HTMLElement>(null);
  const tabs: Tab[] = ["submissions", "orders"];

  if (state.status === "loading") return <LoadingScreen label={strings.common.loading} />;
  if (state.status === "error") {
    return <ErrorScreen locale={locale} error={state.error} onRetry={reload} />;
  }

  const { user, submissions, orders } = state.me;
  const submissionsShown =
    view.tab === "submissions" && view.status !== null
      ? submissions.filter((item) => item.status === view.status)
      : submissions;
  const ordersShown =
    view.tab === "orders" && view.status !== null
      ? orders.filter((item) => item.status === view.status)
      : orders;
  const statusLabel =
    view.status === null
      ? null
      : view.tab === "submissions"
        ? strings.me.status[view.status]
        : strings.me.orderStatus[view.status];

  let list: ReactNode;
  if (view.tab === "submissions") {
    list =
      submissionsShown.length === 0 ? (
        view.status === null ? (
          <Empty
            text={strings.me.submissionsEmpty}
            action={strings.me.goSubmit}
            href={localizePath(screenPaths.submit, locale)}
          />
        ) : (
          <p className="py-10 text-center text-muted-foreground text-sm">
            {strings.me.filteredEmpty}
          </p>
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {submissionsShown.map((item) => (
            <SubmissionRow key={item.id} item={item} locale={locale} siteUrl={siteUrl} />
          ))}
        </ul>
      );
  } else {
    list =
      ordersShown.length === 0 ? (
        view.status === null ? (
          <Empty
            text={strings.me.ordersEmpty}
            action={strings.me.goPromote}
            href={localizePath(screenPaths.promote, locale)}
          />
        ) : (
          <p className="py-10 text-center text-muted-foreground text-sm">
            {strings.me.filteredEmpty}
          </p>
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {ordersShown.map((item) => (
            <OrderRow key={item.id} item={item} locale={locale} />
          ))}
        </ul>
      );
  }

  return (
    <div className="flex flex-col gap-5 px-4 pt-5">
      <ProfileHeader locale={locale} userId={user.id} />
      <Overview
        locale={locale}
        counts={meCounts(state.me)}
        onPick={(next) => {
          setView(next);
          records.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />
      <Shortcuts locale={locale} siteUrl={siteUrl} botUrl={botUrl} />

      <section ref={records} className="flex scroll-mt-4 flex-col gap-3">
        <h2 className="font-semibold text-base">{strings.me.records}</h2>
        <div role="tablist" aria-label={strings.me.records} className="flex gap-1.5">
          {tabs.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === view.tab}
              onClick={() => setView({ tab: key, status: null })}
              className={cn(
                "h-9 flex-1 rounded-full border border-border text-sm transition-colors",
                key === view.tab
                  ? "border-primary/40 bg-primary-soft font-semibold text-primary-soft-foreground"
                  : "text-muted-foreground",
              )}
            >
              {strings.me.tabs[key]}
            </button>
          ))}
        </div>
        {statusLabel && (
          <button
            type="button"
            onClick={() => setView({ tab: view.tab, status: null })}
            aria-label={strings.me.clearFilter}
            className="flex items-center gap-1 self-start rounded-full bg-muted px-3 py-1 text-xs"
          >
            {fill(strings.me.only, { status: statusLabel })}
            <XIcon className="size-3.5" aria-hidden />
          </button>
        )}
        {list}
      </section>

      <Button variant="ghost" render={<a href={botUrl} rel="noopener" target="_blank" />}>
        <SendIcon aria-hidden />
        {strings.outside.openBot}
      </Button>
    </div>
  );
}
