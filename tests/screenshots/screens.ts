/**
 * Single source of truth for the documentation screenshots and the gallery pages.
 *
 * - tests/screenshots/tour.spec.ts walks these screens in one browser and writes one image per `id`.
 * - scripts/build-gallery.ts renders docs/screens.md and docs/screens.es.md from this list.
 * - tests/screens-manifest.test.ts checks the images and the generated pages without a server.
 *
 * The array order is the order inside each gallery section. The order in which the tour reaches the
 * screens is different (orders must exist before the admin shows them) and lives in the spec.
 * Keep this file free of Node and browser imports so all three consumers can load it.
 */

export type ScreenGroup = 'storefront' | 'bag' | 'admin' | 'account';
export type ViewportName = 'desktop' | 'mobile';
export type Language = 'en' | 'es';

export interface ScreenDefinition {
  /** Stable file name (without extension) and anchor of the gallery entry. */
  id: string;
  group: ScreenGroup;
  viewport: ViewportName;
  /** Page the screen belongs to, written without the language prefix; the gallery shows it as /en + route. */
  route: string;
  /** True only where the whole scrollable page is the point of the screen; the default is one viewport. */
  fullPage?: boolean;
  title: Record<Language, string>;
  description: Record<Language, string>;
}

export const VIEWPORTS: Record<ViewportName, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

/**
 * Image format chosen by measurement (see docs/screenshots/PROVENANCE.md). Chromium's own
 * Page.captureScreenshot encodes it, so no image library is a dependency of the repository.
 */
export const IMAGE = { format: 'webp', extension: 'webp', quality: 92, mime: 'image/webp' } as const;

/** Decimal bytes, deliberately strict: GitHub renders these files inline in READMEs and the gallery. */
export const MAX_IMAGE_BYTES = 110_000;
export const MAX_TOTAL_BYTES = 1_600_000;

export const GROUPS: Record<ScreenGroup, { title: Record<Language, string>; intro: Record<Language, string> }> = {
  storefront: {
    title: { en: 'Storefront', es: 'Tienda' },
    intro: {
      en: 'What a visitor sees before buying: the landing page, the collection, a product and the not-found page.',
      es: 'Lo que ve un visitante antes de comprar: la portada, la colección, un producto y la página de error 404.',
    },
  },
  bag: {
    title: { en: 'Bag and checkout', es: 'Bolsa y compra' },
    intro: {
      en: 'The path from an empty bag to a saved order. Orders are placed with the manual payment option, so nothing is charged.',
      es: 'El camino desde la bolsa vacía hasta un pedido guardado. Los pedidos usan el pago manual, así que no se cobra nada.',
    },
  },
  admin: {
    title: { en: 'Administration', es: 'Administración' },
    intro: {
      en: 'The business workspace: overview, catalog, inventory, orders, the agent connection guide and live settings.',
      es: 'El espacio del negocio: resumen, catálogo, inventario, pedidos, la guía de conexión del agente y los ajustes en vivo.',
    },
  },
  account: {
    title: { en: 'Account and agent access', es: 'Cuenta y acceso de agentes' },
    intro: {
      en: 'Sign-in, business creation and the OAuth consent that lets an assistant operate the business over MCP.',
      es: 'Inicio de sesión, creación del negocio y el consentimiento OAuth que permite a un asistente operar el negocio por MCP.',
    },
  },
};

export const screens = [
  {
    id: 'storefront-hero', group: 'storefront', viewport: 'desktop', route: '/',
    title: { en: 'Landing page', es: 'Portada' },
    description: {
      en: 'The first screen of the demo store: announcement bar, header with language selector and bag, and the hero with its call to action.',
      es: 'La primera pantalla de la tienda de demostración: barra de anuncio, encabezado con selector de idioma y bolsa, y la portada con su llamada a la acción.',
    },
  },
  {
    id: 'storefront-collection', group: 'storefront', viewport: 'desktop', route: '/#collection',
    title: { en: 'Collection', es: 'Colección' },
    description: {
      en: 'The product grid with category filters and search. Prices are formatted in the default currency and the images are the first-party SVG art in public/demo.',
      es: 'La cuadrícula de productos con filtros por categoría y búsqueda. Los precios usan la moneda predeterminada y las imágenes son el arte SVG propio de public/demo.',
    },
  },
  {
    id: 'storefront-product', group: 'storefront', viewport: 'desktop', route: '/#collection',
    title: { en: 'Product detail', es: 'Detalle de producto' },
    description: {
      en: 'The product dialog opened from the collection, with price, stock and the add-to-bag action.',
      es: 'El diálogo de producto abierto desde la colección, con precio, existencias y la acción para agregar a la bolsa.',
    },
  },
  {
    id: 'storefront-mobile', group: 'storefront', viewport: 'mobile', route: '/',
    title: { en: 'Storefront on a phone', es: 'Tienda en el teléfono' },
    description: {
      en: 'The same landing page at 390 px wide; the layout collapses to one column.',
      es: 'La misma portada con 390 px de ancho; el diseño pasa a una sola columna.',
    },
  },
  {
    id: 'not-found', group: 'storefront', viewport: 'desktop', route: '/this-page-does-not-exist',
    title: { en: 'Page not found', es: 'Página no encontrada' },
    description: {
      en: 'An unknown URL under a language prefix answers with a real HTTP 404 and this localized page.',
      es: 'Una URL desconocida bajo un prefijo de idioma responde con un HTTP 404 real y esta página traducida.',
    },
  },
  {
    id: 'bag-empty', group: 'bag', viewport: 'desktop', route: '/cart',
    title: { en: 'Empty bag', es: 'Bolsa vacía' },
    description: {
      en: 'What a first-time visitor sees at the bag before adding anything.',
      es: 'Lo que ve un visitante nuevo en la bolsa antes de agregar algo.',
    },
  },
  {
    id: 'bag-checkout', group: 'bag', viewport: 'desktop', route: '/cart',
    title: { en: 'Bag with items and checkout form', es: 'Bolsa con productos y formulario de compra' },
    description: {
      en: 'Three products (four items) in the bag and the customer form filled in with a fictional customer. The server recalculates the total when the order is placed.',
      es: 'Tres productos (cuatro artículos) en la bolsa y el formulario del cliente completado con un cliente ficticio. El servidor recalcula el total al registrar el pedido.',
    },
  },
  {
    id: 'order-received', group: 'bag', viewport: 'desktop', route: '/cart',
    title: { en: 'Order received', es: 'Pedido recibido' },
    description: {
      en: 'The confirmation after the real checkout request succeeded: reference, pending payment status and total.',
      es: 'La confirmación después de que la solicitud real de compra tuvo éxito: referencia, estado de pago pendiente y total.',
    },
  },
  {
    id: 'checkout-return', group: 'bag', viewport: 'desktop', route: '/checkout/return',
    title: { en: 'Return from payment', es: 'Regreso del pago' },
    description: {
      en: 'The page a customer lands on after a hosted payment, opened here with no pending attempt in the tab. Coming back never confirms a charge by itself.',
      es: 'La página a la que llega el cliente tras un pago alojado, abierta aquí sin intento pendiente en la pestaña. Volver nunca confirma un cobro por sí solo.',
    },
  },
  {
    id: 'admin-overview', group: 'admin', viewport: 'desktop', route: '/admin',
    title: { en: 'Overview', es: 'Resumen' },
    description: {
      en: 'Metrics, latest orders, products running low and quick actions for the demo business.',
      es: 'Métricas, últimos pedidos, productos con pocas existencias y acciones rápidas del negocio de demostración.',
    },
  },
  {
    id: 'admin-products', group: 'admin', viewport: 'desktop', route: '/admin',
    title: { en: 'Products', es: 'Productos' },
    description: {
      en: 'The catalog table with price, inventory and publication status, plus the edit and stock actions.',
      es: 'La tabla del catálogo con precio, inventario y estado de publicación, con las acciones de editar y de existencias.',
    },
  },
  {
    id: 'admin-product-editor', group: 'admin', viewport: 'desktop', route: '/admin',
    title: { en: 'Product editor', es: 'Editor de producto' },
    description: {
      en: 'The edit dialog of an existing product. The price is entered in major units and saved as integer minor units.',
      es: 'El diálogo de edición de un producto existente. El precio se escribe en unidades mayores y se guarda como unidades menores enteras.',
    },
  },
  {
    id: 'admin-stock', group: 'admin', viewport: 'desktop', route: '/admin',
    title: { en: 'Stock adjustment', es: 'Ajuste de existencias' },
    description: {
      en: 'The inventory dialog with a restock typed in. It previews the new quantity; every saved adjustment is audited with its reason.',
      es: 'El diálogo de inventario con una reposición escrita. Muestra la cantidad resultante; cada ajuste guardado queda auditado con su motivo.',
    },
  },
  {
    id: 'admin-orders', group: 'admin', viewport: 'desktop', route: '/admin',
    title: { en: 'Orders', es: 'Pedidos' },
    description: {
      en: 'Three orders placed through the storefront: one pending, one completed and one cancelled from the admin.',
      es: 'Tres pedidos hechos desde la tienda: uno pendiente, uno completado y uno cancelado desde la administración.',
    },
  },
  {
    id: 'admin-order-detail', group: 'admin', viewport: 'desktop', route: '/admin',
    title: { en: 'Order detail', es: 'Detalle de pedido' },
    description: {
      en: 'A pending order with its lines, the customer contact details and the actions to confirm payment or cancel.',
      es: 'Un pedido pendiente con sus líneas, los datos de contacto del cliente y las acciones para confirmar el pago o cancelar.',
    },
  },
  {
    id: 'admin-agents', group: 'admin', viewport: 'desktop', route: '/admin',
    title: { en: 'Agent connection guide', es: 'Guía de conexión del agente' },
    description: {
      en: 'Three steps to add the store as a remote MCP connection, with the endpoint to copy and example prompts.',
      es: 'Tres pasos para agregar la tienda como conexión MCP remota, con la dirección para copiar y mensajes de ejemplo.',
    },
  },
  {
    id: 'admin-settings', group: 'admin', viewport: 'desktop', route: '/admin',
    title: { en: 'Settings', es: 'Ajustes' },
    description: {
      en: 'The live operations card (business notice and pause or resume of new orders) above the read-only identity and module settings.',
      es: 'La tarjeta de operaciones en vivo (aviso del negocio y pausa o reanudación de pedidos) sobre los ajustes de identidad y módulos, de solo lectura.',
    },
  },
  {
    id: 'admin-mobile', group: 'admin', viewport: 'mobile', route: '/admin',
    title: { en: 'Administration on a phone', es: 'Administración en el teléfono' },
    description: {
      en: 'The overview at 390 px wide: the sidebar becomes a compact navigation bar.',
      es: 'El resumen con 390 px de ancho: la barra lateral se convierte en una barra de navegación compacta.',
    },
  },
  {
    id: 'sign-in', group: 'account', viewport: 'desktop', route: '/sign-in',
    title: { en: 'Sign in', es: 'Iniciar sesión' },
    description: {
      en: 'The sign-in page. It also receives the signed parameters of an OAuth authorization.',
      es: 'La página de inicio de sesión. También recibe los parámetros firmados de una autorización OAuth.',
    },
  },
  {
    id: 'create-account', group: 'account', viewport: 'desktop', route: '/sign-in',
    title: { en: 'Create account', es: 'Crear cuenta' },
    description: {
      en: 'The same page in account-creation mode with a fictional owner. Passwords need at least 12 characters.',
      es: 'La misma página en modo de creación de cuenta con un propietario ficticio. Las contraseñas necesitan al menos 12 caracteres.',
    },
  },
  {
    id: 'onboarding', group: 'account', viewport: 'desktop', route: '/onboarding',
    title: { en: 'Create a business', es: 'Crear un negocio' },
    description: {
      en: 'After sign-up the owner creates the business (organization) the agent connection will be limited to.',
      es: 'Tras registrarse, el propietario crea el negocio (organización) al que quedará limitada la conexión del agente.',
    },
  },
  {
    id: 'consent', group: 'account', viewport: 'desktop', route: '/consent',
    title: { en: 'OAuth consent', es: 'Consentimiento OAuth' },
    description: {
      en: 'A dynamically registered client asks for access using PKCE. The page only renders for genuinely signed parameters; write scopes start unchecked.',
      es: 'Un cliente registrado dinámicamente pide acceso con PKCE. La página solo se muestra con parámetros genuinamente firmados; los permisos de escritura empiezan sin marcar.',
    },
  },
  {
    id: 'connections', group: 'account', viewport: 'desktop', route: '/onboarding/connections',
    title: { en: 'Connected agents', es: 'Agentes conectados' },
    description: {
      en: 'The client authorized on the previous screen, with its granted scopes, a disconnect button and the MCP URL.',
      es: 'El cliente autorizado en la pantalla anterior, con sus permisos concedidos, un botón para desconectar y la URL de MCP.',
    },
  },
] as const satisfies readonly ScreenDefinition[];

export type ScreenId = (typeof screens)[number]['id'];

/** The definitions as the loose interface, for code that does not need the literal ids. */
export const screenList: readonly ScreenDefinition[] = screens;

/** Path of an image relative to the repository root. */
export function imagePath(id: string, language: Language = 'en'): string {
  return `docs/screenshots/${language}/${id}.${IMAGE.extension}`;
}
