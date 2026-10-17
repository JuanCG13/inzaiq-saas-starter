export type { Product, Order } from "@/core/contracts";

export interface Session {
  user: { id: string; name: string };
  tenant: { id: string; name: string };
  role: string;
  demo: boolean;
}

export { currencyFactor, formatMoney as money } from "@/i18n/format";

export function safeImageUrl(value: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : undefined;
  } catch {
    return value.startsWith("/") && !value.startsWith("//") ? value : undefined;
  }
}


export function errorMessage(error: unknown, fallback = "No se pudo completar la operación.") {
  if (!(error instanceof Error)) return fallback;
  const requestId = "requestId" in error && typeof error.requestId === "string" ? error.requestId : null;
  return `${error.message}${requestId ? ` Referencia: ${requestId}` : ""}`;
}
