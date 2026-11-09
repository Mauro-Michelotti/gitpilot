// Kept free of imports: the locale files use it while i18n.ts imports them.

/** A text, or its plural forms chosen by the `count` parameter. */
export type Msg = string | { one: string; other: string };

/**
 * Pair of dictionaries for one area of the UI: the Italian keys define the type,
 * so a key missing in (or unknown to) the English dictionary is a compile error.
 */
export function messages<T extends Record<string, Msg>>(it: T, en: { [K in keyof T]: Msg }) {
  return { it, en };
}
