"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronRight, Package, Plus, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { RuntimeNotice } from "@/runtime/components";
import { templateConfig } from "@/template.config";
import { StoreFooter, StoreHeader } from "./store-header";
import { useCart } from "./cart-provider";
import { ProductImage } from "./product-image";
import { useDialogFocus } from "./use-dialog-focus";
import { money, errorMessage, type Product, type Session } from "./types";

export function Storefront() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todo");
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
    setLoading(true); setError("");
    if (!templateConfig.modules.catalog) { setLoading(false); return; }
    api<{ products: Product[] }>("/api/store/products?limit=100&offset=0", { signal: controller.signal }).then(data => { setProducts(data.products.filter(product => product.active)); setHasMore(data.products.length === 100); }).catch(err => { if (!controller.signal.aborted) setError(errorMessage(err, "No se pudo cargar la colección.")); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => { const controller = new AbortController(); api<Session>("/api/session", { signal: controller.signal }).then(data => setDemo(data.demo)).catch(() => {}); return () => controller.abort(); }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  const categories = ["Todo", ...Array.from(new Set(products.map(product => product.category).filter(Boolean)))];
  const filtered = products.filter(product => (category === "Todo" || product.category === category) && `${product.name} ${product.description} ${product.category}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")));
  async function loadMore() {
    if (loadingMore) return; setLoadingMore(true);
    try { const data = await api<{ products: Product[] }>(`/api/store/products?limit=100&offset=${products.length}`); setProducts(current => [...current, ...data.products.filter(product => !current.some(existing => existing.id === product.id))]); setHasMore(data.products.length === 100); }
    catch (err) { setError(errorMessage(err)); } finally { setLoadingMore(false); }
  }
  function addProduct(product: Product) {
    add(product);
    setNotice(`${product.name} en tu bolsa`);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 3500);
  }

  return <>
    <StoreHeader />
    <RuntimeNotice />
    {demo ? <div className="demo-strip">Tienda de demostración · Los pedidos se guardan como pruebas y no generan cobros.</div> : null}
    <main id="main-content">
      <section className="hero section-container" aria-labelledby="hero-title">
        <div className="hero-copy"><div className="eyebrow"><span className="status-dot" /> LO ESENCIAL, BIEN ELEGIDO</div><h1 id="hero-title">Tu día a día.<br /><span>Un poco mejor.</span></h1><p>Prendas, objetos y pequeños favoritos que hacen espacio para lo que importa.</p><Link href="#collection" className="button primary hero-cta">Encontrá tu próximo favorito <ArrowUpRight size={17} /></Link><div className="hero-note"><span className="line" /> Hecho para acompañarte. Elegido para durar.</div></div>
        <div className="hero-visual"><ProductImage priority src="https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=1200&q=85" alt="Prendas de tonos naturales en una colección cuidadosamente elegida" className="hero-photo" /><div className="hero-photo-shade" /><span className="hero-edition">{templateConfig.name} / SELECCIÓN 01</span><a className="hero-photo-caption" href="#collection"><div><span>MENOS, PERO MEJOR</span><strong>Los nuevos esenciales.</strong></div><span className="round-arrow"><ArrowUpRight size={22} /></span></a><div className="hero-label"><Sparkles size={14} /><span>Una colección con intención</span></div></div>
      </section>
      <div className="principles section-container"><span><Package size={17} /> Detalles que hacen la diferencia</span><span><ShieldCheck size={17} /> Compra simple, atención cercana</span><a href="#philosophy">Conocé nuestra mirada <ArrowRight size={14} /></a></div>
      <section className="collection section-container" id="collection" aria-labelledby="collection-title">
        <div className="section-heading"><div><div className="eyebrow">ENCONTRÁ LO TUYO</div><h2 id="collection-title">Pequeños grandes favoritos<span>.</span></h2></div><span className="collection-count">{products.length} piezas, muchas posibilidades <ArrowDown size={15} /></span></div>
        <div className="collection-toolbar"><div className="category-filters" role="group" aria-label="Filtrar por categoría">{categories.map(item => <button key={item} className={`category-pill ${category === item ? "selected" : ""}`} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="search-field"><Search size={17} /><input type="search" placeholder="Buscá tu favorito" aria-label="Buscar productos" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
        {error ? <div className="empty-state" role="alert"><Package size={30} /><h3>La colección no pudo cargar.</h3><p>{error}</p><button className="button secondary" onClick={() => setRetry(value => value + 1)}>Volver a intentar</button></div> : loading ? <div className="product-grid" aria-label="Cargando productos" aria-busy="true">{Array.from({ length: 6 }, (_, index) => <div className="product-skeleton" key={index}><div /><span /><span /></div>)}</div> : filtered.length ? <div className="product-grid">{filtered.map((product, index) => <article className="product-card" key={product.id}><button className={`product-image-button tone-${index % 4}`} onClick={() => setSelected(product)} aria-label={`Ver ${product.name}`}><ProductImage src={product.imageUrl} alt={product.name} className="product-photo" /><span className="product-badge">{product.stock === 0 ? "Agotado" : product.stock < 5 ? "Últimas unidades" : product.category || `Selección ${templateConfig.name}`}</span><span className="product-view">Ver detalle <ArrowUpRight size={15} /></span></button><div className="product-meta"><div><span className="product-category">{product.category || "Esenciales"}</span><button className="product-name" onClick={() => setSelected(product)}>{product.name}</button><span className="product-price">{money(product.priceMinor, product.currency)}</span></div><button className="add-product" aria-label={`Añadir ${product.name} a la bolsa`} disabled={product.stock < 1 || !templateConfig.modules.orders} onClick={() => addProduct(product)}><Plus size={19} strokeWidth={1.5} /></button></div></article>)}</div> : <div className="empty-state"><Search size={30} /><h3>No encontramos ese favorito.</h3><p>Probá otra palabra o explorá todas las categorías.</p><button className="button secondary" onClick={() => { setQuery(""); setCategory("Todo"); }}>Ver toda la colección</button></div>}
        {hasMore ? <div className="load-more"><button className="button secondary" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "Cargando…" : "Cargar más productos"}<ArrowDown size={15} /></button><p>Explorando {products.length} productos de la colección.</p></div> : null}
      </section>
      <section className="philosophy section-container" id="philosophy"><div className="philosophy-mark">{templateConfig.name.slice(0, 1)}<span>®</span></div><div><div className="eyebrow">NUESTRA MIRADA</div><h2>No necesitás más.<br />Necesitás lo que va con vos.</h2><p>Creemos en elegir con calma. En lo simple que funciona y en esos detalles que hacen que algo cotidiano se sienta especial.</p><Link href="#collection" className="text-link">Explorá la selección <ArrowRight size={17} /></Link></div></section>
    </main>
    <StoreFooter />
    <div className={`cart-toast ${notice ? "visible" : ""}`} role="status" aria-live="polite">{notice ? <><span><Check size={17} />{notice}</span><Link href="/cart">Ver bolsa <ChevronRight size={14} /></Link></> : null}</div>
    <Dialog.Root open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content product-dialog" {...dialogFocus}>{selected ? <><Dialog.Close className="dialog-close" aria-label="Cerrar detalle"><X size={19} /></Dialog.Close><div className="detail-image"><ProductImage src={selected.imageUrl} alt={selected.name} className="detail-photo" /></div><div className="detail-copy"><span className="eyebrow">{selected.category || `SELECCIÓN ${templateConfig.name}`}</span><Dialog.Title>{selected.name}</Dialog.Title><div className="detail-price">{money(selected.priceMinor, selected.currency)}</div><Dialog.Description>{selected.description || "Un esencial seleccionado para acompañarte todos los días."}</Dialog.Description><div className="detail-stock"><span className={`status-dot ${!selected.stock ? "muted" : ""}`} />{selected.stock > 0 ? `${selected.stock} disponibles` : "Temporalmente agotado"}</div><button className="button primary full-width" disabled={selected.stock < 1 || !templateConfig.modules.orders} onClick={() => addProduct(selected)}>{!templateConfig.modules.orders ? "Pedidos no disponibles" : selected.stock > 0 ? "Añadir a mi bolsa" : "Agotado"}<Plus size={18} /></button><Link href="/cart" className="text-link">Ir a mi bolsa <ArrowRight size={16} /></Link><p className="detail-note"><ShieldCheck size={15} /> Pago y entrega a coordinar al confirmar el pedido.</p></div></> : null}</Dialog.Content></Dialog.Portal></Dialog.Root>
  </>;
}
