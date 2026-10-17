"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api-client";
import { useCart } from "@/components/cart-provider";
import { StoreFooter, StoreHeader } from "@/components/store-header";
import { checkoutErrorKey, checkoutRedirectUrl, checkoutStorageKey, clearAttempt, parseSavedAttempt, persistAttempt, type CheckoutRecovery, type SavedCheckoutAttempt } from "@/components/checkout-attempt";
import { LocaleLink } from "@/i18n/link";
import { useErrorMessage, useT } from "@/i18n/provider";

export default function CheckoutReturnPage() {
  const t = useT("cart");
  const errorMessage = useErrorMessage();
  const { ready, settle } = useCart();
  const [checking, setChecking] = useState(true);
  const [state, setState] = useState<CheckoutRecovery["state"] | null>(null);
  const [attempt, setAttempt] = useState<SavedCheckoutAttempt | null>(null);
  // Kept raw and worded at render time, so the verification effect never depends on the translator.
  const [failure, setFailure] = useState<{ error: unknown; fallback: "verify" | "none" } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const controller = new AbortController();
    async function verify() {
      setChecking(true); setFailure(null);
      try {
        const saved = parseSavedAttempt(sessionStorage.getItem(checkoutStorageKey));
        if (!saved) { setAttempt(null); return; }
        setAttempt(saved);
        const result = await api<CheckoutRecovery>("/api/store/checkout/resume", { method: "POST", body: JSON.stringify({ idempotencyKey: saved.idempotencyKey }), signal: controller.signal });
        if (!active) return;
        setState(result.state);
        if (result.state === "completed" || result.state === "manual_received") {
          clearAttempt(); settle(saved.items);
        } else if (result.state === "cancelled") {
          clearAttempt();
        } else if (result.state === "pending" && result.checkout) {
          const next: SavedCheckoutAttempt = { ...saved, provider: "stripe", checkoutUrl: checkoutRedirectUrl(result.checkout.url, "stripe") };
          persistAttempt(next); setAttempt(next);
        }
      } catch (err) {
        if (active) setFailure({ error: err, fallback: "verify" });
      } finally { if (active) setChecking(false); }
    }
    void verify();
    return () => { active = false; controller.abort(); };
  }, [ready, retry, settle]);

  function resume() {
    if (!attempt?.checkoutUrl || checking) return;
    try { window.location.assign(checkoutRedirectUrl(attempt.checkoutUrl, attempt.provider)); }
    catch (err) { setFailure({ error: err, fallback: "none" }); }
  }

  const confirmed = state === "completed";
  const manualReceived = state === "manual_received";
  const cancelled = state === "cancelled";
  const title = checking ? t("paymentReturn.title.checking") : confirmed ? t("paymentReturn.title.confirmed") : manualReceived ? t("paymentReturn.title.manualReceived") : cancelled ? t("paymentReturn.title.cancelled") : t("paymentReturn.title.pending");
  const errorKey = checkoutErrorKey(failure?.error);
  const error = !failure ? "" : errorKey ? t(errorKey) : errorMessage(failure.error, failure.fallback === "verify" ? t("failures.returnVerifyFailed") : undefined);
  return <><StoreHeader /><main id="main-content" className="section-container cart-page"><section className="receipt payment-return">
    <span className="receipt-check">{confirmed || manualReceived ? <Check size={30} /> : <ShieldCheck size={30} />}</span>
    <div className="eyebrow">{confirmed || manualReceived ? t("paymentReturn.eyebrowVerified") : t("paymentReturn.eyebrowReturn")}</div>
    <h1>{title}</h1>
    <p>{confirmed ? t("paymentReturn.body.confirmed") : manualReceived ? t("paymentReturn.body.manualReceived") : cancelled ? t("paymentReturn.body.cancelled") : t("paymentReturn.body.pending")}</p>
    {!attempt && !checking ? <p className="muted-text">{t("paymentReturn.noReference")}</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="payment-return-actions">
      {state === "pending" && attempt?.checkoutUrl ? <button className="button primary" type="button" onClick={resume}>{t("paymentReturn.resumeSamePayment")} <ArrowRight size={16} /></button> : null}
      {attempt && !confirmed && !manualReceived && !cancelled ? <button className="button secondary" type="button" disabled={checking} onClick={() => setRetry(value => value + 1)}>{checking ? t("paymentReturn.verifying") : t("paymentReturn.recheck")}<RefreshCw size={15} className={checking ? "spin" : ""} /></button> : null}
      <LocaleLink href={confirmed || manualReceived ? "/#collection" : "/cart"} className="text-link"><ArrowLeft size={15} />{confirmed || manualReceived ? t("actions.backToCollection") : t("actions.backToBag")}</LocaleLink>
    </div>
    <p className="muted-text">{t("paymentReturn.footnote")}</p>
  </section></main><StoreFooter /></>;
}
