"use client";

import { useT } from "@/i18n/provider";

export default function LoadingPage() {
  const t = useT("common");
  return <main id="main-content" className="boundary-page" role="status"><span className="loading-ring" /><p>{t("boundaries.loading")}</p></main>;
}
