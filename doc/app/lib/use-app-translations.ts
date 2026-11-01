import { useTranslations } from "@fuma-translate/react";
import type { Translator } from "./translations";

export function useAppTranslations(): Translator {
  return useTranslations();
}
