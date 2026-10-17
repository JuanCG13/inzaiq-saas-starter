"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Minus, Plus, ShieldCheck, ShoppingBag, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { RuntimeNotice } from "@/runtime/components";
import type { RuntimeSettings } from "@/runtime/contracts";
import { templateConfig } from "@/template.config";
import { useCart } from "@/components/cart-provider";
import { StoreFooter, StoreHeader } from "@/components/store-header";
import { ProductImage } from "@/components/product-image";
import { money, errorMessage, type Order, type Product } from "@/components/types";
import { checkoutRedirectUrl, checkoutStorageKey, clearAttempt, parseSavedAttempt, persistAttempt, saveableAttempt, type CheckoutPayload, type CheckoutRecovery, type PaymentOption, type SavedCheckoutAttempt } from "@/components/checkout-attempt";

export default function CartPage() {
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
  const [paymentError, setPaymentError] = useState("");
  const [paymentRetry, setPaymentRetry] = useState(0);
  const [attempt, setAttempt] = useState<SavedCheckoutAttempt | null>(null);
  const [attemptLoaded, setAttemptLoaded] = useState(false);
  const [attemptCorrupt, setAttemptCorrupt] = useState(false);
  const [recoveredState, setRecoveredState] = useState<CheckoutRecovery["state"] | null>(null);
  const submittedPayload = useRef<CheckoutPayload | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const currency = items[0]?.product.currency || "USD";
  const mixedCurrency = items.some(item => item.product.currency !== currency);
  const total = items.reduce((sum, item) => sum + item.product.priceMinor * item.quantity, 0);
  const locked = submitting || refreshing || !!attempt || attemptCorrupt;

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
    setPaymentLoading(true); setPaymentError("");
    api<PaymentOption>("/api/store/payment-options", { signal: controller.signal }).then(option => {
      if ((option.provider !== "manual" && option.provider !== "stripe") || (option.mode !== "manual" && option.mode !== "redirect")) throw new Error("La modalidad de pago no está disponible.");
      setPaymentOption(option);
    }).catch(err => { if (!controller.signal.aborted) setPaymentError(err instanceof ApiError && err.status === 404 ? "La tienda se está actualizando. Recargá esta página antes de confirmar un pedido." : errorMessage(err, "No pudimos consultar los medios de pago.")); })
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
    } catch (err) { setError(errorMessage(err)); } finally { setRefreshing(false); }
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
        setError("No encontramos un pedido confirmado. Revisá tus datos y volvé a enviar; conservamos la misma referencia para evitar duplicados.");
      } else {
        setError("Tu pedido sigue en verificación. Esperá un momento y volvé a consultar antes de crear otro.");
      }
    } catch (err) { setError(errorMessage(err, "No pudimos verificar el intento. Conservamos tu bolsa y la misma referencia.")); }
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
      try { persistAttempt(saved); } catch { throw new Error("Necesitamos el almacenamiento de esta pestaña para recuperar tu pedido de forma segura. Habilitalo y volvé a intentar."); }
      submittedPayload.current = payload; setAttempt(saved);
      const data = await api<{ order: Order; checkout?: { kind: "redirect"; url: string } }>("/api/store/orders", { method: "POST", headers: { "x-checkout-protocol": "hosted-v1" }, body: JSON.stringify(payload) });
      if (data.checkout?.kind === "redirect") {
        const url = checkoutRedirectUrl(data.checkout.url, "stripe");
        const next: SavedCheckoutAttempt = { ...saved, provider: "stripe", checkoutUrl: url }; persistAttempt(next); setAttempt(next);
        window.location.assign(url);
        return;
      }
      if (paymentOption.mode === "redirect" || data.order.paymentProvider) throw new Error("Tu pedido está registrado, pero todavía no recibimos una dirección de pago. Usá Retomar pago para consultar el mismo intento.");
      setReceipt(data.order); releaseAttempt(); clear(); idempotencyKey.current = null;
    } catch (err) {
      // An unknown response can follow a committed order. Never create a second identity here.
      setError(errorMessage(err, "No pudimos confirmar el resultado. Conservamos tu bolsa para recuperar el mismo pedido."));
    } finally { submittingRef.current = false; setSubmitting(false); }
  }

  const recoveredReceipt = recoveredState === "completed" || recoveredState === "manual_received";
  return <>
    <StoreHeader />
    <RuntimeNotice onSettingsChange={setRuntimeSettings} />
    <main id="main-content" className="section-container cart-page">
      <Link href="/#collection" className="back-link"><ArrowLeft size={15} /> Seguir explorando</Link>
      {receipt ? <section className="receipt">
        <span className="receipt-check"><Check size={30} /></span><div className="eyebrow">PEDIDO RECIBIDO</div><h1>Ya es casi tuyo.</h1>
        <p>Guardamos tu pedido. El pago y la entrega quedan pendientes de coordinación con la tienda.</p>
        <div className="receipt-details"><span>Referencia<strong>{receipt.id}</strong></span><span>Estado<strong>Pendiente de pago</strong></span><span>Total<strong>{money(receipt.totalMinor, receipt.currency)}</strong></span></div>
        <p className="muted-text">Conservá esta referencia para consultar tu pedido. No se realizó ningún cobro.</p>
        <Link href="/#collection" className="button primary">Volver a la colección <ArrowRight size={16} /></Link>
      </section> : recoveredReceipt ? <section className="receipt">
        <span className="receipt-check"><Check size={30} /></span><div className="eyebrow">ESTADO VERIFICADO</div><h1>{recoveredState === "completed" ? "Pago confirmado." : "Pedido recibido."}</h1>
        <p>{recoveredState === "completed" ? "El servidor confirmó el pago de este intento. La tienda coordinará la entrega." : "Tu pedido ya estaba guardado. El pago manual y la entrega quedan a coordinar con la tienda."}</p>
        <p className="muted-text">Recuperamos el pedido original sin crear otro.</p><Link href="/#collection" className="button primary">Volver a la colección <ArrowRight size={16} /></Link>
      </section> : <>
        <div className="section-heading"><div><div className="eyebrow">TUS ELEGIDOS</div><h1>Mi bolsa<span>.</span></h1></div><span className="muted-text">{count} {count === 1 ? "artículo" : "artículos"}</span></div>
        {recoveredState === "cancelled" ? <p className="cart-refreshed" role="status">El intento anterior ya está cerrado. Revisá precios y disponibilidad antes de crear un nuevo pedido. Si viste un cargo en tu banco, consultá con la tienda.</p> : null}
        {attemptCorrupt ? <p className="form-error" role="alert">No pudimos recuperar la referencia del pago anterior. Contactá a la tienda antes de enviar otro pedido.</p> : null}
        {!ready || !attemptLoaded ? <div className="empty-state" role="status">Cargando tu bolsa…</div> : !items.length && !attempt ? <div className="empty-state cart-empty"><ShoppingBag size={40} strokeWidth={1.3} /><h2>Acá empieza algo bueno.</h2><p>Tu bolsa todavía está vacía. Encontrá eso que va con vos.</p><Link className="button primary" href="/#collection">Explorar colección <ArrowRight size={16} /></Link></div> : <div className="cart-layout">
          <div className="cart-items">{items.map(({ product, quantity }) => <article className="cart-item" key={product.id}>
            <ProductImage src={product.imageUrl} alt={product.name} className="cart-item-image" /><div className="cart-item-info"><span className="product-category">{product.category}</span><h2>{product.name}</h2><span>{money(product.priceMinor, product.currency)}</span><div className="quantity-stepper"><button aria-label={`Reducir cantidad de ${product.name}`} disabled={locked} onClick={() => change(product.id, quantity - 1)}><Minus size={13} /></button><span aria-label="Cantidad">{quantity}</span><button aria-label={`Aumentar cantidad de ${product.name}`} disabled={locked || quantity >= product.stock || quantity >= 99} onClick={() => change(product.id, quantity + 1)}><Plus size={13} /></button></div></div><div className="cart-item-end"><strong>{money(product.priceMinor * quantity, product.currency)}</strong><button className="icon-button" aria-label={`Eliminar ${product.name}`} disabled={locked} onClick={() => change(product.id, 0)}><Trash2 size={16} /></button></div>
          </article>)}</div>
          <aside className="cart-summary">
            {attempt ? <div className="checkout-recovery" aria-live="polite"><ShieldCheck size={26} /><h2>Continuemos el mismo pedido.</h2><p>Conservamos tu bolsa y la referencia del intento anterior. Primero verificaremos su estado para evitar un pedido duplicado.</p><div className="summary-total"><span>Total enviado</span><strong>{money(attempt.expectedTotalMinor, attempt.expectedCurrency)}</strong></div>{error ? <p className="form-error" role="alert">{error}</p> : null}<button type="button" className="button primary full-width" disabled={submitting} onClick={resumeCheckout}>{submitting ? "Verificando…" : attempt.provider === "stripe" ? "Retomar pago" : "Verificar mi pedido"}<ArrowRight size={16} /></button><p className="summary-footnote">Volver desde la pasarela no confirma ni cancela un pago.</p></div> : <form onSubmit={event => { event.preventDefault(); void checkout(); }}>
              <h2>Tu resumen</h2><div className="summary-row"><span>Productos</span><strong>{mixedCurrency ? "Varias monedas" : money(total, currency)}</strong></div><div className="summary-row"><span>Entrega</span><span>A coordinar</span></div><div className="summary-total"><span>Total de productos</span><strong>{mixedCurrency ? "—" : money(total, currency)}</strong></div>
              <div className="checkout-fields"><h3>¿Para quién es?</h3><label className="field">Nombre completo<input required minLength={2} autoComplete="name" maxLength={120} value={customer.name} onChange={event => setCustomer({ ...customer, name: event.target.value })} /></label><label className="field">Email<input required type="email" autoComplete="email" maxLength={200} value={customer.email} onChange={event => setCustomer({ ...customer, email: event.target.value })} /></label><label className="field">Teléfono <span>(opcional)</span><input type="tel" autoComplete="tel" maxLength={40} value={customer.phone} onChange={event => setCustomer({ ...customer, phone: event.target.value })} /></label><label className="field">Dirección <span>(opcional)</span><input autoComplete="street-address" maxLength={300} value={customer.address} onChange={event => setCustomer({ ...customer, address: event.target.value })} /></label></div>
              <div className="payment-note"><ShieldCheck size={20} /><p><strong>{paymentLoading ? "Consultando medios de pago…" : paymentOption?.label || "Medio de pago no disponible"}</strong>{paymentOption?.mode === "redirect" ? "Continuarás en una página segura de Stripe para completar el pago. La tienda no recibe datos de tu tarjeta." : "Confirmá tu pedido sin ingresar datos de tarjeta. El precio y el stock se verifican al confirmar."}</p></div>
              {paymentError ? <div className="form-error" role="alert">{paymentError}<button type="button" className="text-link" onClick={() => setPaymentRetry(value => value + 1)}>Reintentar</button></div> : null}
              {mixedCurrency ? <p className="form-error" role="alert">Tu bolsa incluye distintas monedas. Realizá un pedido separado por moneda.</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}{refreshed ? <p className="cart-refreshed" role="status">Precios y disponibilidad actualizados. Revisá tu bolsa antes de confirmar.</p> : null}
              <button type="button" className="refresh-cart-link" disabled={locked} onClick={refreshCart}>{refreshing ? "Actualizando…" : "Actualizar precios y stock"}</button>{!templateConfig.modules.orders ? <p className="form-error">La recepción de pedidos está desactivada.</p> : null}
              <button className="button primary full-width" type="submit" disabled={locked || mixedCurrency || !paymentOption || paymentLoading || !!paymentError || !templateConfig.modules.orders || runtimeSettings?.acceptingOrders === false}>{submitting ? "Preparando pedido…" : paymentOption?.mode === "redirect" ? "Continuar al pago seguro" : "Confirmar pedido"}<ArrowRight size={16} /></button><p className="summary-footnote">{paymentOption?.mode === "redirect" ? "La confirmación del pago se verifica en el servidor." : "No se realiza ningún cobro en este paso."}</p>
            </form>}
          </aside>
        </div>}
      </>}
    </main>
    <StoreFooter />
  </>;
}
