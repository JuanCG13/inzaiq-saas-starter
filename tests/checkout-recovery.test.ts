import { describe, expect, it } from "vitest";
import { checkoutRedirectUrl, parseSavedAttempt, saveableAttempt, type CheckoutPayload } from "../src/components/checkout-attempt";

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
