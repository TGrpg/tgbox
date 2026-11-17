import {
  BannerContent,
  CreateOrderResult,
  isEntryProduct,
  type Locale,
  OrderStatusResult,
  PayResult,
  type ProductView,
  UploadResult,
} from "@tgbox/shared";
import { CheckCircle2Icon, CopyIcon, ImageIcon, TriangleAlertIcon } from "lucide-react";
import QRCode from "qrcode";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/coss/ui/button";
import { Spinner } from "@/components/coss/ui/spinner";
import { localizePath } from "@/i18n/locale.ts";
import { appUi } from "@/i18n/ui-app.ts";
import { type AppProducts, payMethods } from "@/lib/app-data.ts";
import { cn } from "@/lib/cn.ts";
import { fill } from "@/lib/format.ts";
import { startUsdtPolling, withCheckTimeout } from "@/lib/usdt-poll.ts";
import { apiCall } from "./api.ts";
import { BannerCard } from "./banner-card.tsx";
import { appDate, appDateTime } from "./format.ts";
import {
  ErrorScreen,
  LoadingScreen,
  PrimaryAction,
  screenPaths,
  useBackHandler,
  useWebApp,
} from "./shell.tsx";
import { forgetMe } from "./use-me.ts";
import { useStaticJson } from "./use-static.ts";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

type Stage =
  | { name: "products" }
  | { name: "details"; product: ProductView }
  | { name: "pay"; orderId: number }
  | { name: "usdt"; orderId: number; address: string; amount: string; expiresAt: number }
  | { name: "paid" };

/**
 * Polls one order while a USDT payment is open. This is the only polling in the app: only while the
 * screen is actually visible, and only until the quote's grace period is over (`startUsdtPolling`).
 * After that `stopped` turns on and the buyer checks by hand with `checkNow`.
 */
function useOrderPolling(orderId: number, expiresAt: number, onPaid: () => void) {
  const latest = useRef(onPaid);
  useEffect(() => {
    latest.current = onPaid;
  }, [onPaid]);
  const [stopped, setStopped] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const paid = async (signal: AbortSignal) => {
      const result = await apiCall(`/orders/${orderId}`, OrderStatusResult, { signal });
      return result.ok && result.data.paidAt !== null;
    };
    setStopped(false);
    const polling = startUsdtPolling({
      expiresAt,
      check: paid,
      visible: () => document.visibilityState === "visible",
      onPaid: () => latest.current(),
      onStop: () => setStopped(true),
    });
    document.addEventListener("visibilitychange", polling.wake);
    return () => {
      polling.stop();
      document.removeEventListener("visibilitychange", polling.wake);
    };
  }, [orderId, expiresAt]);

  const checkNow = useCallback(async () => {
    setChecking(true);
    const result = await withCheckTimeout((signal) =>
      apiCall(`/orders/${orderId}`, OrderStatusResult, { signal }),
    );
    setChecking(false);
    if (result.ok && result.data.paidAt !== null) latest.current();
  }, [orderId]);

  return { stopped, checking, checkNow };
}

/** Flips to true when `at` passes, so the screen re-renders without a ticking clock. */
function usePassed(at: number): boolean {
  const [passed, setPassed] = useState(() => Date.now() > at);
  useEffect(() => {
    const left = at - Date.now();
    setPassed(left < 0);
    if (left < 0) return;
    const timer = window.setTimeout(() => setPassed(true), left + 1);
    return () => window.clearTimeout(timer);
  }, [at]);
  return passed;
}

function CopyRow({
  label,
  value,
  copy,
  copied,
}: {
  label: string;
  value: string;
  copy: string;
  copied: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-sm">{value}</code>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={done ? copied : copy}
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setDone(true);
            window.setTimeout(() => setDone(false), 1500);
          }}
        >
          {done ? <CheckCircle2Icon aria-hidden /> : <CopyIcon aria-hidden />}
        </Button>
      </div>
    </div>
  );
}

export function PromoteScreen({ locale }: { locale: Locale }) {
  const strings = appUi(locale);
  const webApp = useWebApp();
  const catalogue = useStaticJson<AppProducts>("/data/app-products.json");

  const [stage, setStage] = useState<Stage>(() => {
    const order = Number(new URLSearchParams(window.location.search).get("order"));
    return Number.isInteger(order) && order > 0
      ? { name: "pay", orderId: order }
      : { name: "products" };
  });
  const [target, setTarget] = useState("");
  const [banner, setBanner] = useState({ title: "", subtitle: "", href: "" });
  const [image, setImage] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toProducts = useCallback(() => {
    setStage({ name: "products" });
    setError(null);
  }, []);
  useBackHandler(stage.name === "details" ? toProducts : null);

  const onPaid = useCallback(() => {
    forgetMe();
    setStage({ name: "paid" });
  }, []);

  if (catalogue.status === "loading") return <LoadingScreen label={strings.common.loading} />;
  if (catalogue.status === "error") {
    return <ErrorScreen locale={locale} error="offline" onRetry={() => window.location.reload()} />;
  }
  const { products } = catalogue.data;
  const methods = payMethods(catalogue.data.payments);

  /** Only the prices a buyer can actually pay — the operator may have either method switched off. */
  function priceLine(product: ProductView) {
    return methods
      .map((method) =>
        method === "stars"
          ? fill(strings.promote.stars, { n: product.priceStars })
          : fill(strings.promote.usdt, { n: product.priceUsdt }),
      )
      .join(` ${strings.promote.or} `);
  }

  function pickImage(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) return setError(strings.promote.errors.image_too_large);
    if (!IMAGE_TYPES.includes(file.type)) return setError(strings.promote.errors.image_type);
    setError(null);
    setImage({ file, url: URL.createObjectURL(file) });
  }

  async function createOrder(product: ProductView) {
    setError(null);
    const forEntry = isEntryProduct(product.kind);
    const content = forEntry
      ? { success: true as const, data: undefined }
      : BannerContent.safeParse({ ...banner, imageUrl: null });
    if (!content.success) return setError(strings.promote.errors.invalid_banner);
    if (forEntry && target.trim() === "") {
      return setError(strings.promote.errors.invalid_target);
    }

    setBusy(true);
    const created = await apiCall("/orders", CreateOrderResult, {
      json: {
        productId: product.id,
        ...(forEntry ? { targetUsername: target.trim().replace(/^@/, "") } : {}),
        ...(content.data ? { banner: content.data } : {}),
      },
    });
    if (!created.ok) {
      setBusy(false);
      return setError(created.error === "banned" ? strings.common.banned : strings.common.error);
    }
    if (!created.data.ok) {
      setBusy(false);
      const messages: Record<string, string> = strings.promote.errors;
      const nextFreeAt = created.data.nextFreeAt;
      return setError(
        nextFreeAt === undefined
          ? (messages[created.data.error] ?? strings.promote.errors.generic)
          : fill(strings.promote.errors.no_slots, { date: appDate(nextFreeAt, locale) }),
      );
    }

    const orderId = created.data.orderId;
    forgetMe();
    // Only the home banner carries an image; the announcement bar is text.
    if (image && product.kind === "banner") {
      const form = new FormData();
      form.append("image", image.file);
      form.append("orderId", String(orderId));
      const upload = await apiCall("/upload", UploadResult, { form });
      if (!upload.ok || !upload.data.ok) setError(strings.promote.uploadFailed);
    }
    setBusy(false);
    setStage({ name: "pay", orderId });
  }

  async function pay(orderId: number, method: "stars" | "usdt") {
    setBusy(true);
    setError(null);
    const result = await apiCall(`/orders/${orderId}/pay`, PayResult, { json: { method } });
    setBusy(false);
    if (!result.ok) {
      return setError(result.error === "banned" ? strings.common.banned : strings.common.error);
    }
    if (!result.data.ok) {
      const messages: Record<string, string> = strings.promote.errors;
      return setError(messages[result.data.error] ?? strings.promote.errors.generic);
    }
    if (result.data.method === "stars") {
      const invoice = result.data.invoiceLink;
      if (webApp) webApp.openInvoice(invoice, (status) => status === "paid" && onPaid());
      else window.open(invoice, "_blank", "noopener");
      return;
    }
    setStage({
      name: "usdt",
      orderId,
      address: result.data.address,
      amount: result.data.amount,
      expiresAt: result.data.expiresAt,
    });
  }

  if (stage.name === "paid") {
    return (
      <div className="flex flex-col items-center gap-4 px-6 pt-16 text-center">
        <CheckCircle2Icon className="size-12 text-success-foreground" aria-hidden />
        <h1 className="font-semibold text-lg">{strings.promote.paidTitle}</h1>
        <p className="text-muted-foreground text-sm">{strings.promote.paidLead}</p>
        <Button render={<a href={localizePath(screenPaths.me, locale)} />}>
          {strings.promote.viewOrders}
        </Button>
      </div>
    );
  }

  if (stage.name === "usdt") {
    return (
      <UsdtPayment
        locale={locale}
        orderId={stage.orderId}
        onPaid={onPaid}
        address={stage.address}
        amount={stage.amount}
        expiresAt={stage.expiresAt}
      />
    );
  }

  if (stage.name === "pay") {
    return (
      <div className="flex flex-col gap-4 px-4 pt-4">
        <h1 className="font-semibold text-lg">
          {fill(strings.promote.payTitle, { id: stage.orderId })}
        </h1>
        {error && <p className="text-error text-sm">{error}</p>}
        {methods.length === 0 && (
          <p className="text-muted-foreground text-sm">
            {strings.promote.errors.no_payment_method}
          </p>
        )}
        {methods.map((method, index) => (
          <Fragment key={method}>
            {index > 0 && (
              <p className="text-center text-muted-foreground text-xs">{strings.promote.or}</p>
            )}
            <Button
              size="lg"
              variant={index === 0 ? "default" : "outline"}
              loading={busy}
              onClick={() => void pay(stage.orderId, method)}
            >
              {method === "stars" ? strings.promote.payStars : strings.promote.payUsdt}
            </Button>
          </Fragment>
        ))}
      </div>
    );
  }

  if (stage.name === "details") {
    const product = stage.product;
    return (
      <div className="flex flex-col gap-4 px-4 pt-4">
        <header>
          <h1 className="font-semibold text-lg">
            {locale === "zh" ? product.nameZh : product.nameEn}
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            {fill(strings.promote.days, { n: product.days })} · {priceLine(product)}
          </p>
        </header>

        {isEntryProduct(product.kind) ? (
          <div className="flex flex-col gap-2">
            <label className="font-medium text-sm" htmlFor="promote-target">
              {strings.promote.targetLabel}
            </label>
            <input
              id="promote-target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder={strings.promote.targetPlaceholder}
              autoCapitalize="none"
              spellCheck={false}
              className="h-11 rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-primary"
            />
            <p className="text-muted-foreground text-xs">{strings.promote.targetHint}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <h2 className="font-medium text-sm">{strings.promote.bannerLabel}</h2>
            {(
              [
                ["title", strings.promote.bannerTitle, 20],
                ["subtitle", strings.promote.bannerSubtitle, 40],
                ["href", strings.promote.bannerHref, 300],
              ] as const
            ).map(([field, label, max]) => (
              <label key={field} className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{label}</span>
                <input
                  value={banner[field]}
                  maxLength={max}
                  inputMode={field === "href" ? "url" : "text"}
                  onChange={(event) =>
                    setBanner((current) => ({ ...current, [field]: event.target.value }))
                  }
                  className="h-11 rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-primary"
                />
              </label>
            ))}
            <p className="text-muted-foreground text-xs">{strings.promote.bannerHrefHint}</p>

            {product.kind === "banner" && (
              <div className="flex flex-col gap-2">
                <span className="font-medium text-sm">{strings.promote.bannerImage}</span>
                <label className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-border border-dashed text-sm">
                  <ImageIcon className="size-4" aria-hidden />
                  {strings.promote.pickImage}
                  <input
                    type="file"
                    accept={IMAGE_TYPES.join(",")}
                    className="sr-only"
                    onChange={(event) => pickImage(event.target.files?.[0])}
                  />
                </label>
                <p className="text-muted-foreground text-xs">{strings.promote.imageHint}</p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="font-medium text-sm">{strings.promote.previewLabel}</span>
              {product.kind === "banner" ? (
                <BannerCard
                  title={banner.title || strings.promote.bannerTitle}
                  subtitle={banner.subtitle || strings.promote.bannerSubtitle}
                  imageUrl={image?.url ?? null}
                  seed={String(product.id)}
                  adLabel={locale === "zh" ? "广告" : "Ad"}
                />
              ) : (
                <p
                  className="rounded-2xl border border-border bg-card px-4 py-3 text-sm"
                  dir="auto"
                >
                  <span className="mr-2 rounded-full bg-primary-soft px-2 py-0.5 font-semibold text-primary-soft-foreground text-xs">
                    {locale === "zh" ? "推广" : "Promoted"}
                  </span>
                  {banner.title || strings.promote.bannerTitle} ·{" "}
                  {banner.subtitle || strings.promote.bannerSubtitle}
                </p>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-error text-sm">{error}</p>}
        <div className="pt-2">
          <PrimaryAction
            text={busy ? strings.promote.creating : strings.promote.create}
            loading={busy}
            onClick={() => void createOrder(product)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <header>
        <h1 className="font-semibold text-lg">{strings.promote.title}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{strings.promote.lead}</p>
      </header>
      {products.length === 0 || methods.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground text-sm">
          {products.length === 0
            ? strings.promote.soldOut
            : strings.promote.errors.no_payment_method}
        </p>
      ) : (
        [
          {
            title: strings.promote.entryFamily,
            hint: strings.promote.entryFamilyHint,
            items: products.filter((product) => isEntryProduct(product.kind)),
          },
          {
            title: strings.promote.adFamily,
            hint: strings.promote.adFamilyHint,
            items: products.filter((product) => !isEntryProduct(product.kind)),
          },
        ]
          .filter((family) => family.items.length > 0)
          .map((family) => (
            <section key={family.title} className="flex flex-col gap-2">
              <div>
                <h2 className="font-semibold text-sm">{family.title}</h2>
                <p className="text-muted-foreground text-xs">{family.hint}</p>
              </div>
              <ul className="flex flex-col gap-2">
                {family.items.map((product) => (
                  <li
                    key={product.id}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-sm">
                        {locale === "zh" ? product.nameZh : product.nameEn}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {strings.promote.effect[product.kind]}
                      </p>
                      <p className="mt-0.5 font-medium text-primary-accent text-xs">
                        {priceLine(product)}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => setStage({ name: "details", product })}>
                      {strings.promote.choose}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))
      )}
      <a
        href={localizePath("/advertise/", locale)}
        target="_blank"
        rel="noopener"
        className="text-center text-primary-accent text-sm underline-offset-4 hover:underline"
      >
        {strings.promote.compare}
      </a>
    </div>
  );
}

function UsdtPayment({
  locale,
  orderId,
  onPaid,
  address,
  amount,
  expiresAt,
}: {
  locale: Locale;
  orderId: number;
  onPaid: () => void;
  address: string;
  amount: string;
  expiresAt: number;
}) {
  const strings = appUi(locale).promote;
  const common = appUi(locale).common;
  const [qr, setQr] = useState<string | null>(null);
  const expired = usePassed(expiresAt);
  const polling = useOrderPolling(orderId, expiresAt, onPaid);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(address, { margin: 1, width: 240, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <h1 className="font-semibold text-lg">{strings.usdtTitle}</h1>

      <div className="rounded-2xl border border-warning bg-warning p-3 text-warning-foreground">
        <p className="flex items-start gap-2 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{strings.usdtExact}</span>
        </p>
      </div>

      <div className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-card p-4">
        <span className="text-muted-foreground text-xs">{strings.usdtAmount}</span>
        <strong className="font-bold text-3xl tabular-nums">{amount}</strong>
        <span className="text-muted-foreground text-xs">USDT · TRC20</span>
      </div>

      <CopyRow
        label={strings.usdtAddress}
        value={address}
        copy={common.copy}
        copied={common.copied}
      />

      {qr && (
        <figure className="flex flex-col items-center gap-2">
          <img src={qr} alt={strings.usdtQr} width="200" height="200" className="rounded-xl" />
          <figcaption className="text-muted-foreground text-xs">{strings.usdtQr}</figcaption>
        </figure>
      )}

      <p
        className={cn("text-center text-xs", expired ? "text-error" : "text-muted-foreground")}
        aria-live="polite"
      >
        {expired
          ? strings.usdtExpired
          : fill(strings.usdtExpires, { time: appDateTime(expiresAt, locale) })}
      </p>
      {polling.stopped ? (
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-muted-foreground text-sm">{strings.usdtStopped}</p>
          <Button
            variant="outline"
            loading={polling.checking}
            onClick={() => void polling.checkNow()}
          >
            {strings.usdtCheck}
          </Button>
        </div>
      ) : (
        <p className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
          <Spinner className="size-4" />
          {strings.usdtWaiting}
        </p>
      )}
    </div>
  );
}
