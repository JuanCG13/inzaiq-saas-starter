"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronRight, Package, Plus, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { LocaleLink } from "@/i18n/link";
import { useErrorMessage, useFormat, useLocale, useT } from "@/i18n/provider";
import { RuntimeNotice } from "@/runtime/components";
import { templateConfig } from "@/template.config";
import { StoreFooter, StoreHeader } from "./store-header";
import { useCart } from "./cart-provider";
import { ProductImage } from "./product-image";
import { useDialogFocus } from "./use-dialog-focus";
import type { Product, Session } from "./types";

/** Language-independent "every category" filter. Real categories are never empty (they are filtered with Boolean below). */
const ALL_CATEGORIES = "";

export function Storefront() {
  const t = useT("storefront");
  const { money } = useFormat();
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  // The failed request is kept (not its text) so the message follows the active language when it is rendered.
  const [failure, setFailure] = useState<{ cause: unknown; collection: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [selected, setSelected] = useState<Product | null>(null);
  const [notice, setNotice] = useState("");
  const [demo, setDemo] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { add } = useCart();
  const dialogFocus = useDialogFocus();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setFailure(null);
    if (!templateConfig.modules.catalog) { setLoading(false); return; }
    api<{ products: Product[] }>("/api/store/products?limit=100&offset=0", { signal: controller.signal }).then(data => { setProducts(data.products.filter(product => product.active)); setHasMore(data.products.length === 100); }).catch(err => { if (!controller.signal.aborted) setFailure({ cause: err, collection: true }); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => { const controller = new AbortController(); api<Session>("/api/session", { signal: controller.signal }).then(data => setDemo(data.demo)).catch(() => {}); return () => controller.abort(); }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  const error = failure ? errorMessage(failure.cause, failure.collection ? t("collection.loadFailed") : undefined) : "";
  const categories = [ALL_CATEGORIES, ...Array.from(new Set(products.map(product => product.category).filter(Boolean)))];
  const filtered = products.filter(product => (category === ALL_CATEGORIES || product.category === category) && `${product.name} ${product.description} ${product.category}`.toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)));
  async function loadMore() {
    if (loadingMore) return; setLoadingMore(true);
    try { const data = await api<{ products: Product[] }>(`/api/store/products?limit=100&offset=${products.length}`); setProducts(current => [...current, ...data.products.filter(product => !current.some(existing => existing.id === product.id))]); setHasMore(data.products.length === 100); }
    catch (err) { setFailure({ cause: err, collection: false }); } finally { setLoadingMore(false); }
  }
  function addProduct(product: Product) {
    add(product);
    setNotice(t("toast.added", { name: product.name }));
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 3500);
  }

  return <>
    <StoreHeader />
    <RuntimeNotice />
    {demo ? <div className="demo-strip">{t("demoStrip")}</div> : null}
    <main id="main-content">
      <section className="hero section-container" aria-labelledby="hero-title">
        <div className="hero-copy"><div className="eyebrow"><span className="status-dot" /> {t("hero.eyebrow")}</div><h1 id="hero-title">{t("hero.title.line1")}<br /><span>{t("hero.title.line2")}</span></h1><p>{t("hero.lead")}</p><LocaleLink href="#collection" className="button primary hero-cta">{t("hero.cta")} <ArrowUpRight size={17} /></LocaleLink><div className="hero-note"><span className="line" /> {t("hero.note")}</div></div>
        <div className="hero-visual"><ProductImage priority src="/demo/hero.svg" alt={t("hero.imageAlt")} className="hero-photo" /><div className="hero-photo-shade" /><span className="hero-edition">{t("hero.edition", { brand: templateConfig.name })}</span><a className="hero-photo-caption" href="#collection"><div><span>{t("hero.caption.kicker")}</span><strong>{t("hero.caption.title")}</strong></div><span className="round-arrow"><ArrowUpRight size={22} /></span></a><div className="hero-label"><Sparkles size={14} /><span>{t("hero.label")}</span></div></div>
      </section>
      <div className="principles section-container"><span><Package size={17} /> {t("principles.details")}</span><span><ShieldCheck size={17} /> {t("principles.service")}</span><a href="#philosophy">{t("principles.link")} <ArrowRight size={14} /></a></div>
      <section className="collection section-container" id="collection" aria-labelledby="collection-title">
        <div className="section-heading"><div><div className="eyebrow">{t("collection.eyebrow")}</div><h2 id="collection-title">{t("collection.title")}<span>.</span></h2></div><span className="collection-count">{t("collection.count", { count: products.length })} <ArrowDown size={15} /></span></div>
        <div className="collection-toolbar"><div className="category-filters" role="group" aria-label={t("collection.filterLabel")}>{categories.map(item => <button key={item} className={`category-pill ${category === item ? "selected" : ""}`} aria-pressed={category === item} onClick={() => setCategory(item)}>{item === ALL_CATEGORIES ? t("collection.all") : item}</button>)}</div><label className="search-field"><Search size={17} /><input type="search" placeholder={t("collection.searchPlaceholder")} aria-label={t("collection.searchLabel")} value={query} onChange={event => setQuery(event.target.value)} /></label></div>
        {error ? <div className="empty-state" role="alert"><Package size={30} /><h3>{t("collection.error.title")}</h3><p>{error}</p><button className="button secondary" onClick={() => setRetry(value => value + 1)}>{t("collection.error.retry")}</button></div> : loading ? <div className="product-grid" aria-label={t("collection.loading")} aria-busy="true">{Array.from({ length: 6 }, (_, index) => <div className="product-skeleton" key={index}><div /><span /><span /></div>)}</div> : filtered.length ? <div className="product-grid">{filtered.map((product, index) => <article className="product-card" key={product.id}><button className={`product-image-button tone-${index % 4}`} onClick={() => setSelected(product)} aria-label={t("product.view", { name: product.name })}><ProductImage src={product.imageUrl} alt={product.name} className="product-photo" /><span className="product-badge">{product.stock === 0 ? t("product.soldOut") : product.stock < 5 ? t("product.lowStock") : product.category || t("product.defaultBadge", { brand: templateConfig.name })}</span><span className="product-view">{t("product.viewDetails")} <ArrowUpRight size={15} /></span></button><div className="product-meta"><div><span className="product-category">{product.category || t("product.defaultCategory")}</span><button className="product-name" onClick={() => setSelected(product)}>{product.name}</button><span className="product-price">{money(product.priceMinor, product.currency)}</span></div><button className="add-product" aria-label={t("product.addToBag", { name: product.name })} disabled={product.stock < 1 || !templateConfig.modules.orders} onClick={() => addProduct(product)}><Plus size={19} strokeWidth={1.5} /></button></div></article>)}</div> : <div className="empty-state"><Search size={30} /><h3>{t("collection.empty.title")}</h3><p>{t("collection.empty.hint")}</p><button className="button secondary" onClick={() => { setQuery(""); setCategory(ALL_CATEGORIES); }}>{t("collection.empty.reset")}</button></div>}
        {hasMore ? <div className="load-more"><button className="button secondary" disabled={loadingMore} onClick={loadMore}>{loadingMore ? t("collection.loadMore.loading") : t("collection.loadMore.action")}<ArrowDown size={15} /></button><p>{t("collection.loadMore.progress", { count: products.length })}</p></div> : null}
      </section>
      <section className="philosophy section-container" id="philosophy"><div className="philosophy-mark">{templateConfig.name.slice(0, 1)}<span>®</span></div><div><div className="eyebrow">{t("philosophy.eyebrow")}</div><h2>{t("philosophy.title.line1")}<br />{t("philosophy.title.line2")}</h2><p>{t("philosophy.body")}</p><LocaleLink href="#collection" className="text-link">{t("philosophy.link")} <ArrowRight size={17} /></LocaleLink></div></section>
    </main>
    <StoreFooter />
    <div className={`cart-toast ${notice ? "visible" : ""}`} role="status" aria-live="polite">{notice ? <><span><Check size={17} />{notice}</span><LocaleLink href="/cart">{t("toast.viewBag")} <ChevronRight size={14} /></LocaleLink></> : null}</div>
    <Dialog.Root open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content product-dialog" {...dialogFocus}>{selected ? <><Dialog.Close className="dialog-close" aria-label={t("detail.close")}><X size={19} /></Dialog.Close><div className="detail-image"><ProductImage src={selected.imageUrl} alt={selected.name} className="detail-photo" /></div><div className="detail-copy"><span className="eyebrow">{selected.category || t("detail.eyebrowFallback", { brand: templateConfig.name })}</span><Dialog.Title>{selected.name}</Dialog.Title><div className="detail-price">{money(selected.priceMinor, selected.currency)}</div><Dialog.Description>{selected.description || t("detail.descriptionFallback")}</Dialog.Description><div className="detail-stock"><span className={`status-dot ${!selected.stock ? "muted" : ""}`} />{selected.stock > 0 ? t("detail.stock", { count: selected.stock }) : t("detail.outOfStock")}</div><button className="button primary full-width" disabled={selected.stock < 1 || !templateConfig.modules.orders} onClick={() => addProduct(selected)}>{!templateConfig.modules.orders ? t("detail.ordersUnavailable") : selected.stock > 0 ? t("detail.add") : t("product.soldOut")}<Plus size={18} /></button><LocaleLink href="/cart" className="text-link">{t("detail.goToBag")} <ArrowRight size={16} /></LocaleLink><p className="detail-note"><ShieldCheck size={15} /> {t("detail.note")}</p></div></> : null}</Dialog.Content></Dialog.Portal></Dialog.Root>
  </>;
}
