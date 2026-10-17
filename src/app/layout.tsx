import type { Metadata } from "next";
import { CartProvider } from "@/components/cart-provider";
import { templateConfig } from "@/template.config";
import "./globals.css";

export const metadata: Metadata = { title: { default: `${templateConfig.name} — Objetos con intención`, template: `%s | ${templateConfig.name}` }, description: templateConfig.description };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es" data-scroll-behavior="smooth"><body><a className="skip-link" href="#main-content">Saltar al contenido</a><CartProvider>{children}</CartProvider></body></html>;
}
