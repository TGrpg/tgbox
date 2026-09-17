import { z } from "zod";
import { EntryKind, locales, SubmissionStatus } from "./domain.ts";
import { BannerContent, OrderStatus, PaymentCurrency, ProductKind } from "./settings.ts";

/**
 * Mini App API contract (`/api/app/*`, see `.scratch/miniapp-contract.md`). The Worker routes and
 * the UI both import these schemas so neither side redeclares the shapes.
 *
 * Every timestamp is epoch milliseconds, matching how the database stores them.
 */

export const AppLocale = z.enum(locales);
export type AppLocale = z.infer<typeof AppLocale>;

export const AppUser = z.object({
  id: z.number().int(),
  locale: AppLocale,
});
export type AppUser = z.infer<typeof AppUser>;

export const AppSubmission = z.object({
  id: z.number().int(),
  username: z.string(),
  kind: EntryKind,
  status: SubmissionStatus,
  /** Why a moderator rejected it — the one thing users cannot see anywhere else. */
  rejectReason: z.string().nullable(),
  createdAt: z.number().int(),
  reviewedAt: z.number().int().nullable(),
});
export type AppSubmission = z.infer<typeof AppSubmission>;

export const AppOrder = z.object({
  id: z.number().int(),
  kind: ProductKind,
  productName: z.string(),
  status: OrderStatus,
  /** Decimal string for USDT, whole Stars as a string; null before a payment method was chosen. */
  amount: z.string().nullable(),
  currency: PaymentCurrency.nullable(),
  createdAt: z.number().int(),
  startsAt: z.number().int().nullable(),
  endsAt: z.number().int().nullable(),
  targetUsername: z.string().nullable(),
  /** Total clicks on the promotion this order bought; 0 when it has none. */
  clicks: z.number().int(),
});
export type AppOrder = z.infer<typeof AppOrder>;

export const AppLimits = z.object({
  submitDailyLimit: z.number().int(),
  submittedToday: z.number().int(),
  submissionsOpen: z.boolean(),
});
export type AppLimits = z.infer<typeof AppLimits>;

export const AppMe = z.object({
  user: AppUser,
  submissions: z.array(AppSubmission),
  orders: z.array(AppOrder),
  limits: AppLimits,
});
export type AppMe = z.infer<typeof AppMe>;

export const SubmitError = z.enum([
  "closed",
  "invalid",
  "already_listed",
  "already_pending",
  "daily_limit",
  "banned",
]);
export type SubmitError = z.infer<typeof SubmitError>;

export const SubmitRequest = z.object({
  username: z.string(),
  categoryId: z.number().int(),
  tagIds: z.array(z.number().int()),
});
export type SubmitRequest = z.infer<typeof SubmitRequest>;

export const SubmitResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), submissionId: z.number().int() }),
  z.object({ ok: z.literal(false), error: SubmitError }),
]);
export type SubmitResult = z.infer<typeof SubmitResult>;

/** What `t.me` says about an entry, so the form can confirm it before submitting. */
export const AppPreview = z.object({
  username: z.string(),
  kind: EntryKind,
  title: z.string(),
  description: z.string(),
  members: z.number().int().nullable(),
  avatarUrl: z.string().nullable(),
});
export type AppPreview = z.infer<typeof AppPreview>;

export const PreviewResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), preview: AppPreview }),
  z.object({ ok: z.literal(false), error: z.enum(["invalid", "not_found"]) }),
]);
export type PreviewResult = z.infer<typeof PreviewResult>;

export const CreateOrderRequest = z.object({
  productId: z.number().int(),
  targetUsername: z.string().optional(),
  banner: BannerContent.optional(),
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequest>;

export const CreateOrderResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), orderId: z.number().int() }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    /** When every slot is taken: the moment the first one frees up. */
    nextFreeAt: z.number().int().optional(),
  }),
]);
export type CreateOrderResult = z.infer<typeof CreateOrderResult>;

export const PayMethod = z.enum(["stars", "usdt"]);
export type PayMethod = z.infer<typeof PayMethod>;

export const PayRequest = z.object({ method: PayMethod });
export type PayRequest = z.infer<typeof PayRequest>;

// Not a discriminated union: both successful branches share `ok: true`.
export const PayResult = z.union([
  z.object({ ok: z.literal(true), method: z.literal("stars"), invoiceLink: z.string() }),
  z.object({
    ok: z.literal(true),
    method: z.literal("usdt"),
    address: z.string(),
    /** Decimal string the payer must send **exactly**; it is how the transfer is matched. */
    amount: z.string(),
    expiresAt: z.number().int(),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type PayResult = z.infer<typeof PayResult>;

export const OrderStatusResult = z.object({
  status: OrderStatus,
  paidAt: z.number().int().nullable(),
});
export type OrderStatusResult = z.infer<typeof OrderStatusResult>;

export const PrefsRequest = z.object({ locale: AppLocale });
export type PrefsRequest = z.infer<typeof PrefsRequest>;

export const PrefsResult = z.object({ ok: z.literal(true) });
export type PrefsResult = z.infer<typeof PrefsResult>;

export const UploadResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), imageUrl: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type UploadResult = z.infer<typeof UploadResult>;
