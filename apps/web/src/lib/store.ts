import { writable } from "svelte/store";
import type { Lang } from "./i18n";

const storedLang =
  (typeof localStorage !== "undefined" && (localStorage.getItem("ua-lang") as Lang)) ||
  "th";

export const lang = writable<Lang>(storedLang);

lang.subscribe((value) => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("ua-lang", value);
  }
});
