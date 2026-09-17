import { EntryKind, EntryStatus, entrySorts, Liveness } from "@tgbox/shared";
import { z } from "zod";

export const ENTRIES_PAGE_SIZE = 50;

/** `/entries` URL search params: every filter lives in the URL so views are shareable. */
export const entriesSearchSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).optional(),
  kind: EntryKind.optional().catch(undefined),
  category: z.coerce.number().int().positive().optional().catch(undefined),
  status: EntryStatus.optional().catch(undefined),
  liveness: Liveness.optional().catch(undefined),
  lang: z
    .string()
    .regex(/^[a-z]{2,3}$/)
    .optional()
    .catch(undefined),
  promoted: z.boolean().optional().catch(undefined),
  q: z.string().trim().max(64).optional().catch(undefined),
  sort: z.enum(entrySorts).optional().catch(undefined),
});
export type EntriesSearch = z.infer<typeof entriesSearchSchema>;
