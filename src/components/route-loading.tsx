"use client";

import { useT } from "@/i18n/provider";

/**
 * Shared fallback for the page routes' `loading.tsx` files. It is deliberately not a `loading.tsx` at
 * `src/app/[lang]/`: that boundary would wrap the catch-all route too, the response would start
 * streaming (HTTP 200) before `notFound()` runs and every unknown URL would be a soft 404.
 */
export default function RouteLoading() {
  const t = useT("common");
  return <main id="main-content" className="boundary-page" role="status"><span className="loading-ring" /><p>{t("boundaries.loading")}</p></main>;
}
