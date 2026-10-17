"use client";

import { ArrowRight } from "lucide-react";
import { LocaleLink } from "@/i18n/link";
import { useT } from "@/i18n/provider";

export default function NotFoundPage() {
  const t = useT("common");
  return <main id="main-content" className="boundary-page"><span className="eyebrow">{t("boundaries.notFound.eyebrow")}</span><h1>{t("boundaries.notFound.title")}</h1><p>{t("boundaries.notFound.body")}</p><LocaleLink className="button primary" href="/">{t("boundaries.notFound.action")} <ArrowRight size={16} /></LocaleLink></main>;
}
