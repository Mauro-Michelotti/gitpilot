// UI language: typed it/en dictionaries (src/locales/*), `t()` for code outside React,
// `useT()` for components (re-renders them when the language changes).
import { useStore } from "./store";
import common from "./locales/common";
import actions from "./locales/actions";
import dialogs from "./locales/dialogs";
import repo from "./locales/repo";
import type { Msg } from "./locales/define";

export { messages, type Msg } from "./locales/define";

export type Lang = "it" | "en";
export type LangSetting = "system" | Lang;

const IT = { ...common.it, ...actions.it, ...dialogs.it, ...repo.it };
const EN: Record<keyof typeof IT, Msg> = { ...common.en, ...actions.en, ...dialogs.en, ...repo.en };
export type MsgKey = keyof typeof IT;
const DICTS: Record<Lang, Record<MsgKey, Msg>> = { it: IT, en: EN };

let current: Lang = "it";

/** "system" follows the OS language: Italian if it is Italian, English otherwise. */
export function resolveLang(setting: LangSetting | undefined): Lang {
  if (setting === "it" || setting === "en") return setting;
  return (navigator.language || "").toLowerCase().startsWith("it") ? "it" : "en";
}

export function setLang(lang: Lang) {
  current = lang;
  document.documentElement.lang = lang;
}

export const lang = () => current;

export type Params = Record<string, string | number>;

/** Translate `key`, replacing `{name}` placeholders with `params`; plural texts use `params.count`. */
export function t(key: MsgKey, params?: Params): string {
  const msg = DICTS[current][key] ?? IT[key] ?? key;
  const text = typeof msg === "string" ? msg : msg[new Intl.PluralRules(current).select(Number(params?.count ?? 0)) === "one" ? "one" : "other"];
  return params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text;
}

/** `t` for components: subscribing to the language makes them re-render when it changes. */
export function useT() {
  useStore((s) => s.settings?.language);
  return t;
}
