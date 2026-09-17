import type { CategoryClassifier, ClassifyRequest } from "@tgbox/shared";

/**
 * The Workers AI half of `suggestTaxonomy` (@tgbox/shared), used by the bot's `/submit` flow and
 * the Mini App's preview endpoint so both propose the same category.
 *
 * It only runs when the keyword pass is unsure, which is a minority of submissions, and a
 * submission is a deliberate human act a few times a day — so one call per unsure submission is
 * well inside the free 10,000 Neurons/day (see `.agents/cloudflare.md`).
 *
 * Model: `@cf/google/gemma-4-26b-a4b-it` — multilingual (the directory is Chinese-first), no
 * reasoning tokens to pay for, and live in the catalog. JSON mode is not used: Cloudflare only
 * supports it on a couple of large models, and one slug is easier to validate than JSON anyway.
 */
const MODEL = "@cf/google/gemma-4-26b-a4b-it";
/** A slug and nothing else; anything longer is the model ignoring the prompt. */
const MAX_TOKENS = 24;
/** Enough of a description to classify by; the rest is repetition and link spam. */
const MAX_DESCRIPTION = 500;

const SYSTEM = [
  "You classify Telegram channels, groups and bots for a directory.",
  "Answer with exactly one category slug from the list, lowercase, nothing else.",
  'If none of them fits, answer "none".',
].join(" ");

function prompt(request: ClassifyRequest) {
  const list = request.candidates
    .map((candidate) => `- ${candidate.slug}: ${candidate.nameZh}`)
    .join("\n");
  return [
    `Categories for a Telegram ${request.kind}:`,
    list,
    "",
    `Title: ${request.title}`,
    `Description: ${request.description.slice(0, MAX_DESCRIPTION)}`,
    "",
    "Slug:",
  ].join("\n");
}

/** The model's answer, stripped to a bare slug; anything else becomes null at the call site. */
function readAnswer(result: unknown): string | null {
  const text = textOf(result);
  if (text === null) return null;
  const match = /[a-z0-9]+(?:-[a-z0-9]+)*/.exec(text.trim().toLowerCase());
  return match?.[0] ?? null;
}

/** Chat-completion models answer in `choices`, older text-generation ones in `response`. */
function textOf(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  if ("response" in result && typeof result.response === "string") return result.response;
  if ("choices" in result && Array.isArray(result.choices)) {
    const [choice] = result.choices;
    if (typeof choice === "object" && choice !== null && "message" in choice) {
      const { message } = choice;
      if (typeof message === "object" && message !== null && "content" in message) {
        if (typeof message.content === "string") return message.content;
      }
    }
  }
  return null;
}

/**
 * Calls per UTC day, per isolate. The Mini App's preview endpoint is reachable by any Telegram
 * user, so without a ceiling one persistent caller could spend the account's whole daily Neuron
 * allowance — and the hourly description translations would start failing with it. Deliberately
 * approximate (isolates are per colo, like the preview rate limit): this is a cap, not accounting.
 * 200 calls is ~800 Neurons, well inside what the translations leave over.
 */
const MAX_CALLS_PER_DAY = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
let day = 0;
let calls = 0;

function withinBudget(now: number) {
  const today = Math.floor(now / DAY_MS);
  if (today !== day) {
    day = today;
    calls = 0;
  }
  if (calls >= MAX_CALLS_PER_DAY) return false;
  calls++;
  return true;
}

/**
 * Builds the classifier hook for `suggestTaxonomy`. Every failure — a refused call, a spent budget,
 * an exhausted neuron allowance, a model that answers prose — returns null, which
 * `suggestTaxonomy` turns into "no suggestion" rather than a wrong one.
 */
export function aiCategoryClassifier(ai: Ai): CategoryClassifier {
  return async (request) => {
    if (!withinBudget(Date.now())) return null;
    try {
      const result = await ai.run(MODEL, {
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt(request) },
        ],
        max_tokens: MAX_TOKENS,
        temperature: 0,
      });
      return readAnswer(result);
    } catch (error) {
      console.error("category classification failed", error);
      return null;
    }
  };
}
