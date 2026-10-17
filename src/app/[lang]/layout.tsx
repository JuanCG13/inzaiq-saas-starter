import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CartProvider } from "@/components/cart-provider";
import { I18nProvider } from "@/i18n/provider";
import { loadMessages, getTranslator } from "@/i18n/messages";
import { brandDescription, enabledLocales, formatLocaleOf, isEnabledLocale } from "@/i18n/runtime";
import { templateConfig } from "@/template.config";
import "../globals.css";

export const dynamicParams = false;
export function generateStaticParams() { return enabledLocales.map(lang => ({ lang })); }

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!isEnabledLocale(lang)) return {};
  const t = await getTranslator(lang, "common");
  return { title: { default: t("meta.title", { brand: templateConfig.name }), template: `%s | ${templateConfig.name}` }, description: brandDescription(lang) };
}

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isEnabledLocale(lang)) notFound();
  const messages = await loadMessages(lang, ["common", "errors", "runtime"]);
  const t = await getTranslator(lang, "common");
  return <html lang={lang} data-scroll-behavior="smooth"><body><a className="skip-link" href="#main-content">{t("skipToContent")}</a><I18nProvider locale={lang} formatLocale={formatLocaleOf(lang)} messages={messages}><CartProvider>{children}</CartProvider></I18nProvider></body></html>;
}
