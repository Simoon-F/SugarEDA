import { useMemo, useState } from "react";
import { I18nContext, resolveLanguage, translate, type Language } from "./i18n";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() =>
    resolveLanguage(localStorage.getItem("sugareda-language")),
  );
  const value = useMemo(
    () => ({
      language,
      setLanguage: (next: Language) => {
        localStorage.setItem("sugareda-language", next);
        setLanguageState(next);
      },
      t: (key: string) => translate(language, key),
    }),
    [language],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
