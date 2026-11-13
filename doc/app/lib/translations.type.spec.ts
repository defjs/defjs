import type { Translator } from "./translations";

export function messageKeysAreTyped(t: Translator) {
  t("nav.guide.ai");
  t("Copy Text(code block)(aria-label)");
  // @ts-expect-error Message keys must exist in the shared English resource.
  t("nav.guide.missing");
}
