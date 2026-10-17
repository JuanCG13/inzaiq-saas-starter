"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Product } from "./types";

export interface CartItem { product: Product; quantity: number }
interface CartContextValue {
  items: CartItem[];
  count: number;
  ready: boolean;
  add: (product: Product, quantity?: number) => void;
  change: (id: string, quantity: number) => void;
  clear: () => void;
  settle: (submitted: Array<{ productId: string; quantity: number }>) => void;
  reconcile: (updates: Array<{ id: string; product: Product | null }>) => void;
}
const CartContext = createContext<CartContextValue | null>(null);
const storageKey = "commerce.cart.v1";
function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object" || !("product" in value) || !("quantity" in value)) return false;
  const item = value as CartItem;
  const product = item.product;
  return !!product && typeof product.id === "string" && product.id.length < 200 && typeof product.name === "string"
    && typeof product.sku === "string" && typeof product.category === "string" && typeof product.description === "string"
    && typeof product.currency === "string" && /^[A-Z]{3}$/.test(product.currency)
    && Number.isSafeInteger(product.priceMinor) && product.priceMinor >= 0 && Number.isSafeInteger(product.stock) && product.stock >= 0
    && (product.imageUrl === null || typeof product.imageUrl === "string") && typeof product.active === "boolean"
    && Number.isSafeInteger(product.version) && Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 99;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(saved)) setItems(saved.filter(isCartItem).slice(0, 100));
    } catch { /* A damaged or unavailable local cache is safe to discard. */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) {
      try { localStorage.setItem(storageKey, JSON.stringify(items)); } catch { /* Cart remains usable when browser storage is unavailable. */ }
    }
  }, [items, ready]);
  const add = useCallback((product: Product, quantity = 1) => {
    setItems(current => {
      const existing = current.find(item => item.product.id === product.id);
      const nextQuantity = Math.min(99, product.stock, (existing?.quantity || 0) + quantity);
      if (nextQuantity < 1) return current;
      if (existing) return current.map(item => item.product.id === product.id ? { product, quantity: nextQuantity } : item);
      return [...current, { product, quantity: nextQuantity }];
    });
  }, []);
  const change = useCallback((id: string, quantity: number) => setItems(current => quantity <= 0 ? current.filter(item => item.product.id !== id) : current.map(item => item.product.id === id ? { ...item, quantity: Math.min(99, item.product.stock, quantity) } : item)), []);
  const clear = useCallback(() => setItems([]), []);
  const settle = useCallback((submitted: Array<{ productId: string; quantity: number }>) => setItems(current => current.flatMap(item => {
    const purchased = submitted.find(candidate => candidate.productId === item.product.id)?.quantity || 0;
    return item.quantity > purchased ? [{ ...item, quantity: item.quantity - purchased }] : [];
  })), []);
  const reconcile = useCallback((updates: Array<{ id: string; product: Product | null }>) => setItems(current => current.flatMap(item => {
    const update = updates.find(candidate => candidate.id === item.product.id);
    if (!update) return [item];
    if (!update.product || !update.product.active || update.product.stock < 1) return [];
    return [{ product: update.product, quantity: Math.min(item.quantity, update.product.stock) }];
  })), []);
  return <CartContext.Provider value={{ items, count: items.reduce((sum, item) => sum + item.quantity, 0), ready, add, change, clear, settle, reconcile }}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("CartProvider is required");
  return context;
}
