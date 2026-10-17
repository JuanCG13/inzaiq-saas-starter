"use client";

import { RefreshCw } from "lucide-react";
import { LocaleLink } from "@/i18n/link";
import { useT } from "@/i18n/provider";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("common");
  return <main id="main-content" className="boundary-page"><span className="eyebrow">{t("boundaries.error.eyebrow")}</span><h1>{t("boundaries.error.title")}</h1><p>{t("boundaries.error.body")}</p><button className="button primary" onClick={reset}>{t("boundaries.error.retry")} <RefreshCw size={16} /></button><LocaleLink className="text-link" href="/">{t("boundaries.error.home")}</LocaleLink></main>;
}
