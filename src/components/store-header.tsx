"use client";

import Link from "next/link";
import { ArrowUpRight, ShoppingBag } from "lucide-react";
import { useCart } from "./cart-provider";
import { templateConfig } from "@/template.config";

export function StoreHeader() {
  const { count } = useCart();
  return <>
    <div className="announcement">Objetos bien elegidos. Días mejor vividos. <span>Descubrí la colección <ArrowUpRight size={12} /></span></div>
    <header className="store-header">
      <Link href="/" className="wordmark" aria-label={`${templateConfig.name}, inicio`}>{templateConfig.name}<span>®</span></Link>
      <nav aria-label="Navegación principal" className="store-nav"><Link href="/#collection">Colección</Link><Link href="/#philosophy">Nuestra mirada</Link></nav>
      <div className="header-actions"><Link href="/admin" className="manage-link">Administrar <ArrowUpRight size={13} /></Link><Link href="/cart" className="cart-link" aria-label={`Carrito, ${count} artículos`}><ShoppingBag size={19} strokeWidth={1.6} /><span className="cart-label">Mi bolsa</span><span className="cart-count">{count}</span></Link></div>
    </header>
  </>;
}

export function StoreFooter() {
  return <footer className="store-footer"><div><Link href="/" className="wordmark">{templateConfig.name}<span>®</span></Link><p>Menos cosas. Más intención.</p></div><div className="footer-links"><Link href="/#collection">Explorar colección</Link><Link href="/cart">Mi bolsa</Link><Link href="/admin">Mi negocio <ArrowUpRight size={12} /></Link></div><span className="footer-caption">Una selección para tu día a día.</span></footer>;
}
