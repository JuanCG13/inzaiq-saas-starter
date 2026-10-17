export type { Product, Order } from "@/core/contracts";

export interface Session {
  user: { id: string; name: string };
  tenant: { id: string; name: string };
  role: string;
  demo: boolean;
}

export function money(minor: number, currency = "USD", locale = "es-PY") {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / currencyFactor(currency));
}

export function safeImageUrl(value: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : undefined;
  } catch {
    return value.startsWith("/") && !value.startsWith("//") ? value : undefined;
  }
}

export function currencyFactor(currency = "USD") {
  return 10 ** (new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2);
}

export function errorMessage(error: unknown, fallback = "No se pudo completar la operación.") {
  if (!(error instanceof Error)) return fallback;
  const requestId = "requestId" in error && typeof error.requestId === "string" ? error.requestId : null;
  return `${error.message}${requestId ? ` Referencia: ${requestId}` : ""}`;
}
