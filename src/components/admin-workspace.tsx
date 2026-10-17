"use client";

import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, ArrowUpRight, Bot, Check, ChevronRight, CircleHelp, Copy, ExternalLink, Layers3, LayoutDashboard, Package, Plus, RefreshCw, Search, Settings2, ShieldCheck, ShoppingBag, SlidersHorizontal, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { localeDefinition } from "@/i18n/config";
import { LocaleLink } from "@/i18n/link";
import { useErrorMessage, useFormat, useLocale, useT } from "@/i18n/provider";
import { brandDescription, defaultCurrency, enabledLocales, productCurrencies } from "@/i18n/runtime";
import { LocaleSwitcher } from "@/i18n/switcher";
import { AdminRuntimeSettings } from "@/runtime/components";
import { templateConfig } from "@/template.config";
import type { Dashboard } from "@/core/contracts";
import { currencyFactor, type Order, type Product, type Session } from "./types";
import { ProductImage } from "./product-image";
import { useDialogFocus } from "./use-dialog-focus";

type View = "overview" | "products" | "orders" | "agents" | "settings";
const navigation = [{ id: "overview", icon: LayoutDashboard }, { id: "products", icon: Package }, { id: "orders", icon: ShoppingBag }, { id: "agents", icon: Bot }, { id: "settings", icon: Settings2 }] as const;

/** A failed request is kept (not its text) so the message is produced in the active language when it is rendered. */
type Failure = { cause: unknown; fallback: "refresh" | "generic" };

/** Label for a backend code (role, order status, module). Codes without a message are shown as they are. */
function useCodeLabel(group: "roles" | "orderStatus" | "moduleNames") {
  const t = useT("admin");
  return (code: string) => {
    const key = `${group}.${code}`;
    return /^[a-z][A-Za-z0-9]*$/.test(code) && t.has(key) ? t(key as never) : code;
  };
}

export function AdminWorkspace() {
  const t = useT("admin");
  const locale = useLocale();
  const { number } = useFormat();
  const errorMessage = useErrorMessage();
  const roleName = useCodeLabel("roles");
  const [view, setView] = useState<View>("overview");
  const [session, setSession] = useState<Session | null>(null);
  const [sessionFailure, setSessionFailure] = useState<{ cause: unknown } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [moreProducts, setMoreProducts] = useState(false);
  const [moreOrders, setMoreOrders] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const canManage = session?.role === "owner" || session?.role === "admin";
  const error = failure ? errorMessage(failure.cause, failure.fallback === "refresh" ? t("shell.errors.refresh") : undefined) : "";
  const sessionError = sessionFailure ? errorMessage(sessionFailure.cause, t("shell.errors.signIn")) : "";
  // The demo server answers with a fixed display name; the label comes from the messages so it follows the language.
  const displayName = session ? (session.demo ? t("shell.profile.demoName") : session.user.name) : "";

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [catalog, sales, summary] = await Promise.all([templateConfig.modules.catalog ? api<{ products: Product[] }>("/api/admin/products?limit=100&offset=0") : Promise.resolve({ products: [] }), templateConfig.modules.orders ? api<{ orders: Order[] }>("/api/admin/orders?limit=100&offset=0") : Promise.resolve({ orders: [] }), api<Dashboard>("/api/admin/dashboard")]);
      setProducts(catalog.products); setOrders(sales.orders); setMoreProducts(catalog.products.length === 100); setMoreOrders(sales.orders.length === 100); setDashboard(summary); setFailure(null);
    } catch (err) { setFailure({ cause: err, fallback: "refresh" }); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => {
    let active = true;
    api<Session>("/api/session").then(async data => { if (active) { setSession(data); await refresh(); } }).catch(err => { if (active) setSessionFailure({ cause: err }); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(timer); }, [notice]);

  async function loadMore(kind: "products" | "orders") {
    if (loadingMore) return; setLoadingMore(true);
    try {
      if (kind === "products") { const data = await api<{ products: Product[] }>(`/api/admin/products?limit=100&offset=${products.length}`); setProducts(current => [...current, ...data.products.filter(item => !current.some(existing => existing.id === item.id))]); setMoreProducts(data.products.length === 100); }
      else { const data = await api<{ orders: Order[] }>(`/api/admin/orders?limit=100&offset=${orders.length}`); setOrders(current => [...current, ...data.orders.filter(item => !current.some(existing => existing.id === item.id))]); setMoreOrders(data.orders.length === 100); }
    } catch (err) { setFailure({ cause: err, fallback: "generic" }); } finally { setLoadingMore(false); }
  }
  return <div className="admin-shell"><aside className="admin-sidebar"><LocaleLink href="/" className="wordmark">{templateConfig.name}<span>®</span></LocaleLink><div className="workspace-picker"><span className="workspace-monogram">{templateConfig.name.slice(0, 1)}</span><div><strong>{session?.tenant.name || templateConfig.name}</strong><span>{t("shell.storeKind")}</span></div><Layers3 size={15} /></div><span className="nav-section-label">{t("shell.workspaceLabel")}</span><nav aria-label={t("shell.navLabel")}>{navigation.filter(item => item.id !== "products" || templateConfig.modules.catalog).filter(item => item.id !== "orders" || templateConfig.modules.orders).filter(item => item.id !== "agents" || templateConfig.modules.mcp).map(item => <button key={item.id} className={`admin-nav-item ${view === item.id ? "active" : ""}`} aria-current={view === item.id ? "page" : undefined} onClick={() => { setView(item.id); setFailure(null); }}><item.icon size={18} strokeWidth={1.7} />{t(`nav.${item.id}`)}{item.id === "agents" ? <span className="new-label">{t("shell.mcpBadge")}</span> : null}</button>)}</nav><div className="sidebar-bottom">{templateConfig.modules.mcp ? <div className="sidebar-agent-card"><span><Bot size={19} /> {t("shell.agentCard.title")}</span><p>{t("shell.agentCard.body")}</p><button onClick={() => setView("agents")}>{t("shell.agentCard.action")} <ArrowRight size={14} /></button></div> : null}<LocaleLink href="/" className="admin-store-link">{t("shell.visitStore")} <ExternalLink size={15} /></LocaleLink><div className="admin-profile"><span>{displayName.slice(0, 1).toLocaleUpperCase(locale) || "N"}</span><div><strong>{displayName || t("shell.profile.fallbackName")}</strong><small>{session ? roleName(session.role) : t("shell.profile.fallbackRole")}</small></div><ShieldCheck size={16} /></div></div></aside><div className="admin-main"><header className="admin-topbar"><div>{t("shell.breadcrumbRoot")} <ChevronRight size={14} /><strong>{t(`nav.${view}`)}</strong></div><div><span className="connection-indicator"><span className="status-dot" />{session?.demo ? t("shell.connection.demo") : t("shell.connection.workspace")}</span><LocaleSwitcher /><LocaleLink href="/" className="button secondary small">{t("shell.viewStore")} <ArrowUpRight size={14} /></LocaleLink></div></header><main id="main-content" className="admin-content">{session?.demo ? <div className="admin-demo-banner"><CircleHelp size={16} /><span>{t("shell.demoBanner")}</span></div> : null}<div className="admin-page-heading"><div><div className="eyebrow">{t(`views.${view}.eyebrow`)}</div><h1>{t(`views.${view}.title`)}</h1><p>{t(`views.${view}.description`)}</p></div>{session ? <button className="icon-button refresh-button" aria-label={t("shell.refresh")} title={t("shell.refresh")} disabled={refreshing} onClick={refresh}><RefreshCw size={18} className={refreshing ? "spin" : ""} /></button> : null}</div>{loading ? <div className="admin-loading" role="status"><span className="loading-ring" />{t("shell.loading")}</div> : sessionFailure ? <div className="empty-state"><ShieldCheck size={34} /><h2>{t("shell.signInPrompt.title")}</h2><p>{sessionError}</p><LocaleLink href="/sign-in" className="button primary">{t("shell.signInPrompt.action")} <ArrowRight size={16} /></LocaleLink></div> : <>{failure ? <div className="form-error" role="alert">{error}<button className="text-link" onClick={refresh}>{t("shell.retry")}</button></div> : null}{view === "overview" ? <Overview dashboard={dashboard} products={products} orders={orders} onView={setView} onNew={() => setEditing("new")} canManage={canManage && templateConfig.modules.catalog} /> : null}{view === "products" ? <Products products={products} canManage={canManage} onEdit={setEditing} onStock={setStockProduct} /> : null}{view === "orders" ? <Orders orders={orders} canManage={canManage} onChange={async () => { await refresh(); setNotice(t("shell.notices.orderUpdated")); }} /> : null}{view === "agents" ? templateConfig.modules.mcp ? <AgentConnection demo={session?.demo || false} /> : <div className="empty-state"><Bot size={30} /><h2>{t("shell.agentsDisabled.title")}</h2><p>{t("shell.agentsDisabled.body")}</p></div> : null}{view === "settings" ? <>{canManage ? <div className="runtime-settings-section"><AdminRuntimeSettings key={session?.tenant.id} /></div> : null}<Settings /></> : null}{(view === "products" && moreProducts) || (view === "orders" && moreOrders) ? <div className="load-more"><button className="button secondary" disabled={loadingMore} onClick={() => loadMore(view as "products" | "orders")}>{loadingMore ? t("shell.loadMore.loading") : t("shell.loadMore.action")}<ArrowRight size={15} /></button><p>{t("shell.loadMore.status", { count: number(view === "products" ? products.length : orders.length) })}</p></div> : null}</>}</main><footer className="admin-footer"><span>{t("shell.footer.tagline", { brand: templateConfig.name })}</span><span><ShieldCheck size={12} /> {t("shell.footer.access")}</span></footer></div><div className={`cart-toast ${notice ? "visible" : ""}`} role="status">{notice ? <span><Check size={17} />{notice}</span> : null}</div><ProductEditor product={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh(); setNotice(t("shell.notices.productSaved")); }} /><StockEditor product={stockProduct} onClose={() => setStockProduct(null)} onSaved={async () => { setStockProduct(null); await refresh(); setNotice(t("shell.notices.inventoryUpdated")); }} /></div>;
}

function Overview({ dashboard, products, orders, onView, onNew, canManage }: { dashboard: Dashboard | null; products: Product[]; orders: Order[]; onView: (view: View) => void; onNew: () => void; canManage: boolean }) {
  const t = useT("admin");
  const { money, number, dateTime } = useFormat();
  const statusLabel = useCodeLabel("orderStatus");
  const pending = orders.filter(order => order.status === "pending").length;
  const lowStock = products.filter(product => product.active && product.stock < 5);
  return <><div className="metric-grid"><Metric label={t("overview.metrics.orders.label")} value={number(dashboard?.orderCount || 0)} note={t("overview.metrics.orders.note", { count: pending })} icon={<ShoppingBag size={19} />} /><Metric label={t("overview.metrics.revenue.label")} value={dashboard?.revenueByCurrency.length ? dashboard.revenueByCurrency.map(item => money(item.totalMinor, item.currency)).join(" / ") : money(0, defaultCurrency)} note={t("overview.metrics.revenue.note")} icon={<ArrowUpRight size={19} />} /><Metric label={t("overview.metrics.collection.label")} value={number(dashboard?.activeProductCount || 0)} note={t("overview.metrics.collection.note", { count: dashboard?.productCount || 0 })} icon={<Package size={19} />} /><Metric label={t("overview.metrics.stock.label")} value={number(dashboard?.lowStockCount || 0)} note={t("overview.metrics.stock.note")} icon={<Layers3 size={19} />} /></div><div className="overview-columns"><section className="panel recent-orders"><div className="panel-heading"><div><h2>{t("overview.recent.title")}</h2><p>{t("overview.recent.subtitle")}</p></div><button className="text-link" onClick={() => onView("orders")}>{t("overview.recent.viewAll")} <ArrowRight size={15} /></button></div>{orders.length ? <div className="table-scroll"><table><thead><tr><th>{t("overview.recent.columns.order")}</th><th>{t("overview.recent.columns.date")}</th><th>{t("overview.recent.columns.status")}</th><th className="align-right">{t("overview.recent.columns.total")}</th></tr></thead><tbody>{orders.slice(0, 5).map(order => <tr key={order.id}><td><strong>#{order.id.slice(-8)}</strong><small>{t("overview.recent.items", { count: order.items.reduce((sum, item) => sum + item.quantity, 0) })}</small></td><td>{dateTime(order.createdAt)}</td><td><span className={`status-pill ${order.status}`}>{statusLabel(order.status)}</span></td><td className="align-right">{money(order.totalMinor, order.currency)}</td></tr>)}</tbody></table></div> : <div className="panel-empty"><ShoppingBag size={29} strokeWidth={1.2} /><h3>{t("overview.recent.empty.title")}</h3><p>{t("overview.recent.empty.body")}</p><LocaleLink href="/" className="text-link">{t("overview.recent.empty.action")} <ArrowRight size={15} /></LocaleLink></div>}</section><section className="agent-promo"><div className="agent-orb"><Bot size={29} strokeWidth={1.3} /></div><span className="eyebrow">{t("overview.agentPromo.eyebrow")}</span><h2>{t("overview.agentPromo.titleLine1")}<br />{t("overview.agentPromo.titleLine2")}</h2><p>{t("overview.agentPromo.quote")}<br />{t("overview.agentPromo.help")}</p><button className="button secondary" onClick={() => onView("agents")}>{t("overview.agentPromo.action")} <ArrowUpRight size={16} /></button><span className="agent-compatible">{t("overview.agentPromo.compatible")}</span></section></div><div className="overview-columns lower"><section className="panel"><div className="panel-heading"><div><h2>{t("overview.lowStock.title")}</h2><p>{t("overview.lowStock.subtitle")}</p></div><span className="count-badge">{lowStock.length}</span></div>{lowStock.length ? <div className="low-stock-list">{lowStock.slice(0, 4).map(product => <div className="low-stock-item" key={product.id}><ProductImage src={product.imageUrl} alt={product.name} className="mini-product" /><div><strong>{product.name}</strong><span>{product.sku}</span></div><span className={`stock-pill ${product.stock === 0 ? "out" : ""}`}>{t("units", { count: product.stock })}</span></div>)}</div> : <div className="panel-empty compact"><Check size={24} /><p>{t("overview.lowStock.empty")}</p></div>}<button className="panel-bottom-link" onClick={() => onView("products")}>{t("overview.lowStock.review")} <ArrowRight size={15} /></button></section><section className="panel quick-actions"><div className="panel-heading"><div><h2>{t("overview.quickActions.title")}</h2><p>{t("overview.quickActions.subtitle")}</p></div></div>{canManage ? <button onClick={onNew}><span className="quick-action-icon"><Plus size={18} /></span><div><strong>{t("overview.quickActions.addProduct.title")}</strong><span>{t("overview.quickActions.addProduct.body")}</span></div><ChevronRight size={17} /></button> : null}<button onClick={() => onView("settings")}><span className="quick-action-icon"><SlidersHorizontal size={18} /></span><div><strong>{t("overview.quickActions.brand.title")}</strong><span>{t("overview.quickActions.brand.body")}</span></div><ChevronRight size={17} /></button><LocaleLink href="/"><span className="quick-action-icon"><ExternalLink size={18} /></span><div><strong>{t("overview.quickActions.store.title")}</strong><span>{t("overview.quickActions.store.body")}</span></div><ChevronRight size={17} /></LocaleLink></section></div></>;
}

function Metric({ label, value, note, icon }: { label: string; value: string; note: string; icon: React.ReactNode }) { return <div className="metric-card"><div><span>{label}</span>{icon}</div><strong>{value}</strong><p>{note}</p></div>; }

function Products({ products, canManage, onEdit, onStock }: { products: Product[]; canManage: boolean; onEdit: (product: Product | "new") => void; onStock: (product: Product) => void }) {
  const t = useT("admin");
  const locale = useLocale();
  const { money } = useFormat();
  const [query, setQuery] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const filtered = products.filter(product => `${product.name} ${product.sku} ${product.category}`.toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)) && (!onlyLow || product.stock < 5));
  return <section className="panel"><div className="table-toolbar"><label className="search-field"><Search size={17} /><input type="search" aria-label={t("products.search.label")} placeholder={t("products.search.placeholder")} value={query} onChange={event => setQuery(event.target.value)} /></label><div><button className={`button secondary small ${onlyLow ? "selected-filter" : ""}`} aria-pressed={onlyLow} onClick={() => setOnlyLow(value => !value)}><SlidersHorizontal size={15} /> {t("products.lowStock")}</button>{canManage && templateConfig.modules.catalog ? <button className="button primary small" onClick={() => onEdit("new")}><Plus size={16} /> {t("products.newProduct")}</button> : null}</div></div>{filtered.length ? <div className="table-scroll"><table className="products-table"><thead><tr><th>{t("products.columns.product")}</th><th>{t("products.columns.price")}</th><th>{t("products.columns.inventory")}</th><th>{t("products.columns.status")}</th>{canManage ? <th className="align-right">{t("products.columns.actions")}</th> : null}</tr></thead><tbody>{filtered.map(product => <tr key={product.id}><td><div className="table-product"><ProductImage src={product.imageUrl} alt={product.name} className="mini-product" /><div><strong>{product.name}</strong><small>{product.sku} · {product.category}</small></div></div></td><td>{money(product.priceMinor, product.currency)}</td><td><span className={`stock-pill ${product.stock < 1 ? "out" : product.stock >= 5 ? "healthy" : ""}`}>{t("units", { count: product.stock })}</span></td><td><span className={`status-pill ${product.active ? "completed" : "cancelled"}`}>{product.active ? t("products.status.published") : t("products.status.hidden")}</span></td>{canManage ? <td><div className="row-actions">{templateConfig.modules.inventory ? <button onClick={() => onStock(product)}>{t("products.actions.stock")}</button> : null}<button onClick={() => onEdit(product)}>{t("products.actions.edit")}</button></div></td> : null}</tr>)}</tbody></table></div> : <div className="panel-empty"><Package size={32} /><h3>{t("products.empty.title")}</h3><p>{t("products.empty.body")}</p></div>}<div className="table-footer">{t("products.footer", { shown: filtered.length, count: products.length })}</div></section>;
}

function Orders({ orders, canManage, onChange }: { orders: Order[]; canManage: boolean; onChange: () => Promise<void> }) {
  const t = useT("admin");
  const { money, dateTime } = useFormat();
  const errorMessage = useErrorMessage();
  const statusLabel = useCodeLabel("orderStatus");
  const [filter, setFilter] = useState("all");
  const dialogFocus = useDialogFocus();
  const [selected, setSelected] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null);
  const filtered = orders.filter(order => filter === "all" || order.status === filter);
  const filters = [{ id: "all", label: t("orders.filters.all") }, { id: "pending", label: t("orders.filters.pending") }, { id: "completed", label: t("orders.filters.completed") }, { id: "cancelled", label: t("orders.filters.cancelled") }];
  async function update(status: "completed" | "cancelled") {
    if (!selected || busy) return;
    const question = status === "completed" ? t("orders.detail.confirmCompleted") : t("orders.detail.confirmCancelled");
    if (!window.confirm(question)) return;
    setBusy(true); setFailure(null);
    try { await api(`/api/admin/orders/${encodeURIComponent(selected.id)}`, { method: "PATCH", body: JSON.stringify({ status }) }); setSelected(null); await onChange(); }
    catch (err) { setFailure({ cause: err }); }
    finally { setBusy(false); }
  }
  return <><section className="panel"><div className="table-toolbar"><div className="category-filters">{filters.map(item => <button key={item.id} className={`category-pill ${filter === item.id ? "selected" : ""}`} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div><span className="muted-text">{t("orders.count", { count: filtered.length })}</span></div>{filtered.length ? <div className="table-scroll"><table><thead><tr><th>{t("orders.columns.order")}</th><th>{t("orders.columns.date")}</th><th>{t("orders.columns.items")}</th><th>{t("orders.columns.status")}</th><th>{t("orders.columns.total")}</th><th /></tr></thead><tbody>{filtered.map(order => <tr key={order.id}><td><strong>#{order.id.slice(-8)}</strong></td><td>{dateTime(order.createdAt)}</td><td>{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td><td><span className={`status-pill ${order.status}`}>{statusLabel(order.status)}</span></td><td>{money(order.totalMinor, order.currency)}</td><td><button className="text-link" onClick={() => { setSelected(order); setFailure(null); }}>{t("orders.view")} <ChevronRight size={14} /></button></td></tr>)}</tbody></table></div> : <div className="panel-empty"><ShoppingBag size={34} /><h3>{t("orders.empty.title")}</h3><p>{t("orders.empty.body")}</p></div>}</section><Dialog.Root open={!!selected} onOpenChange={open => { if (!open && !busy) setSelected(null); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content form-dialog" {...dialogFocus}><Dialog.Close className="dialog-close" aria-label={t("orders.detail.close")} disabled={busy}><X size={19} /></Dialog.Close><span className="eyebrow">{t("orders.detail.eyebrow")}</span><Dialog.Title>#{selected?.id.slice(-8)}</Dialog.Title><Dialog.Description>{selected ? t("orders.detail.summary", { date: dateTime(selected.createdAt), status: statusLabel(selected.status) }) : ""}</Dialog.Description>{selected ? <><div className="order-lines">{selected.items.map(item => <div key={item.productId}><span>{t("orders.detail.line", { quantity: item.quantity, name: item.name })}</span><strong>{money(item.totalMinor, selected.currency)}</strong></div>)}<div className="order-total"><span>{t("orders.detail.total")}</span><strong>{money(selected.totalMinor, selected.currency)}</strong></div></div>{selected.customer ? <div className="customer-card"><h3>{t("orders.detail.customer")}</h3><strong>{selected.customer.name}</strong><a href={`mailto:${selected.customer.email}`}>{selected.customer.email}</a>{selected.customer.phone ? <span>{selected.customer.phone}</span> : null}{selected.customer.address ? <span>{selected.customer.address}</span> : null}</div> : null}<p className="muted-text">{t("orders.detail.reference")} <code>{selected.id}</code></p>{selected.paymentProvider ? <div className="payment-managed"><ShieldCheck size={19} /><div><strong>{t("orders.detail.paymentManaged.title", { provider: selected.paymentProvider === "stripe" ? "Stripe" : selected.paymentProvider })}</strong><p>{t("orders.detail.paymentManaged.body")}</p></div></div> : null}{failure ? <div className="form-error" role="alert">{errorMessage(failure.cause, t("orders.detail.updateFailed"))}</div> : null}{selected.status === "pending" && canManage && !selected.paymentProvider ? <div className="form-actions"><button className="button secondary danger-text" disabled={busy} onClick={() => update("cancelled")}>{t("orders.detail.cancel")}</button><button className="button primary" disabled={busy} onClick={() => update("completed")}>{busy ? t("orders.detail.saving") : t("orders.detail.confirm")}</button></div> : null}</> : null}</Dialog.Content></Dialog.Portal></Dialog.Root></>;
}

function AgentConnection({ demo }: { demo: boolean }) {
  const t = useT("admin");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  async function copy() { try { await navigator.clipboard.writeText(`${origin}/api/mcp`); setCopied(true); setCopyFailed(false); } catch { setCopyFailed(true); } }
  return <><section className="connection-hero panel"><span className="connection-logo"><Bot size={35} strokeWidth={1.3} /></span><div><span className="eyebrow">{t("agents.hero.eyebrow")}</span><h2>{t("agents.hero.title")}</h2><p>{t("agents.hero.body")}</p></div><span className="status-pill completed">{t("agents.hero.badge")}</span></section><div className="connections-access"><LocaleLink href="/onboarding/connections" className="button secondary small"><ShieldCheck size={15} /> {t("agents.manageConnections")} <ArrowUpRight size={14} /></LocaleLink></div><div className="connection-columns"><section className="panel connection-steps"><div className="panel-heading"><div><h2>{t("agents.steps.title")}</h2><p>{t("agents.steps.subtitle")}</p></div></div><ol><li><span>1</span><div><h3>{t("agents.steps.open.title")}</h3><p>{t("agents.steps.open.body")}</p></div></li><li><span>2</span><div><h3>{t("agents.steps.paste.title")}</h3><div className="endpoint-field"><code>{origin ? `${origin}/api/mcp` : t("agents.steps.paste.loading")}</code><button className="icon-button" onClick={copy} disabled={!origin} aria-label={t("agents.steps.paste.copy")}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>{copyFailed ? <p className="form-error" role="alert">{t("agents.steps.paste.copyFailed")}</p> : null}<p>{t("agents.steps.paste.note")}</p></div></li><li><span>3</span><div><h3>{t("agents.steps.authorize.title")}</h3><p>{t("agents.steps.authorize.body")}</p></div></li></ol>{demo ? <div className="connection-warning"><CircleHelp size={18} /><p>{t("agents.steps.demoWarning")}</p></div> : null}</section><section className="panel agent-examples"><div className="panel-heading"><div><h2>{t("agents.examples.title")}</h2><p>{t("agents.examples.subtitle")}</p></div></div><div className="example-message">{t("agents.examples.prompts.lowStock")}</div><div className="example-message">{t("agents.examples.prompts.pendingOrders")}</div><div className="example-message">{t("agents.examples.prompts.addStock")}</div><div className="agent-permissions"><ShieldCheck size={20} /><h3>{t("agents.examples.control.title")}</h3><p>{t("agents.examples.control.body")}</p></div></section></div></>;
}

function Settings() {
  const t = useT("admin");
  const locale = useLocale();
  const moduleName = useCodeLabel("moduleNames");
  const nativeName = (code: string) => localeDefinition(code)?.nativeName ?? code;
  return <div className="settings-grid"><section className="panel settings-panel"><div className="panel-heading"><div><h2>{t("settings.identity.title")}</h2><p>{t("settings.identity.subtitle")}</p></div><span className="status-pill">{t("settings.identity.readOnly")}</span></div><dl className="settings-list"><div><dt>{t("settings.identity.brandName")}</dt><dd>{templateConfig.name}</dd></div><div><dt>{t("settings.identity.description")}</dt><dd>{brandDescription(locale)}</dd></div><div><dt>{t("settings.identity.defaultCurrency")}</dt><dd>{defaultCurrency}</dd></div><div><dt>{t("settings.identity.language")}</dt><dd>{nativeName(locale)}</dd></div><div><dt>{t("settings.identity.availableLanguages")}</dt><dd>{new Intl.ListFormat(locale, { style: "short", type: "unit" }).format(enabledLocales.map(nativeName))}</dd></div><div><dt>{t("settings.identity.payment.label")}</dt><dd>{t("settings.identity.payment.value")}</dd></div></dl><div className="settings-help"><SlidersHorizontal size={20} /><p>{t("settings.identity.helpBefore")} <code>template.config.ts</code> {t("settings.identity.helpAfter")}</p></div></section><section className="panel settings-panel"><div className="panel-heading"><div><h2>{t("settings.modules.title")}</h2><p>{t("settings.modules.subtitle")}</p></div></div><div className="module-list">{Object.entries(templateConfig.modules).map(([key, enabled]) => <div key={key}><span>{moduleName(key)}</span><span className={`status-pill ${enabled ? "completed" : "cancelled"}`}>{enabled ? t("settings.modules.active") : t("settings.modules.off")}</span></div>)}</div><div className="settings-help"><ShieldCheck size={20} /><p>{t("settings.modules.help")}</p></div></section></div>;
}

function ProductEditor({ product, onClose, onSaved }: { product: Product | "new" | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const t = useT("admin");
  const dialogFocus = useDialogFocus();
  return <Dialog.Root open={product !== null} onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content form-dialog" {...dialogFocus}><Dialog.Close className="dialog-close" aria-label={t("editor.close")}><X size={19} /></Dialog.Close><span className="eyebrow">{t("editor.eyebrow")}</span><Dialog.Title>{product === "new" ? t("editor.newTitle") : t("editor.editTitle")}</Dialog.Title><Dialog.Description>{product === "new" ? t("editor.newBody") : t("editor.editBody")}</Dialog.Description>{product ? <ProductForm key={typeof product === "string" ? "new" : `${product.id}:${product.version}`} product={product} onSaved={onSaved} /> : null}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function ProductForm({ product, onSaved }: { product: Product | "new"; onSaved: () => Promise<void> }) {
  const t = useT("admin");
  const errorMessage = useErrorMessage();
  const current = product === "new" ? null : product;
  const [values, setValues] = useState({ name: current?.name || "", sku: current?.sku || "", description: current?.description || "", category: current?.category || "", price: current ? String(current.priceMinor / currencyFactor(current.currency)) : "", currency: current?.currency || defaultCurrency, stock: current ? String(current.stock) : "0", imageUrl: current?.imageUrl || "", active: current?.active ?? true });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null);
  // A product saved in a currency that is no longer configured keeps showing (and keeping) its own currency.
  const currencies = current && !productCurrencies.includes(current.currency) ? [current.currency, ...productCurrencies] : productCurrencies;
  const field = (key: keyof typeof values, value: string | boolean) => setValues(previous => ({ ...previous, [key]: value }));
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setFailure(null);
    try {
      const input = { sku: values.sku.trim(), name: values.name.trim(), description: values.description.trim(), category: values.category.trim(), priceMinor: Math.round(Number(values.price) * currencyFactor(values.currency)), currency: values.currency.toUpperCase(), imageUrl: values.imageUrl || null, active: values.active, ...(current ? { version: current.version } : { stock: Number(values.stock) }) };
      await api(current ? `/api/admin/products/${encodeURIComponent(current.id)}` : "/api/admin/products", { method: current ? "PATCH" : "POST", body: JSON.stringify(input) });
      await onSaved();
    } catch (err) { setFailure({ cause: err }); }
    finally { setBusy(false); }
  }
  return <form className="product-form" onSubmit={save}><label className="field">{t("editor.fields.name")}<input required maxLength={160} value={values.name} onChange={event => field("name", event.target.value)} placeholder={t("editor.fields.namePlaceholder")} /></label><div className="field-row"><label className="field">{t("editor.fields.sku")}<input required maxLength={64} value={values.sku} onChange={event => field("sku", event.target.value)} placeholder="NOMA-001" /></label><label className="field">{t("editor.fields.category")}<input maxLength={80} value={values.category} onChange={event => field("category", event.target.value)} placeholder={t("editor.fields.categoryPlaceholder")} /></label></div><label className="field">{t("editor.fields.description")}<textarea rows={3} maxLength={2000} value={values.description} onChange={event => field("description", event.target.value)} placeholder={t("editor.fields.descriptionPlaceholder")} /></label><div className="field-row"><label className="field">{t("editor.fields.price")}<input type="number" required min="0" max="9999999" step={1 / currencyFactor(values.currency)} inputMode="decimal" value={values.price} onChange={event => field("price", event.target.value)} /></label><label className="field">{t("editor.fields.currency")}<select value={values.currency} onChange={event => field("currency", event.target.value)}>{currencies.map(currency => <option value={currency} key={currency}>{currency}</option>)}</select></label>{!current ? <label className="field">{t("editor.fields.initialStock")}<input type="number" min="0" max="1000000" step="1" required value={values.stock} onChange={event => field("stock", event.target.value)} /></label> : null}</div><label className="field">{t("editor.fields.imageUrl")}<input type="url" maxLength={2000} value={values.imageUrl} onChange={event => field("imageUrl", event.target.value)} placeholder="https://…" /></label><label className="checkbox-field"><input type="checkbox" checked={values.active} onChange={event => field("active", event.target.checked)} /><span>{t("editor.fields.published")}</span></label>{failure ? <p className="form-error" role="alert">{errorMessage(failure.cause, t("editor.saveFailed"))}</p> : null}<div className="form-actions"><button className="button primary" type="submit" disabled={busy}>{busy ? t("editor.saving") : current ? t("editor.save") : t("editor.create")}<Check size={16} /></button></div></form>;
}

function StockEditor({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const t = useT("admin");
  const dialogFocus = useDialogFocus();
  return <Dialog.Root open={!!product} onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content form-dialog" {...dialogFocus}><Dialog.Close className="dialog-close" aria-label={t("stock.close")}><X size={19} /></Dialog.Close><span className="eyebrow">{t("stock.eyebrow")}</span><Dialog.Title>{t("stock.title")}</Dialog.Title><Dialog.Description>{product ? t("stock.current", { name: product.name, count: product.stock }) : null}</Dialog.Description>{product ? <StockForm key={`${product.id}:${product.version}`} product={product} onSaved={onSaved} /> : null}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function StockForm({ product, onSaved }: { product: Product; onSaved: () => Promise<void> }) {
  const t = useT("admin");
  const errorMessage = useErrorMessage();
  const [delta, setDelta] = useState("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || Number(delta) === 0) return; setBusy(true); setFailure(null);
    try { await api("/api/admin/inventory", { method: "POST", body: JSON.stringify({ productId: product.id, delta: Number(delta), reason: reason.trim(), version: product.version, idempotencyKey }) }); await onSaved(); }
    catch (err) { setFailure({ cause: err }); }
    finally { setBusy(false); }
  }
  return <form className="product-form" onSubmit={save}><label className="field">{t("stock.fields.delta")}<input type="number" step="1" min={-product.stock} max="1000000" required value={delta} onChange={event => setDelta(event.target.value)} /><small>{t("stock.fields.deltaHint")}</small></label><label className="field">{t("stock.fields.reason")}<input required minLength={3} maxLength={200} value={reason} onChange={event => setReason(event.target.value)} placeholder={t("stock.fields.reasonPlaceholder")} /></label><div className="stock-preview"><span>{t("stock.fields.preview")}</span><strong>{t("units", { count: product.stock + Number(delta || 0) })}</strong></div>{failure ? <p className="form-error" role="alert">{errorMessage(failure.cause, t("stock.updateFailed"))}</p> : null}<div className="form-actions"><button className="button primary" type="submit" disabled={busy || Number(delta) === 0 || product.stock + Number(delta) < 0}>{busy ? t("stock.saving") : t("stock.save")}<Check size={16} /></button></div></form>;
}
