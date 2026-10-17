"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api-client";
import { useCart } from "@/components/cart-provider";
import { StoreFooter, StoreHeader } from "@/components/store-header";
import { errorMessage } from "@/components/types";
import { checkoutRedirectUrl, checkoutStorageKey, clearAttempt, parseSavedAttempt, persistAttempt, type CheckoutRecovery, type SavedCheckoutAttempt } from "@/components/checkout-attempt";

export default function CheckoutReturnPage() {
  const { ready, settle } = useCart();
  const [checking, setChecking] = useState(true);
  const [state, setState] = useState<CheckoutRecovery["state"] | null>(null);
  const [attempt, setAttempt] = useState<SavedCheckoutAttempt | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const controller = new AbortController();
    async function verify() {
      setChecking(true); setError("");
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
        if (active) setError(errorMessage(err, "Todavía no pudimos verificar el pago. Tu intento sigue conservado."));
      } finally { if (active) setChecking(false); }
    }
    void verify();
    return () => { active = false; controller.abort(); };
  }, [ready, retry, settle]);

  function resume() {
    if (!attempt?.checkoutUrl || checking) return;
    try { window.location.assign(checkoutRedirectUrl(attempt.checkoutUrl, attempt.provider)); }
    catch (err) { setError(errorMessage(err)); }
  }

  const confirmed = state === "completed";
  const manualReceived = state === "manual_received";
  const cancelled = state === "cancelled";
  const title = checking ? "Estamos verificando el pago." : confirmed ? "Pago confirmado." : manualReceived ? "Pedido recibido." : cancelled ? "Este intento está cerrado." : "La confirmación está pendiente.";
  return <><StoreHeader /><main id="main-content" className="section-container cart-page"><section className="receipt payment-return">
    <span className="receipt-check">{confirmed || manualReceived ? <Check size={30} /> : <ShieldCheck size={30} />}</span>
    <div className="eyebrow">{confirmed || manualReceived ? "ESTADO VERIFICADO POR LA TIENDA" : "REGRESO DEL PAGO"}</div>
    <h1>{title}</h1>
    <p>{confirmed ? "El servidor confirmó el pago. La tienda coordinará la entrega de tu pedido." : manualReceived ? "El pedido ya está guardado. El pago manual y la entrega quedan a coordinar." : cancelled ? "El servidor cerró este intento. Podés volver a la bolsa y revisar disponibilidad antes de crear otro. Si ves un cargo en tu banco, consultá con la tienda." : "Volver a esta página no confirma un cobro. Estamos verificando el estado del intento con la tienda; tu bolsa se conserva mientras tanto."}</p>
    {!attempt && !checking ? <p className="muted-text">No encontramos una referencia en esta pestaña. Si ya realizaste el pago, consultá con la tienda antes de enviar otro pedido.</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="payment-return-actions">
      {state === "pending" && attempt?.checkoutUrl ? <button className="button primary" type="button" onClick={resume}>Retomar el mismo pago <ArrowRight size={16} /></button> : null}
      {attempt && !confirmed && !manualReceived && !cancelled ? <button className="button secondary" type="button" disabled={checking} onClick={() => setRetry(value => value + 1)}>{checking ? "Verificando…" : "Volver a verificar"}<RefreshCw size={15} className={checking ? "spin" : ""} /></button> : null}
      <Link href={confirmed || manualReceived ? "/#collection" : "/cart"} className="text-link"><ArrowLeft size={15} />{confirmed || manualReceived ? "Volver a la colección" : "Volver a mi bolsa"}</Link>
    </div>
    <p className="muted-text">No se crean pedidos nuevos al consultar el estado.</p>
  </section></main><StoreFooter /></>;
}
