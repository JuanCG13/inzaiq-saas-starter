"use client";

import { ArrowUpRight, ShoppingBag } from "lucide-react";
import { LocaleLink } from "@/i18n/link";
import { useT } from "@/i18n/provider";
import { LocaleSwitcher } from "@/i18n/switcher";
import { useCart } from "./cart-provider";
import { templateConfig } from "@/template.config";

export function StoreHeader() {
  const { count } = useCart();
  const t = useT("common");
  return <>
    <div className="announcement">{t("header.announcement")} <span>{t("header.announcementLink")} <ArrowUpRight size={12} /></span></div>
    <header className="store-header">
      <LocaleLink href="/" className="wordmark" aria-label={t("header.home", { brand: templateConfig.name })}>{templateConfig.name}<span>®</span></LocaleLink>
      <nav aria-label={t("header.navLabel")} className="store-nav"><LocaleLink href="/#collection">{t("header.collection")}</LocaleLink><LocaleLink href="/#philosophy">{t("header.philosophy")}</LocaleLink></nav>
      <div className="header-actions"><LocaleSwitcher /><LocaleLink href="/admin" className="manage-link">{t("header.manage")} <ArrowUpRight size={13} /></LocaleLink><LocaleLink href="/cart" className="cart-link" aria-label={t("header.bagCount", { count })}><ShoppingBag size={19} strokeWidth={1.6} /><span className="cart-label">{t("header.bag")}</span><span className="cart-count">{count}</span></LocaleLink></div>
    </header>
  </>;
}

export function StoreFooter() {
  const t = useT("common");
  return <footer className="store-footer"><div><LocaleLink href="/" className="wordmark">{templateConfig.name}<span>®</span></LocaleLink><p>{t("footer.tagline")}</p></div><div className="footer-links"><LocaleLink href="/#collection">{t("footer.explore")}</LocaleLink><LocaleLink href="/cart">{t("footer.bag")}</LocaleLink><LocaleLink href="/admin">{t("footer.business")} <ArrowUpRight size={12} /></LocaleLink></div><span className="footer-caption">{t("footer.caption")}</span></footer>;
}
