import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckoutAttemptError, checkoutErrorKey, checkoutErrorKeys, checkoutRedirectUrl, checkoutStorageKey, parseSavedAttempt, persistAttempt, saveableAttempt, type CheckoutAttemptErrorCode, type CheckoutPayload } from "../src/components/checkout-attempt";

const payload: CheckoutPayload = {
  idempotencyKey: "37391f69-9764-4b47-9a16-8f33f7a82c78",
  customer: { name: "Private Customer", email: "private@example.test", phone: "+595555555", address: "Private address" },
  items: [{ productId: "product-one", quantity: 2 }],
  expectedTotalMinor: 4900,
  expectedCurrency: "USD",
};

describe("hosted checkout recovery", () => {
  it("retains the retry identity and submitted cart without storing customer PII", () => {
    const attempt = saveableAttempt(payload, "stripe");
    const serialized = JSON.stringify(attempt);
    expect(serialized).not.toContain("Private");
    expect(serialized).not.toContain("private@example.test");
    expect(serialized).not.toContain("+595555555");
    expect(parseSavedAttempt(serialized)).toEqual(attempt);
    expect(attempt.idempotencyKey).toBe(payload.idempotencyKey);
    expect(attempt.items).toEqual(payload.items);
    expect(attempt.items).not.toBe(payload.items);
  });

  it("resumes the same provider session after navigation without generating a second identity", () => {
    const created = { ...saveableAttempt(payload, "stripe"), checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_existing" };
    const resumed = parseSavedAttempt(JSON.stringify(created));
    expect(resumed?.idempotencyKey).toBe(payload.idempotencyKey);
    expect(checkoutRedirectUrl(resumed?.checkoutUrl, resumed?.provider || "")).toBe(created.checkoutUrl);
  });

  it.each([
    "javascript:alert(1)",
    "https://checkout.stripe.com.evil.test/pay",
    "http://checkout.stripe.com/pay",
    "https://user@checkout.stripe.com/pay",
    "https://checkout.stripe.com:8080/pay",
    "https://example.test/pay",
  ])("rejects unsafe or unrelated redirect destinations: %s", url => {
    expect(() => checkoutRedirectUrl(url, "stripe")).toThrow();
    expect(parseSavedAttempt(JSON.stringify({ ...saveableAttempt(payload, "stripe"), checkoutUrl: url }))).toBeNull();
  });

  it("rejects corrupted cart snapshots rather than creating another order from them", () => {
    expect(parseSavedAttempt("not-json")).toBeNull();
    expect(parseSavedAttempt(JSON.stringify({ ...saveableAttempt(payload, "stripe"), items: [{ productId: "x", quantity: -1 }] }))).toBeNull();
    expect(parseSavedAttempt(JSON.stringify({ ...saveableAttempt(payload, "stripe"), expectedTotalMinor: Number.MAX_SAFE_INTEGER + 1 }))).toBeNull();
  });
});

/** The error a rejected hosted-checkout step throws, so the page can word it in the visitor's language. */
function thrown(action: () => unknown): unknown {
  try { action(); } catch (error) { return error; }
  throw new Error("Expected the action to throw.");
}

function cartMessage(locale: "en" | "es", key: string): unknown {
  const tree = JSON.parse(readFileSync(fileURLToPath(new URL(`../src/i18n/messages/${locale}/cart.json`, import.meta.url)), "utf8")) as unknown;
  return key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), tree);
}

describe("checkout failures are coded, never sentences shown to the customer", () => {
  const codes = Object.keys(checkoutErrorKeys) as CheckoutAttemptErrorCode[];

  it("rejects a missing or malformed payment address as PAYMENT_URL_INVALID", () => {
    for (const value of [undefined, null, 42, true, {}, [], "", "   ", "not a url", "/relative/path", "//checkout.stripe.com/pay", "checkout.stripe.com/pay"]) {
      const error = thrown(() => checkoutRedirectUrl(value, "stripe"));
      expect(error, JSON.stringify(value)).toBeInstanceOf(CheckoutAttemptError);
      expect((error as CheckoutAttemptError).code, JSON.stringify(value)).toBe("PAYMENT_URL_INVALID");
    }
  });

  it("rejects a well-formed address that is not the provider's own page as PAYMENT_URL_UNVERIFIED", () => {
    const unverified: Array<[string, string]> = [
      ["https://example.test/pay", "stripe"],
      ["https://checkout.stripe.com.evil.test/pay", "stripe"],
      ["https://evilcheckout.stripe.com/pay", "stripe"],
      ["http://checkout.stripe.com/pay", "stripe"],
      ["javascript:alert(1)", "stripe"],
      ["https://user:secret@checkout.stripe.com/pay", "stripe"],
      ["https://checkout.stripe.com:8443/pay", "stripe"],
      // A real Stripe address is still refused when the order was not created with Stripe.
      ["https://checkout.stripe.com/c/pay/cs_test_x", "manual"],
      ["https://checkout.stripe.com/c/pay/cs_test_x", ""],
    ];
    for (const [url, provider] of unverified) {
      const error = thrown(() => checkoutRedirectUrl(url, provider));
      expect(error, url).toBeInstanceOf(CheckoutAttemptError);
      expect((error as CheckoutAttemptError).code, `${provider} ${url}`).toBe("PAYMENT_URL_UNVERIFIED");
    }
  });

  it("never copies the rejected address or its credentials into the error", () => {
    const secret = "https://user:topsecret@checkout.stripe.com/pay?token=hidden";
    const error = thrown(() => checkoutRedirectUrl(secret, "stripe")) as CheckoutAttemptError;
    expect(`${error.message} ${error.stack?.split("\n")[0]}`).not.toMatch(/topsecret|hidden|user:/);
    expect(JSON.stringify(error)).not.toMatch(/topsecret|hidden/);
  });

  it("accepts the provider page unchanged, so the failure codes only appear for real problems", () => {
    expect(checkoutRedirectUrl("https://checkout.stripe.com/c/pay/cs_test_ok#fragment", "stripe")).toBe("https://checkout.stripe.com/c/pay/cs_test_ok#fragment");
  });

  it("is a real Error with a stable name, the code it was given and an English description for logs", () => {
    for (const code of codes) {
      const error = new CheckoutAttemptError(code);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("CheckoutAttemptError");
      expect(error.code).toBe(code);
      expect(error.message.length).toBeGreaterThan(20);
      // Logs and tests get English; the customer gets the cart.json text selected by `checkoutErrorKey`.
      expect(error.message).toMatch(/^[A-Z][A-Za-z ,'-]+\.$/);
      expect(error.message).not.toMatch(/[áéíóúñ¿¡]/i);
      expect(error.message).not.toBe(code);
    }
    expect(new Set(codes.map(code => new CheckoutAttemptError(code).message)).size).toBe(codes.length);
  });

  it("maps each code to its own cart.json key", () => {
    for (const code of codes) expect(checkoutErrorKey(new CheckoutAttemptError(code))).toBe(checkoutErrorKeys[code]);
    expect(new Set(Object.values(checkoutErrorKeys)).size).toBe(codes.length);
    expect(checkoutErrorKey(thrown(() => checkoutRedirectUrl(undefined, "stripe")))).toBe("failures.paymentUrlInvalid");
    expect(checkoutErrorKey(thrown(() => checkoutRedirectUrl("https://example.test/", "stripe")))).toBe("failures.paymentUrlUnverified");
  });

  it("returns null for anything that is not a CheckoutAttemptError, so the page falls back to API error codes", () => {
    class ApiLikeError extends Error { constructor(public code: string) { super("The operation could not be completed."); } }
    const lookalikes = [
      new Error("boom"), new TypeError("Failed to fetch"), new ApiLikeError("NETWORK_ERROR"), new ApiLikeError("PAYMENT_URL_INVALID"),
      // Same shape, not the class: a duck-typed object or a renamed error must not pick a customer message.
      { name: "CheckoutAttemptError", code: "STORAGE_UNAVAILABLE", message: "x" },
      Object.assign(new Error("x"), { name: "CheckoutAttemptError", code: "PAYMENT_URL_MISSING" }),
      "PAYMENT_URL_INVALID", 404, null, undefined, {}, [],
    ];
    for (const value of lookalikes) expect(checkoutErrorKey(value), String(value)).toBeNull();
  });

  it("only ever returns keys that exist in the English and Spanish cart messages, and they are translated", () => {
    for (const code of codes) {
      const key = checkoutErrorKeys[code];
      const english = cartMessage("en", key);
      const spanish = cartMessage("es", key);
      expect(typeof english, `en ${key}`).toBe("string");
      expect(typeof spanish, `es ${key}`).toBe("string");
      expect((english as string).length, `en ${key}`).toBeGreaterThan(10);
      expect((spanish as string).length, `es ${key}`).toBeGreaterThan(10);
      expect(spanish, `${key} must be translated, not copied from English`).not.toBe(english);
      // Customer text carries no placeholders to fill and no markup.
      expect(`${english}${spanish}`).not.toMatch(/[{}<>]/);
      expect(key.startsWith("failures.")).toBe(true);
    }
  });
});

describe("persisting a checkout attempt fails loudly so no order is created without recovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("propagates a storage failure instead of swallowing it (the page turns it into STORAGE_UNAVAILABLE)", () => {
    vi.stubGlobal("sessionStorage", { setItem: () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); } });
    expect(() => persistAttempt(saveableAttempt(payload, "stripe"))).toThrow(/quota/i);
  });

  it("fails when session storage does not exist at all, such as a locked-down browser", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(() => persistAttempt(saveableAttempt(payload, "manual"))).toThrow();
  });

  it("writes only the replayable attempt (no customer data) under the versioned key", () => {
    const written: Array<[string, string]> = [];
    vi.stubGlobal("sessionStorage", { setItem: (key: string, value: string) => { written.push([key, value]); } });
    persistAttempt(saveableAttempt(payload, "stripe"));
    expect(written).toHaveLength(1);
    expect(written[0]![0]).toBe(checkoutStorageKey);
    expect(written[0]![1]).not.toMatch(/Private|private@example\.test|\+595555555/);
    expect(parseSavedAttempt(written[0]![1])).toEqual(saveableAttempt(payload, "stripe"));
  });
});
