/**
 * Installation settings. Keep the object below as plain JSON: `npm run configure` rewrites it.
 * - currency: ISO 4217 default for new products and empty totals (USD unless customized).
 * - currencies: codes offered in the product editor; must include `currency`.
 * - i18n: languages offered by this installation (see docs/i18n.md to add one).
 * - description: one tagline, or one per language (the default language is used as the fallback).
 * Changing the currency never converts existing prices.
 *
 * Validate and edit these with the CLI instead of by hand; it uses the same validators as the app:
 *   npm run configure -- --name "Your Business" --currency EUR --currencies EUR,USD --locale en --locales en,es
 * `npm run doctor` reports `i18n.settings` and `currency.settings`.
 */
export interface TemplateConfig {
  name: string;
  /** One tagline, or one per locale (falls back to the default locale). */
  description: string | { [locale: string]: string | undefined };
  kind: "ecommerce" | "pos";
  currency: string;
  currencies: string[];
  i18n: { defaultLocale: string; locales: string[] };
  modules: { catalog: boolean; inventory: boolean; orders: boolean; mcp: boolean };
}
export const templateConfig:TemplateConfig = {
  "name": "NOMA",
  "description": {
    "en": "Everyday objects. Extraordinary design.",
    "es": "Objetos cotidianos. Diseño extraordinario."
  },
  "kind": "ecommerce",
  "currency": "USD",
  "currencies": [
    "USD",
    "EUR",
    "GBP",
    "MXN",
    "ARS",
    "BRL",
    "PYG"
  ],
  "i18n": {
    "defaultLocale": "en",
    "locales": [
      "en",
      "es"
    ]
  },
  "modules": {
    "catalog": true,
    "inventory": true,
    "orders": true,
    "mcp": true
  }
};
