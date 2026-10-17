import type { Customer } from "@/core/contracts";

export interface PaymentOption {
  provider: "manual" | "stripe";
  /** Server-side label for logs and agents. Never displayed: the UI picks its text from `provider` and `mode` so it follows the active language. */
  label: string;
  mode: "manual" | "redirect";
}

/**
 * Stable reasons the checkout flow can fail without an API response. Helpers and pages throw
 * these instead of sentences: the UI maps each code to a message in the `cart` namespace.
 */
export type CheckoutAttemptErrorCode =
  | "PAYMENT_MODE_UNAVAILABLE"
  | "STORAGE_UNAVAILABLE"
  | "PAYMENT_URL_MISSING"
  | "PAYMENT_URL_INVALID"
  | "PAYMENT_URL_UNVERIFIED";

/** English descriptions for logs and tests only; they are never shown to a customer. */
const attemptErrorDetails: Record<CheckoutAttemptErrorCode, string> = {
  PAYMENT_MODE_UNAVAILABLE: "The payment options response is not a supported provider and mode.",
  STORAGE_UNAVAILABLE: "Session storage is unavailable, so the checkout attempt cannot be recovered safely.",
  PAYMENT_URL_MISSING: "The order was registered but no hosted payment address was returned.",
  PAYMENT_URL_INVALID: "The hosted payment address is missing or not a URL.",
  PAYMENT_URL_UNVERIFIED: "The hosted payment address is not an allowed provider page.",
};

export class CheckoutAttemptError extends Error {
  constructor(readonly code: CheckoutAttemptErrorCode) {
    super(attemptErrorDetails[code]);
    this.name = "CheckoutAttemptError";
  }
}

/** `cart.json` key that explains each code to the customer. */
export const checkoutErrorKeys = {
  PAYMENT_MODE_UNAVAILABLE: "failures.paymentModeUnavailable",
  STORAGE_UNAVAILABLE: "failures.storageUnavailable",
  PAYMENT_URL_MISSING: "failures.paymentUrlMissing",
  PAYMENT_URL_INVALID: "failures.paymentUrlInvalid",
  PAYMENT_URL_UNVERIFIED: "failures.paymentUrlUnverified",
} as const satisfies Record<CheckoutAttemptErrorCode, string>;

/** Message key for a checkout flow error, or null when the error is not one of ours. */
export function checkoutErrorKey(error: unknown): (typeof checkoutErrorKeys)[CheckoutAttemptErrorCode] | null {
  return error instanceof CheckoutAttemptError ? checkoutErrorKeys[error.code] : null;
}

export interface CheckoutRecovery {
  state: "pending" | "completed" | "cancelled" | "not_found" | "manual_received";
  checkout?: { kind: "redirect"; url: string };
}

export interface CheckoutPayload {
  items: Array<{ productId: string; quantity: number }>;
  customer: Customer;
  expectedTotalMinor: number;
  expectedCurrency: string;
  idempotencyKey: string;
}

/** No customer details or credentials are retained when navigating to a payment provider. */
export interface SavedCheckoutAttempt {
  version: 1;
  idempotencyKey: string;
  provider: PaymentOption["provider"];
  items: Array<{ productId: string; quantity: number }>;
  expectedTotalMinor: number;
  expectedCurrency: string;
  checkoutUrl?: string;
}

export const checkoutStorageKey = "commerce.checkout.v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only configured provider-owned hosted checkout pages may receive browser navigation. */
export function checkoutRedirectUrl(value: unknown, provider: string): string {
  if (typeof value !== "string") throw new CheckoutAttemptError("PAYMENT_URL_INVALID");
  let url: URL;
  try { url = new URL(value); } catch { throw new CheckoutAttemptError("PAYMENT_URL_INVALID"); }
  if (provider !== "stripe" || url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.port || url.username || url.password) {
    throw new CheckoutAttemptError("PAYMENT_URL_UNVERIFIED");
  }
  return url.href;
}

export function saveableAttempt(payload: CheckoutPayload, provider: PaymentOption["provider"]): SavedCheckoutAttempt {
  return {
    version: 1,
    idempotencyKey: payload.idempotencyKey,
    provider,
    items: payload.items.map(item => ({ ...item })),
    expectedTotalMinor: payload.expectedTotalMinor,
    expectedCurrency: payload.expectedCurrency,
  };
}

export function parseSavedAttempt(raw: string | null): SavedCheckoutAttempt | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedCheckoutAttempt>;
    if (value.version !== 1 || typeof value.idempotencyKey !== "string" || !uuid.test(value.idempotencyKey)
      || (value.provider !== "manual" && value.provider !== "stripe")
      || !Number.isSafeInteger(value.expectedTotalMinor) || Number(value.expectedTotalMinor) < 0
      || typeof value.expectedCurrency !== "string" || !/^[A-Z]{3}$/.test(value.expectedCurrency)
      || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 100
      || !value.items.every(item => item && typeof item.productId === "string" && item.productId.length < 200 && Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 1000)) return null;
    if (value.checkoutUrl !== undefined) checkoutRedirectUrl(value.checkoutUrl, value.provider);
    return { version: 1, idempotencyKey: value.idempotencyKey, provider: value.provider, items: value.items.map(item => ({ productId: item.productId, quantity: item.quantity })), expectedTotalMinor: Number(value.expectedTotalMinor), expectedCurrency: value.expectedCurrency, ...(value.checkoutUrl ? { checkoutUrl: value.checkoutUrl } : {}) };
  } catch { return null; }
}

export function persistAttempt(attempt: SavedCheckoutAttempt) {
  // Failure is explicit before creating an order: redirect recovery must survive a page reload.
  sessionStorage.setItem(checkoutStorageKey, JSON.stringify(attempt));
}

export function clearAttempt() { sessionStorage.removeItem(checkoutStorageKey); }
