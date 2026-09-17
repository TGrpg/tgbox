import { francAll } from "franc-min";

/** franc ISO 639-3 → ISO 639-1 for the Latin-script languages we care about. */
const LATIN_LANGS: Record<string, string> = {
  eng: "en",
  spa: "es",
  por: "pt",
  fra: "fr",
  deu: "de",
  ita: "it",
  nld: "nl",
  tur: "tr",
  ind: "id",
  vie: "vi",
  pol: "pl",
  ron: "ro",
  ces: "cs",
  hun: "hu",
  swe: "sv",
  uzn: "uz",
  azj: "az",
  hau: "ha",
  tgl: "tl",
  swh: "sw",
};

/**
 * Evidence that short Latin text really is a given language: characteristic letters, and common
 * words that aren't also English words. Languages without an entry fall back to English when
 * the text is short.
 */
const MARKERS: Record<string, { letters: RegExp; words: Set<string> }> = {
  fr: marker(
    /[àâçéèêëîïôùûüœ]/gu,
    "le la les des du et est une pour avec dans sur pas qui que nous vous ce cette au aux",
  ),
  es: marker(/[áéíóúñ¿¡]/gu, "de el la los las del y es una por para con en que se al lo su"),
  pt: marker(/[ãõçáéíóúâêô]/gu, "de os as da dos das um uma para com em não que na é"),
  de: marker(/[äöüß]/gu, "der die das und ist nicht mit ein eine für auf dem zu von sie ich"),
  it: marker(/[àèéìòù]/gu, "il lo gli della di che è per con un una non sono del"),
  nl: marker(/[ëï]/gu, "de het een en niet voor op zijn dat"),
  tr: marker(/[çğıöşüİ]/gu, "ve bir bu için ile da de"),
  id: marker(/(?!)/gu, "dan yang di untuk dengan ini itu dari ke tidak"),
  vi: marker(/[ăâđêôơưạ-ỹ]/gu, "và của là có không cho được"),
  pl: marker(/[ąćęłńóśźż]/gu, "nie się na do że jest"),
  ro: marker(/[ăâîșşțţ]/gu, "și în cu pentru este nu"),
  cs: marker(/[áčďéěíňóřšťúůýž]/gu, "je se na ve pro"),
  hu: marker(/[áéíóöőúüű]/gu, "és az hogy nem egy"),
  sv: marker(/[åäö]/gu, "och är att det som för med på en"),
};

function marker(letters: RegExp, words: string) {
  return { letters, words: new Set(words.split(" ")) };
}

function markerCount(lang: string, text: string) {
  const markers = MARKERS[lang];
  if (!markers) return 0;
  const lower = text.toLowerCase();
  const letters = lower.match(markers.letters)?.length ?? 0;
  const words = (lower.match(/\p{L}+/gu) ?? []).filter((word) => markers.words.has(word)).length;
  return letters + words;
}

// Below this length (or when English is a near-tie) franc's pick needs marker evidence.
const SHORT_TEXT = 60;
const ENGLISH_NEAR_TIE = 0.95;
const MIN_MARKERS = 3;

/** Scripts that identify a language on their own (checked in this order after counting). */
const SCRIPTS: [lang: string, pattern: RegExp][] = [
  ["ja", /[\p{Script=Hiragana}\p{Script=Katakana}]/gu],
  ["ko", /\p{Script=Hangul}/gu],
  ["zh", /\p{Script=Han}/gu],
  ["ru", /\p{Script=Cyrillic}/gu],
  ["ar", /\p{Script=Arabic}/gu],
  ["he", /\p{Script=Hebrew}/gu],
  ["el", /\p{Script=Greek}/gu],
  ["th", /\p{Script=Thai}/gu],
  ["hi", /\p{Script=Devanagari}/gu],
  ["ka", /\p{Script=Georgian}/gu],
  ["hy", /\p{Script=Armenian}/gu],
  ["latin", /\p{Script=Latin}/gu],
];

/** Letters only used in Persian, not Arabic. */
const PERSIAN = /[پچژگکی]/u;

/**
 * Returns an ISO 639-1-ish code or "und". Script counting first (CJK characters weigh double
 * because each carries a word's worth of text); Latin text goes through franc-min.
 */
export function detectLanguage(input: string): string {
  // Links, @mentions and hashtags are Latin regardless of the language people write in.
  const text = input.replace(/https?:\/\/\S+|t\.me\/\S+|[@#][\p{L}\p{N}_]+/gu, " ");
  const counts = new Map<string, number>();
  let best = { lang: "und", score: 0 };
  for (const [lang, pattern] of SCRIPTS) {
    const count = text.match(pattern)?.length ?? 0;
    counts.set(lang, count);
    const score = lang === "zh" || lang === "ja" || lang === "ko" ? count * 2 : count;
    if (score > best.score) best = { lang, score };
  }
  // Japanese mixes kana into kanji text; a stray "の" in a Chinese title doesn't make it Japanese.
  const kana = counts.get("ja") ?? 0;
  if (best.lang === "zh" && kana > 0 && kana * 5 >= (counts.get("zh") ?? 0)) return "ja";
  if (best.lang === "ar" && PERSIAN.test(text)) return "fa";
  if (best.lang !== "latin") return best.score >= 2 ? best.lang : "und";

  const ranked = francAll(text, { only: Object.keys(LATIN_LANGS), minLength: 10 });
  const lang = LATIN_LANGS[ranked[0]?.[0] ?? ""] ?? "und";
  if (lang === "und" || lang === "en") return lang;
  // Short bios like "Powerful telegram bot to help you manage your groups." come out as fr/pt.
  const englishScore = ranked.find(([code]) => code === "eng")?.[1] ?? 0;
  const ambiguous = text.trim().length < SHORT_TEXT || englishScore >= ENGLISH_NEAR_TIE;
  if (ambiguous && markerCount(lang, text) < MIN_MARKERS) return "en";
  return lang;
}
