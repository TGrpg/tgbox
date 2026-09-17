import type { Locale } from "../domain.ts";
import { en } from "./en.ts";
import { zh } from "./zh.ts";

/** zh is the reference dictionary; en must have the same shape. */
export type Dictionary = typeof zh;

type Namespace = keyof Dictionary;
export type MessageKey = {
  [TNamespace in Namespace]: `${TNamespace}.${Extract<keyof Dictionary[TNamespace], string>}`;
}[Namespace];

function flatten(dictionary: Dictionary): Map<string, string> {
  const messages = new Map<string, string>();
  for (const [namespace, entries] of Object.entries(dictionary)) {
    for (const [name, text] of Object.entries(entries)) messages.set(`${namespace}.${name}`, text);
  }
  return messages;
}

const messages: Record<Locale, Map<string, string>> = { zh: flatten(zh), en: flatten(en) };

export function t(locale: Locale, key: MessageKey): string {
  return messages[locale].get(key) ?? key;
}
