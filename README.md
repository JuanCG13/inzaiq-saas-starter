# Agentic Ecommerce Template

Tienda, carrito, pedidos y administración de catálogo e inventario, con pago manual por defecto y Stripe Checkout activable. Template en **Next.js + TypeScript** para que un agente ensamble instalaciones de clientes y sus administradores operen desde la interfaz o desde **MCP con OAuth**.

> Cliente pide el sistema → agente configura y ensambla módulos → cliente autoriza su agente para administrar su negocio.

## Últimos cambios · v0.1.0

Base funcional: catálogo e inventario persistentes, pedidos transaccionales, aislamiento multitenant, roles, MCP/OAuth, adaptadores PostgreSQL/libSQL, configuración operativa en caliente, contenedores y despliegues graduales con pruebas y telemetría. Consultá [CHANGELOG.md](CHANGELOG.md) y [verificación](docs/verification.md).

## Probar en local

Requiere Node.js 22+; CI usa Node 24.

```bash
git clone https://github.com/JuanCG13/AGENTIC-ECOMMERCE-TEMPLATE.git
cd AGENTIC-ECOMMERCE-TEMPLATE
npm ci
npm run demo
```

Abrí **http://localhost:3000**. El script crea una base `demo.db` aislada y un `.env.local` ignorado por git con un secreto nuevo. No sobrescribe configuración de un cliente. El acceso demo funciona solamente en desarrollo y loopback; producción lo rechaza. **MCP siempre requiere inicio de sesión y consentimiento reales**, incluso en demo.

## Qué incluye

| Capacidad | Implementación |
|---|---|
| Interfaz | Next App Router, React, Radix, Lucide; adaptable y con navegación por teclado |
| Empresas y usuarios | Better Auth Organizations; roles owner, admin, cashier y viewer |
| Catálogo | SKU, categoría, precio, moneda, imagen, estado y edición con versión |
| Inventario | Ajustes auditados, stock no negativo y control de concurrencia |
| Pedidos / ventas | Precios del servidor, total/moneda aprobados, transacción y claves idempotentes |
| Agentes | SDK MCP oficial, Streamable HTTP, OAuth/PKCE, scopes y revocación |
| Datos | Supabase/Neon/PostgreSQL mediante `pg`; Turso/libSQL y SQLite local |
| Diagnóstico | JSON estructurado, correlación por solicitud, OpenTelemetry opcional y auditoría |
| Ensamblaje | Configuración de marca, manifiesto de módulos, scripts, AGENTS y CI |
| Cambios en producción | Ajustes operativos sin recompilar; Docker, readiness, rolling update y rollback documentados |

## Adaptar para un cliente

```bash
npm run configure -- --name "Mi negocio" --currency USD --locale es-PY
```

En un checkout sin demo, copiá `.env.example` a `.env.local`. Configurá `DATABASE_PROVIDER`, `DATABASE_URL`, secreto de autenticación y URL pública HTTPS. Después:

```bash
npm run db:migrate
npm run auth:migrate
npm run dev
```

Creá la cuenta en `/sign-in` y la empresa en `/onboarding`. Para una tienda pública, configurá `STORE_TENANT_ID` con el ID de esa empresa. `/onboarding/connections` muestra el negocio conectado y permite revocar permisos de agentes.

El agente modifica **`src/template.config.ts`** y usa **`template.manifest.json`** para conocer módulos y dependencias. Cambiar moneda de marca no convierte precios existentes. Cada variante talla/color puede ser un SKU independiente en esta versión.

## Cambios por agentes y operación en caliente

El agente empieza por `AGENTS.md` y [el flujo de modificación](docs/agent-workflow.md). Los módulos exponen contratos y pruebas; las migraciones son incrementales. Los administradores pueden cambiar un aviso o pausar nuevas operaciones desde Ajustes o las herramientas MCP `settings_get` y `settings_update`. La validación del servidor se aplica a las nuevas ventas; no cancela pedidos ya aceptados.

Para cambiar código, [la guía de producción](docs/production.md) incluye imágenes inmutables, despliegue gradual, comprobación de esquema y rollback. Hay manifiestos Kubernetes y Dockerfile; no se ha desplegado ni certificado continuidad sobre infraestructura real. [Configuración operativa](docs/runtime-settings.md).

Para crecer, [la guía de escala](docs/scaling.md) documenta réplicas, presupuesto de conexiones, límites actuales de consultas y cuándo añadir búsqueda especializada, agregados o trabajos en segundo plano. No se atribuye una capacidad de tráfico sin medirla en la instalación real.

Para nuevas funciones, [la guía de extensión](docs/extending.md) da una receta por módulo y el mapa de contratos, permisos, migraciones, API/MCP, interfaz y pruebas. `template.manifest.json` funciona como índice para agentes; no carga plugins automáticamente.

[Preparación enterprise](docs/enterprise.md) incluye el overlay de autoescalado y un escenario reproducible de carga. Miles o millones de usuarios simultáneos son un objetivo de arquitectura que requiere infraestructura, partición, capacidad y evidencia de pruebas; no una capacidad demostrada por este template.

[Modelos de negocio](docs/business-models.md) define contratos para entregas físicas, derechos de acceso digital y suscripciones SaaS. Estos perfiles son puntos de extensión; logística, entrega digital y billing recurrente no quedan activados por seleccionar un perfil.



## Conectar ChatGPT o Claude

Desplegá el sistema por HTTPS y añadí **`https://tu-dominio/api/mcp`** como conexión MCP personalizada en el cliente compatible. El propietario inicia sesión, selecciona su empresa y concede permisos. Las escrituras requieren confirmación explícita y controles del servidor.

No se solicitan claves de API de OpenAI/Anthropic para administrar el negocio. La disponibilidad del conector depende de la cuenta y configuración del cliente. [Guía MCP y herramientas](docs/mcp.md).

## Verificación

```bash
npm run doctor
npm run typecheck
npm test
npm run build
```

Si tenés `.env.local` de demo, desactivá `DEMO_MODE` para compilar producción; no publiques la base ni ese archivo. `npm run verify` agrupa tipos, pruebas y build. Las pruebas usan libSQL real y PostgreSQL WASM; las credenciales cloud se verifican por separado en cada instalación.

Para probar los recorridos completos de navegador en un checkout de demo:

```bash
npx playwright install chromium
npm run test:e2e
```

Playwright inicia su servidor, crea datos de prueba y verifica escritorio y móvil. Usá un checkout aislado: estos recorridos modifican la base demo.

## Stripe y otras pasarelas

`PAYMENT_PROVIDER=manual` mantiene la demo sin cargos. Para activar Stripe, configurá `PAYMENT_PROVIDER=stripe`, una clave restringida en `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`; registrá **`POST /api/payments/webhooks/stripe`** con los eventos de Checkout indicados en [la guía de pagos](docs/payments.md).

El SDK oficial crea una sesión de Checkout. Solamente un webhook firmado y validado contra el pedido puede confirmar el pago. Se conservan claves idempotentes, se recuperan intentos interrumpidos y se deduplican eventos. No se guardan números de tarjeta. Las claves y el webhook reales siguen siendo configuración de cada cliente; no se hicieron cobros ni pruebas contra una cuenta Stripe durante esta entrega.

Para otra pasarela, el agente implementa `PaymentProvider`, registra el adaptador y añade su política de redirección y pruebas. Catálogo, pedidos e inventario conservan sus contratos. No hay integraciones ficticias de otras pasarelas.

## Alcance de esta versión

En modo manual, el checkout registra un pedido pendiente y un administrador confirma o cancela. En modo Stripe, Checkout gestiona el cobro y los webhooks actualizan el pedido; los controles manuales quedan bloqueados para esos pedidos. No se incluyen todavía facturación tributaria, devoluciones, envíos, compras a proveedores, stock fraccionario, sucursales ni sincronización offline. Las reservas manuales no vencen automáticamente. Las sesiones Stripe vencidas o fallidas reponen stock al recibirse el webhook; hay que monitorizar y reconciliar eventos ausentes o pagos tardíos.

La base está preparada para desplegarse, pero **no está certificada como un sistema productivo terminado**. Antes de aceptar operaciones reales: conexión cloud, HTTPS, backup/restauración, controles de tráfico público y pruebas con la cuenta MCP del cliente. No se ha afirmado una conexión real a cuentas ChatGPT/Claude ni a bases cloud durante la construcción.

## Documentación

- [Ensamblaje paso a paso](docs/assembly.md)
- [Arquitectura y decisiones](docs/architecture.md)
- [Bases de datos e invariantes](docs/database.md)
- [OAuth y MCP](docs/mcp.md)
- [Telemetría y operación](docs/telemetry.md)
- [Resultados de verificación](docs/verification.md)
- [Producción, actualizaciones y rollback](docs/production.md)
- [Flujo de cambios para agentes](docs/agent-workflow.md)

Licencia MIT. Las dependencias y fotos de muestra conservan sus respectivas licencias.
