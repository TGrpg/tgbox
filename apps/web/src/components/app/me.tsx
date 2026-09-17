import { type AppOrder, type AppSubmission, type Locale, PrefsResult } from "@tgbox/shared";
import { LanguagesIcon, MousePointerClickIcon, SendIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/coss/ui/button";
import { localizePath } from "@/i18n/locale.ts";
import { appUi } from "@/i18n/ui-app.ts";
import { cn } from "@/lib/cn.ts";
import { fill } from "@/lib/format.ts";
import { apiCall } from "./api.ts";
import { appAmount, appDate } from "./format.ts";
import { storeLocale } from "./locale.ts";
import { ErrorScreen, LoadingScreen, screenPaths } from "./shell.tsx";
import { useMe } from "./use-me.ts";

type Tab = "submissions" | "orders";

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

function SubmissionRow({ item, locale }: { item: AppSubmission; locale: Locale }) {
  const strings = appUi(locale).me;
  // Moderators pick from a fixed list; anything else is free text the reviewer typed.
  const reasons: Record<string, string> = strings.rejectReasons;
  const reason =
    item.rejectReason === null ? null : (reasons[item.rejectReason] ?? item.rejectReason);
  return (
    <li className="flex flex-col gap-1.5 rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-sm">@{item.username}</span>
        <Badge label={strings.status[item.status]} status={item.status} />
      </div>
      <p className="text-muted-foreground text-xs">
        {fill(strings.submitted, { date: appDate(item.createdAt, locale) })}
        {item.reviewedAt !== null &&
          ` · ${fill(strings.reviewed, { date: appDate(item.reviewedAt, locale) })}`}
      </p>
      {item.status === "rejected" && reason && (
        <p className="rounded-xl bg-error/10 px-2.5 py-2 text-xs">
          <span className="font-medium">{strings.rejectReason}：</span>
          {reason}
        </p>
      )}
    </li>
  );
}

function OrderRow({ item, locale }: { item: AppOrder; locale: Locale }) {
  const strings = appUi(locale);
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
        <p className="flex items-center gap-1 text-primary-accent text-xs">
          <MousePointerClickIcon className="size-3.5" aria-hidden />
          {fill(strings.me.clicks, { n: item.clicks })}
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

/** Saves the choice server-side (so the bot speaks it too) before reloading in the other locale. */
function LanguageSwitch({ locale }: { locale: Locale }) {
  const other: Locale = locale === "zh" ? "en" : "zh";
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
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

/** Submissions (with the rejection reason, which users cannot see anywhere else) and orders. */
export function MeScreen({ locale, botUrl }: { locale: Locale; botUrl: string }) {
  const strings = appUi(locale);
  const { state, reload } = useMe();
  const [tab, setTab] = useState<Tab>("submissions");
  const tabs: Tab[] = ["submissions", "orders"];

  if (state.status === "loading") return <LoadingScreen label={strings.common.loading} />;
  if (state.status === "error") {
    return <ErrorScreen locale={locale} error={state.error} onRetry={reload} />;
  }

  const { submissions, orders } = state.me;

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-lg">{strings.me.title}</h1>
        <LanguageSwitch locale={locale} />
      </div>
      <div role="tablist" aria-label={strings.me.title} className="flex gap-1.5">
        {tabs.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={key === tab}
            onClick={() => setTab(key)}
            className={cn(
              "h-9 flex-1 rounded-full border border-border text-sm transition-colors",
              key === tab
                ? "border-primary/40 bg-primary-soft font-semibold text-primary-soft-foreground"
                : "text-muted-foreground",
            )}
          >
            {strings.me.tabs[key]}
          </button>
        ))}
      </div>

      {tab === "submissions" ? (
        submissions.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground text-sm">
            {strings.me.submissionsEmpty}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {submissions.map((item) => (
              <SubmissionRow key={item.id} item={item} locale={locale} />
            ))}
          </ul>
        )
      ) : orders.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground text-sm">{strings.me.ordersEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {orders.map((item) => (
            <OrderRow key={item.id} item={item} locale={locale} />
          ))}
        </ul>
      )}

      <Button variant="ghost" render={<a href={botUrl} rel="noopener" target="_blank" />}>
        <SendIcon aria-hidden />
        {strings.outside.openBot}
      </Button>
    </div>
  );
}
