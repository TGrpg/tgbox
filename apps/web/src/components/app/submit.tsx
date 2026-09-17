import {
  type AppPreview,
  type Locale,
  PreviewResult,
  parseTelegramRef,
  type SubmitError,
  SubmitResult,
} from "@tgbox/shared";
import { CheckCircle2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/coss/ui/button";
import { Spinner } from "@/components/coss/ui/spinner";
import { localizePath } from "@/i18n/locale.ts";
import { appUi } from "@/i18n/ui-app.ts";
import type { AppTaxonomy } from "@/lib/app-data.ts";
import { fill, formatNumber } from "@/lib/format.ts";
import { apiCall } from "./api.ts";
import { ErrorScreen, LoadingScreen, PrimaryAction, screenPaths } from "./shell.tsx";
import { CategoryGrid, TagPicker } from "./taxonomy.tsx";
import { useMe } from "./use-me.ts";
import { useStaticJson } from "./use-static.ts";

type Step =
  | { name: "link" }
  | { name: "form"; preview: AppPreview }
  | { name: "done"; submissionId: number };

/**
 * One form instead of the bot's four-step inline keyboard: paste a link, confirm what t.me says,
 * pick a category and tags, submit. The bot has to pack tag choices into a base-36 bitmask to fit
 * Telegram's 64-byte callback limit (`apps/bot/src/bot/submit.ts`); here they are just chips.
 */
export function SubmitScreen({ locale }: { locale: Locale }) {
  const strings = appUi(locale);
  const taxonomy = useStaticJson<AppTaxonomy>("/data/app-taxonomy.json");
  const { state: me, reload } = useMe();

  const [step, setStep] = useState<Step>({ name: "link" });
  const [link, setLink] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (me.status === "loading" || taxonomy.status === "loading") {
    return <LoadingScreen label={strings.common.loading} />;
  }
  if (me.status === "error")
    return <ErrorScreen locale={locale} error={me.error} onRetry={reload} />;
  if (taxonomy.status === "error") {
    return <ErrorScreen locale={locale} error="offline" onRetry={() => window.location.reload()} />;
  }

  const { limits } = me.me;
  const remaining = Math.max(0, limits.submitDailyLimit - limits.submittedToday);
  const blocked = !limits.submissionsOpen || remaining === 0;

  async function check() {
    const username = parseTelegramRef(link);
    if (username === null) {
      setError(strings.submit.errors.invalid);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await apiCall(
      `/preview?username=${encodeURIComponent(username)}`,
      PreviewResult,
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error === "banned" ? strings.common.banned : strings.common.error);
      return;
    }
    if (!result.data.ok) {
      setError(
        result.data.error === "invalid"
          ? strings.submit.errors.invalid
          : strings.submit.errors.not_found,
      );
      return;
    }
    // Pre-selected, not decided: both pickers below stay fully editable, and the hint says so.
    const { suggestion } = result.data.preview;
    setCategoryId(suggestion.categoryId);
    setTagIds(suggestion.tagIds);
    setStep({ name: "form", preview: result.data.preview });
  }

  async function send(preview: AppPreview) {
    if (categoryId === null) {
      setError(strings.submit.errors.needCategory);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await apiCall("/submit", SubmitResult, {
      json: { username: preview.username, categoryId, tagIds },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error === "banned" ? strings.common.banned : strings.common.error);
      return;
    }
    if (!result.data.ok) {
      const key: SubmitError = result.data.error;
      setError(strings.submit.errors[key]);
      return;
    }
    reload();
    setStep({ name: "done", submissionId: result.data.submissionId });
  }

  function restart() {
    setStep({ name: "link" });
    setLink("");
    setCategoryId(null);
    setTagIds([]);
    setError(null);
  }

  if (step.name === "done") {
    return (
      <div className="flex flex-col items-center gap-4 px-6 pt-16 text-center">
        <CheckCircle2Icon className="size-12 text-success-foreground" aria-hidden />
        <h1 className="font-semibold text-lg">{strings.submit.successTitle}</h1>
        <p className="text-muted-foreground text-sm">{strings.submit.successLead}</p>
        <div className="flex w-full flex-col gap-2 pt-2">
          <Button render={<a href={localizePath(screenPaths.me, locale)} />}>
            {strings.submit.viewMine}
          </Button>
          <Button variant="ghost" onClick={restart}>
            {strings.submit.again}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <header>
        <h1 className="font-semibold text-lg">{strings.submit.title}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{strings.submit.lead}</p>
      </header>

      <p className="rounded-xl bg-muted px-3 py-2 text-muted-foreground text-xs">
        {!limits.submissionsOpen
          ? strings.submit.errors.closed
          : remaining === 0
            ? strings.submit.noneLeft
            : fill(strings.submit.remaining, { n: remaining })}
      </p>

      {step.name === "link" ? (
        <div className="flex flex-col gap-2">
          <label className="font-medium text-sm" htmlFor="app-submit-link">
            {strings.submit.linkLabel}
          </label>
          <input
            id="app-submit-link"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={link}
            disabled={blocked}
            onChange={(event) => setLink(event.target.value)}
            placeholder={strings.submit.linkPlaceholder}
            className="h-11 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-primary"
          />
          {busy && (
            <p className="flex items-center gap-2 text-muted-foreground text-xs">
              <Spinner className="size-3.5" />
              {strings.submit.checking}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <h2 className="font-medium text-sm">{strings.submit.previewLabel}</h2>
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
              <img
                src={step.preview.avatarUrl ?? "/images/default-avatar.svg"}
                alt=""
                width="48"
                height="48"
                className="size-12 shrink-0 rounded-full bg-muted object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-sm" dir="auto">
                  {step.preview.title}
                </p>
                <p className="truncate text-muted-foreground text-xs">
                  @{step.preview.username} · {strings.kind[step.preview.kind]}
                  {step.preview.members !== null &&
                    ` · ${formatNumber(step.preview.members, locale, { compact: true })} ${strings.members[step.preview.kind]}`}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={restart}>
                {strings.submit.change}
              </Button>
            </div>
            {step.preview.description && (
              <p className="line-clamp-3 text-muted-foreground text-xs" dir="auto">
                {step.preview.description}
              </p>
            )}
          </section>

          {(step.preview.suggestion.categoryId !== null ||
            step.preview.suggestion.tagIds.length > 0) && (
            <p className="rounded-xl bg-muted px-3 py-2 text-muted-foreground text-xs">
              {strings.submit.suggestionHint}
            </p>
          )}

          <section className="flex flex-col gap-2">
            <h2 className="font-medium text-sm">{strings.submit.categoryLabel}</h2>
            <CategoryGrid
              categories={taxonomy.data.categories}
              kind={step.preview.kind}
              locale={locale}
              value={categoryId}
              onChange={setCategoryId}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-medium text-sm">{strings.submit.tagLabel}</h2>
            <TagPicker
              tags={taxonomy.data.tags}
              locale={locale}
              selected={tagIds}
              onChange={setTagIds}
            />
          </section>
        </div>
      )}

      {error && <p className="text-error text-sm">{error}</p>}

      <div className="pt-2">
        {step.name === "link" ? (
          <PrimaryAction
            text={strings.submit.check}
            disabled={blocked || link.trim() === ""}
            loading={busy}
            onClick={() => void check()}
          />
        ) : (
          <PrimaryAction
            text={busy ? strings.submit.submitting : strings.submit.submitButton}
            disabled={blocked || categoryId === null}
            loading={busy}
            onClick={() => void send(step.preview)}
          />
        )}
      </div>
    </div>
  );
}
