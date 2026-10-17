# InzaiQ SaaS Starter

**Una base modular en Next.js para negocios construidos y administrados con agentes.**

Partí de una aplicación de comercio funcional. Reutilizá sus módulos de identidad, base de datos, pagos, telemetría y MCP para ensamblar la instalación de un cliente o extender un producto nuevo.

[English](README.md) · **Español** · [Documentación](docs/README.md) · [Últimos cambios](CHANGELOG.es.md)

[![CI](https://github.com/JuanCG13/inzaiq-saas-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/JuanCG13/inzaiq-saas-starter/actions/workflows/ci.yml)
[![Licencia: MIT](https://img.shields.io/badge/Licencia-MIT-2563eb.svg)](LICENSE)
[![Next.js 16.4.2](https://img.shields.io/badge/Next.js-16.4.2-111111?logo=nextdotjs)](package.json)
[![TypeScript 7.0.2](https://img.shields.io/badge/TypeScript-7.0.2-3178c6?logo=typescript&logoColor=white)](package.json)

![InzaiQ SaaS Starter — panel de administración con pedidos, inventario y acceso para agentes](docs/screenshots/admin-overview.png)

> El cliente necesita un sistema → un agente desarrollador ensambla la instalación → el propietario autoriza a su asistente para operarlo mediante MCP.

## Sobre qué podés construir

La aplicación actual es un **módulo de comercio funcional**: tienda, carrito, catálogo, inventario, pedidos y administración. El starter aporta contratos reutilizables para otros modelos de negocio.

| Área | Disponible hoy | Punto de extensión |
| --- | --- | --- |
| Comercio | Tienda y administración adaptables, edición de productos, ajustes de stock, checkout manual y gestión de pedidos | Envíos, facturación fiscal, devoluciones e inventario fraccionario o por sucursal |
| Identidad | Organizaciones de Better Auth, roles owner/admin/cashier/viewer y aislamiento por empresa | Recuperación de cuentas, envío de correos y políticas de identidad del cliente |
| Operaciones con agentes | SDK MCP oficial, Streamable HTTP, OAuth/PKCE, scopes, consentimiento y revocación | Nuevas herramientas respaldadas por los mismos servicios de negocio |
| Pagos | Coordinación manual y Stripe Checkout opcional de pago único, webhooks firmados y recuperación de intentos | Adaptadores de otras pasarelas y sus políticas de redirección |
| Ajustes en caliente | Aviso por empresa y pausa/reanudación de nuevos pedidos desde UI o MCP | Campos operativos autorizados explícitamente |
| Entrega física | `FulfillmentProvider` y contratos compartidos de contexto e importes | **Solo contratos:** transportista, cotizaciones, despacho y ciclo de entrega |
| Productos digitales | `EntitlementProvider` y contratos de referencia a recursos | **Solo contratos:** acceso del comprador verificado, almacenamiento protegido y descargas |
| SaaS recurrente | `SubscriptionProvider`, derechos de acceso y contratos de trabajo durable | **Solo contratos:** cobros recurrentes, planes, políticas de acceso y workers |

El manifest es un índice de navegación y dependencias para agentes. Seleccionar un perfil no instala un proveedor ni habilita un flujo de negocio. Consultá [modelos de negocio](docs/business-models.md) y [la receta de extensión](docs/extending.md).

## Vista de la interfaz

Capturas reales de la aplicación de referencia, cuya interfaz utiliza textos en español. La tienda NOMA demuestra el módulo de comercio; la marca y el contenido se adaptan a cada cliente.

| Tienda | Ajustes operativos en caliente |
| --- | --- |
| ![Tienda de comercio en escritorio](docs/screenshots/storefront.png) | ![Aviso por empresa y control de aceptación de pedidos](docs/screenshots/runtime-settings.png) |

<details>
<summary>Ver la tienda en móvil</summary>
<br />
<img src="docs/screenshots/storefront-mobile.png" alt="Tienda de comercio en una pantalla móvil" width="280" />
</details>

## Ejecutar la demo

Requiere **Node.js 22+**; CI utiliza Node.js 24.

```bash
git clone https://github.com/JuanCG13/inzaiq-saas-starter.git
cd inzaiq-saas-starter
npm ci
npm run demo
```

Abrí [localhost:3000](http://localhost:3000). El script crea una `demo.db` aislada y un `.env.local` ignorado por git con un secreto nuevo. Conserva la configuración existente de un cliente. El acceso demo se limita al desarrollo local; MCP sigue requiriendo inicio de sesión y consentimiento OAuth reales.

## Ensamblar una instalación para un cliente

Usá un checkout nuevo sin configuración de demo:

```bash
npm ci
npm run configure -- --name "Mi negocio" --currency USD --locale es-PY
cp .env.example .env.local
```

Configurá la conexión de base de datos, `BETTER_AUTH_SECRET` y la URL canónica `BETTER_AUTH_URL` en `.env.local`. Después ejecutá:

```bash
npm run db:migrate
npm run auth:migrate
npm run dev
```

Creá la cuenta del propietario en `/sign-in` y el negocio en `/onboarding`. Para seleccionar la tienda pública, configurá `STORE_TENANT_ID` con el ID de esa organización, disponible en `/onboarding/connections`.

| Base de datos | Adaptador | Configuración |
| --- | --- | --- |
| Supabase, Neon o PostgreSQL | Kysely + `pg` | URL de conexión del servidor y presupuesto adecuado del pool |
| Turso | Kysely + libSQL | URL remota de libSQL y token exclusivo del servidor |
| SQLite local | Archivo libSQL | Desarrollo o un servidor único con volumen persistente deliberadamente configurado |

[Configuración de base de datos e invariantes →](docs/database.md)

La marca y los módulos se configuran en [`src/template.config.ts`](src/template.config.ts); los agentes se orientan con [`template.manifest.json`](template.manifest.json) y [`AGENTS.md`](AGENTS.md). Los textos de la interfaz de referencia están en español. Adaptalos al cliente, reemplazá las imágenes de muestra y cargá el catálogo real. Cambiar la moneda configurada no convierte los precios existentes.

## Que el propietario use su propio agente

Desplegá la aplicación con HTTPS público y añadí esta URL como conexión MCP personalizada en un cliente compatible, como ChatGPT o Claude:

```text
https://tu-dominio/api/mcp
```

El propietario inicia sesión, elige una organización y concede scopes. El asistente ejecuta operaciones definidas de productos, inventario, pedidos, reportes y ajustes; el servidor comprueba membresía, rol y permisos vigentes. El consentimiento se puede revocar desde `/onboarding/connections`.

La aplicación no necesita una API key de OpenAI ni Anthropic para este flujo. La disponibilidad de conectores personalizados depende del cliente, plan y políticas del espacio de trabajo del usuario. [Configuración MCP, herramientas y autorización →](docs/mcp.md)

## Pagos e integridad del negocio

`PAYMENT_PROVIDER=manual` registra pedidos pendientes para coordinar el pago. Configurá `PAYMENT_PROVIDER=stripe` junto con `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` en el servidor para habilitar el adaptador de Checkout alojado. Registrá sus eventos en `POST /api/payments/webhooks/stripe` siguiendo [la guía de pagos](docs/payments.md).

El servidor valida precios y moneda. Pedidos, stock y auditoría se guardan en una transacción; la idempotencia persistente protege los reintentos. Los eventos firmados y vinculados al pedido actualizan el estado del pago online. El retorno del navegador no acredita un cobro y los intentos inciertos conservan su referencia original. Los datos de tarjeta quedan en la pasarela.

Otras pasarelas utilizan el contrato [`PaymentProvider`](src/payments/contracts.ts), registro explícito en el servidor, reglas de confianza del cliente y pruebas. [El mapa completo de extensión](docs/payments.md#extender-a-otra-pasarela) identifica cada archivo necesario.

## Preparado para mantenimiento por agentes

- **Un servicio de negocio para UI, HTTP y MCP.** Las reglas de empresa, dinero, permisos e inventario permanecen en el dominio.
- **Diagnóstico acotado y correlacionado.** Logs JSON estructurados, referencias de solicitud, exportación OpenTelemetry opcional y auditoría transaccional; secretos y datos del cliente quedan fuera de los eventos de diagnóstico.
- **Cambios pequeños y revisables.** Contratos por módulo, migraciones aditivas, pruebas de regresión útiles y flujo documentado para agentes.
- **Controles operativos en caliente.** Cambiá un aviso o pausá nuevos pedidos sin recompilar. Los pedidos existentes y los webhooks de pago continúan su ciclo.
- **Publicaciones con límites explícitos.** El código y la marca compilada se entregan como versiones inmutables, con readiness del esquema y procedimientos de rollback compatibles.

Empezá por [flujo para agentes](docs/agent-workflow.md), [telemetría](docs/telemetry.md) y [ajustes operativos](docs/runtime-settings.md).

## Verificación

Evidencia local registrada: **201 pruebas automatizadas y 6 escenarios de navegador aprobados**, que incluyen transacciones, aislamiento de empresas, OAuth/MCP, recuperación de pagos, escritorio/móvil y ajustes en caliente. También aprobaron los tipos, la compilación de producción y el arranque standalone. El [registro de verificación](docs/verification.md) detalla el alcance y la reproducción; el badge de CI muestra el estado actual del workflow del repositorio.

```bash
npm run doctor
npm run typecheck
npm test
DEMO_MODE=false npm run build
```

En un checkout de demo aislado, ejecutá la suite de navegador:

```bash
npx playwright install chromium
npm run test:e2e
```

`npm run verify` combina tipos, pruebas y compilación. Mantené `DEMO_MODE=false` al compilar para producción. Las pruebas de navegador inician su propio servidor y modifican la base demo.

Las pruebas locales de integración utilizan libSQL y PostgreSQL mediante PGlite. Las respuestas de red de Stripe se simulan y las firmas se verifican con el SDK oficial. Las transacciones reales de Stripe, conexiones a bases gestionadas y cuentas reales de ChatGPT/Claude se validan por instalación.

## Despliegue y crecimiento

El repositorio incluye un [Dockerfile](Dockerfile) standalone, [despliegue Kubernetes](deploy/kubernetes.yaml), endpoints de liveness/readiness, comprobación del presupuesto de conexiones, un overlay de autoescalado y un escenario k6. La [guía de producción](docs/production.md) cubre migraciones, imágenes inmutables, compatibilidad de assets, publicación gradual y rollback; las guías de [escala](docs/scaling.md) y [preparación enterprise](docs/enterprise.md) ayudan a definir y medir capacidad.

Antes de aceptar tráfico real, validá la base elegida, HTTPS y OAuth, el sandbox de pagos, respaldo/restauración, controles de tráfico y recuperación del despliegue. La capacidad y las actualizaciones sin interrupción deben demostrarse en esa infraestructura; el starter no asigna una garantía de rendimiento o disponibilidad sin mediciones.

Las reservas manuales requieren seguimiento operativo. Los intentos online vencidos o fallidos reponen stock al recibir eventos verificados; eventos ausentes o pagos tardíos requieren conciliación. Envíos, facturación fiscal, reembolsos, entrega digital protegida y cobros recurrentes siguen los contratos de extensión anteriores.

## Documentación

| Para empezar | Operar y extender |
| --- | --- |
| [Guía de instalación](docs/assembly.md) | [Producción y rollback](docs/production.md) |
| [Arquitectura](docs/architecture.md) | [Escala y presupuesto de recursos](docs/scaling.md) |
| [Contratos de base de datos](docs/database.md) | [Receta de extensión por módulo](docs/extending.md) |
| [MCP y OAuth](docs/mcp.md) | [Contratos de modelos de negocio](docs/business-models.md) |
| [Pagos](docs/payments.md) | [Telemetría](docs/telemetry.md) |
| [Registro de verificación](docs/verification.md) | [Flujo para agentes](docs/agent-workflow.md) |

Los README están disponibles en inglés y español. Las guías técnicas utilizan actualmente ambos idiomas; el [índice de documentación](docs/README.md) identifica el idioma de cada guía.

## Versión y licencia

**Versión actual: v0.1.0.** Comercio modular, MCP/OAuth, Stripe Checkout, ajustes operativos en caliente y herramientas de despliegue/extensión. [Ver changelog →](CHANGELOG.es.md)

Distribuido bajo [licencia MIT](LICENSE). Las dependencias y las imágenes de muestra conservan sus respectivas licencias.
