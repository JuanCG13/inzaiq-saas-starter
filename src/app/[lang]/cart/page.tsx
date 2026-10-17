"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Minus, Plus, ShieldCheck, ShoppingBag, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { RuntimeNotice } from "@/runtime/components";
import type { RuntimeSettings } from "@/runtime/contracts";
import { templateConfig } from "@/template.config";
import { useCart } from "@/components/cart-provider";
import { StoreFooter, StoreHeader } from "@/components/store-header";
import { ProductImage } from "@/components/product-image";
import type { Order, Product } from "@/components/types";
import { CheckoutAttemptError, checkoutErrorKey, checkoutRedirectUrl, checkoutStorageKey, clearAttempt, parseSavedAttempt, persistAttempt, saveableAttempt, type CheckoutPayload, type CheckoutRecovery, type PaymentOption, type SavedCheckoutAttempt } from "@/components/checkout-attempt";
import { LocaleLink } from "@/i18n/link";
import { useErrorMessage, useFormat, useT } from "@/i18n/provider";
import { defaultCurrency } from "@/i18n/runtime";

export default function CartPage() {
  const t = useT("cart");
  const errorMessage = useErrorMessage();
  const { money } = useFormat();
  const { items, count, ready, change, clear, settle, reconcile } = useCart();
  const [submitting, setSubmitting] = useState(false);
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings | null>(null);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Order | null>(null);
  const [customer, setCustomer] = useState({ name: "", email: "", phone: "", address: "" });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const [paymentOption, setPaymentOption] = useState<PaymentOption | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(true);
  // The failure is kept raw and worded at render time, so the effect below never depends on the translator.
  const [paymentFailure, setPaymentFailure] = useState<{ error: unknown } | null>(null);
  const [paymentRetry, setPaymentRetry] = useState(0);
  const [attempt, setAttempt] = useState<SavedCheckoutAttempt | null>(null);
  const [attemptLoaded, setAttemptLoaded] = useState(false);
  const [attemptCorrupt, setAttemptCorrupt] = useState(false);
  const [recoveredState, setRecoveredState] = useState<CheckoutRecovery["state"] | null>(null);
  const submittedPayload = useRef<CheckoutPayload | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const currency = items[0]?.product.currency || defaultCurrency;
  const mixedCurrency = items.some(item => item.product.currency !== currency);
  const total = items.reduce((sum, item) => sum + item.product.priceMinor * item.quantity, 0);
  const locked = submitting || refreshing || !!attempt || attemptCorrupt;

  /** Customer-facing text for a failure: our own coded errors first, then the API error code, then the translated fallback. */
  function describe(failure: unknown, fallback?: string) {
    const key = checkoutErrorKey(failure);
    return key ? t(key) : errorMessage(failure, fallback);
  }

  const paymentError = !paymentFailure ? ""
    : paymentFailure.error instanceof ApiError && paymentFailure.error.status === 404 ? t("failures.storeUpdating")
    : describe(paymentFailure.error, t("failures.paymentOptions"));

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(checkoutStorageKey);
      const saved = parseSavedAttempt(raw);
      if (saved) { setAttempt(saved); idempotencyKey.current = saved.idempotencyKey; }
      else if (raw) setAttemptCorrupt(true);
    } catch { /* Storage is tested again before any order is created. */ }
    setAttemptLoaded(true);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setPaymentLoading(true); setPaymentFailure(null);
    api<PaymentOption>("/api/store/payment-options", { signal: controller.signal }).then(option => {
      if ((option.provider !== "manual" && option.provider !== "stripe") || (option.mode !== "manual" && option.mode !== "redirect")) throw new CheckoutAttemptError("PAYMENT_MODE_UNAVAILABLE");
      setPaymentOption(option);
    }).catch(err => { if (!controller.signal.aborted) setPaymentFailure({ error: err }); })
      .finally(() => { if (!controller.signal.aborted) setPaymentLoading(false); });
    return () => controller.abort();
  }, [paymentRetry]);

  function releaseAttempt() {
    clearAttempt(); setAttempt(null); submittedPayload.current = null;
  }

  async function refreshCart() {
    if (locked) return; setRefreshing(true); setError("");
    try {
      const updates = await Promise.all(items.map(async item => {
        try { const data = await api<{ product: Product }>(`/api/store/products/${encodeURIComponent(item.product.id)}`); return { id: item.product.id, product: data.product }; }
        catch (err) { if (err instanceof ApiError && err.status === 404) return { id: item.product.id, product: null }; throw err; }
      }));
      reconcile(updates); setRefreshed(true);
    } catch (err) { setError(describe(err)); } finally { setRefreshing(false); }
  }

  async function resumeCheckout() {
    if (!attempt || submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true); setError("");
    try {
      const result = await api<CheckoutRecovery>("/api/store/checkout/resume", { method: "POST", body: JSON.stringify({ idempotencyKey: attempt.idempotencyKey }) });
      setRecoveredState(result.state);
      if (result.state === "pending" && result.checkout) {
        const url = checkoutRedirectUrl(result.checkout.url, "stripe");
        const next: SavedCheckoutAttempt = { ...attempt, provider: "stripe", checkoutUrl: url }; persistAttempt(next); setAttempt(next);
        window.location.assign(url);
        return;
      }
      if (result.state === "completed" || result.state === "manual_received") {
        releaseAttempt(); settle(attempt.items); idempotencyKey.current = null;
      } else if (result.state === "cancelled") {
        releaseAttempt(); idempotencyKey.current = null;
      } else if (result.state === "not_found") {
        // Reuse this identity if the original transaction is merely delayed.
        idempotencyKey.current = attempt.idempotencyKey;
        releaseAttempt();
        setError(t("failures.orderNotFound"));
      } else {
        setError(t("failures.stillVerifying"));
      }
    } catch (err) { setError(describe(err, t("failures.resumeFailed"))); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }

  async function checkout() {
    if (submittingRef.current || locked || !items.length || mixedCurrency || !paymentOption || paymentLoading || paymentError || !templateConfig.modules.orders || runtimeSettings?.acceptingOrders === false) return;
    submittingRef.current = true; setSubmitting(true); setError(""); setRecoveredState(null);
    idempotencyKey.current ||= crypto.randomUUID();
    const payload: CheckoutPayload = submittedPayload.current || {
      items: items.map(item => ({ productId: item.product.id, quantity: item.quantity })),
      customer: { ...customer }, expectedTotalMinor: total, expectedCurrency: currency, idempotencyKey: idempotencyKey.current,
    };
    const saved = saveableAttempt(payload, paymentOption.provider);
    try {
      try { persistAttempt(saved); } catch { throw new CheckoutAttemptError("STORAGE_UNAVAILABLE"); }
      submittedPayload.current = payload; setAttempt(saved);
      const data = await api<{ order: Order; checkout?: { kind: "redirect"; url: string } }>("/api/store/orders", { method: "POST", headers: { "x-checkout-protocol": "hosted-v1" }, body: JSON.stringify(payload) });
      if (data.checkout?.kind === "redirect") {
        const url = checkoutRedirectUrl(data.checkout.url, "stripe");
        const next: SavedCheckoutAttempt = { ...saved, provider: "stripe", checkoutUrl: url }; persistAttempt(next); setAttempt(next);
        window.location.assign(url);
        return;
      }
      if (paymentOption.mode === "redirect" || data.order.paymentProvider) throw new CheckoutAttemptError("PAYMENT_URL_MISSING");
      setReceipt(data.order); releaseAttempt(); clear(); idempotencyKey.current = null;
    } catch (err) {
      // An unknown response can follow a committed order. Never create a second identity here.
      setError(describe(err, t("failures.submitFailed")));
    } finally { submittingRef.current = false; setSubmitting(false); }
  }

  const recoveredReceipt = recoveredState === "completed" || recoveredState === "manual_received";
  const paymentLabel = paymentLoading ? t("payment.loading") : paymentOption ? t(paymentOption.provider === "stripe" ? "payment.method.stripe" : "payment.method.manual") : t("payment.unavailable");
  return <>
    <StoreHeader />
    <RuntimeNotice onSettingsChange={setRuntimeSettings} />
    <main id="main-content" className="section-container cart-page">
      <LocaleLink href="/#collection" className="back-link"><ArrowLeft size={15} /> {t("backLink")}</LocaleLink>
      {receipt ? <section className="receipt">
        <span className="receipt-check"><Check size={30} /></span><div className="eyebrow">{t("receipt.eyebrow")}</div><h1>{t("receipt.title")}</h1>
        <p>{t("receipt.body")}</p>
        <div className="receipt-details"><span>{t("receipt.reference")}<strong>{receipt.id}</strong></span><span>{t("receipt.status")}<strong>{t("receipt.statusPending")}</strong></span><span>{t("receipt.total")}<strong>{money(receipt.totalMinor, receipt.currency)}</strong></span></div>
        <p className="muted-text">{t("receipt.note")}</p>
        <LocaleLink href="/#collection" className="button primary">{t("actions.backToCollection")} <ArrowRight size={16} /></LocaleLink>
      </section> : recoveredReceipt ? <section className="receipt">
        <span className="receipt-check"><Check size={30} /></span><div className="eyebrow">{t("recovered.eyebrow")}</div><h1>{recoveredState === "completed" ? t("recovered.confirmedTitle") : t("recovered.receivedTitle")}</h1>
        <p>{recoveredState === "completed" ? t("recovered.confirmedBody") : t("recovered.receivedBody")}</p>
        <p className="muted-text">{t("recovered.note")}</p><LocaleLink href="/#collection" className="button primary">{t("actions.backToCollection")} <ArrowRight size={16} /></LocaleLink>
      </section> : <>
        <div className="section-heading"><div><div className="eyebrow">{t("heading.eyebrow")}</div><h1>{t("heading.title")}<span>.</span></h1></div><span className="muted-text">{t("heading.itemCount", { count })}</span></div>
        {recoveredState === "cancelled" ? <p className="cart-refreshed" role="status">{t("recovery.cancelledNotice")}</p> : null}
        {attemptCorrupt ? <p className="form-error" role="alert">{t("recovery.corruptNotice")}</p> : null}
        {!ready || !attemptLoaded ? <div className="empty-state" role="status">{t("loading")}</div> : !items.length && !attempt ? <div className="empty-state cart-empty"><ShoppingBag size={40} strokeWidth={1.3} /><h2>{t("empty.title")}</h2><p>{t("empty.body")}</p><LocaleLink className="button primary" href="/#collection">{t("empty.action")} <ArrowRight size={16} /></LocaleLink></div> : <div className="cart-layout">
          <div className="cart-items">{items.map(({ product, quantity }) => <article className="cart-item" key={product.id}>
            <ProductImage src={product.imageUrl} alt={product.name} className="cart-item-image" /><div className="cart-item-info"><span className="product-category">{product.category}</span><h2>{product.name}</h2><span>{money(product.priceMinor, product.currency)}</span><div className="quantity-stepper"><button aria-label={t("item.decrease", { name: product.name })} disabled={locked} onClick={() => change(product.id, quantity - 1)}><Minus size={13} /></button><span aria-label={t("item.quantity")}>{quantity}</span><button aria-label={t("item.increase", { name: product.name })} disabled={locked || quantity >= product.stock || quantity >= 99} onClick={() => change(product.id, quantity + 1)}><Plus size={13} /></button></div></div><div className="cart-item-end"><strong>{money(product.priceMinor * quantity, product.currency)}</strong><button className="icon-button" aria-label={t("item.remove", { name: product.name })} disabled={locked} onClick={() => change(product.id, 0)}><Trash2 size={16} /></button></div>
          </article>)}</div>
          <aside className="cart-summary">
            {attempt ? <div className="checkout-recovery" aria-live="polite"><ShieldCheck size={26} /><h2>{t("recovery.title")}</h2><p>{t("recovery.body")}</p><div className="summary-total"><span>{t("recovery.totalSent")}</span><strong>{money(attempt.expectedTotalMinor, attempt.expectedCurrency)}</strong></div>{error ? <p className="form-error" role="alert">{error}</p> : null}<button type="button" className="button primary full-width" disabled={submitting} onClick={resumeCheckout}>{submitting ? t("recovery.verifying") : attempt.provider === "stripe" ? t("recovery.resumePayment") : t("recovery.verifyOrder")}<ArrowRight size={16} /></button><p className="summary-footnote">{t("recovery.footnote")}</p></div> : <form onSubmit={event => { event.preventDefault(); void checkout(); }}>
              <h2>{t("summary.title")}</h2><div className="summary-row"><span>{t("summary.products")}</span><strong>{mixedCurrency ? t("summary.multipleCurrencies") : money(total, currency)}</strong></div><div className="summary-row"><span>{t("summary.delivery")}</span><span>{t("summary.deliveryValue")}</span></div><div className="summary-total"><span>{t("summary.productsTotal")}</span><strong>{mixedCurrency ? "—" : money(total, currency)}</strong></div>
              <div className="checkout-fields"><h3>{t("customer.heading")}</h3><label className="field">{t("customer.name")}<input required minLength={2} autoComplete="name" maxLength={120} value={customer.name} onChange={event => setCustomer({ ...customer, name: event.target.value })} /></label><label className="field">{t("customer.email")}<input required type="email" autoComplete="email" maxLength={200} value={customer.email} onChange={event => setCustomer({ ...customer, email: event.target.value })} /></label><label className="field">{t("customer.phone")} <span>{t("customer.optional")}</span><input type="tel" autoComplete="tel" maxLength={40} value={customer.phone} onChange={event => setCustomer({ ...customer, phone: event.target.value })} /></label><label className="field">{t("customer.address")} <span>{t("customer.optional")}</span><input autoComplete="street-address" maxLength={300} value={customer.address} onChange={event => setCustomer({ ...customer, address: event.target.value })} /></label></div>
              <div className="payment-note"><ShieldCheck size={20} /><p><strong>{paymentLabel}</strong>{paymentOption?.mode === "redirect" ? t("payment.noteRedirect") : t("payment.noteManual")}</p></div>
              {paymentError ? <div className="form-error" role="alert">{paymentError}<button type="button" className="text-link" onClick={() => setPaymentRetry(value => value + 1)}>{t("payment.retry")}</button></div> : null}
              {mixedCurrency ? <p className="form-error" role="alert">{t("checkout.mixedCurrencies")}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}{refreshed ? <p className="cart-refreshed" role="status">{t("checkout.refreshed")}</p> : null}
              <button type="button" className="refresh-cart-link" disabled={locked} onClick={refreshCart}>{refreshing ? t("checkout.refreshing") : t("checkout.refresh")}</button>{!templateConfig.modules.orders ? <p className="form-error">{t("checkout.ordersDisabled")}</p> : null}
              <button className="button primary full-width" type="submit" disabled={locked || mixedCurrency || !paymentOption || paymentLoading || !!paymentError || !templateConfig.modules.orders || runtimeSettings?.acceptingOrders === false}>{submitting ? t("checkout.preparing") : paymentOption?.mode === "redirect" ? t("checkout.continueToPayment") : t("checkout.placeOrder")}<ArrowRight size={16} /></button><p className="summary-footnote">{paymentOption?.mode === "redirect" ? t("checkout.footnoteRedirect") : t("checkout.footnoteManual")}</p>
            </form>}
          </aside>
        </div>}
      </>}
    </main>
    <StoreFooter />
  </>;
}
