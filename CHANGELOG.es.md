# Historial de cambios

[English](CHANGELOG.md) · [Español](CHANGELOG.es.md)

## Sin publicar como versión

### Añadido

- Interfaz en inglés y español con rutas por idioma (`/en`, `/es`), selector de idioma y un proxy que elige la opción guardada, luego el idioma del navegador y por último el predeterminado de la instalación, conservando los parámetros de la URL (también en las continuaciones OAuth).
- Base de internacionalización para más idiomas: catálogos de mensajes por área con plurales, un registro de idiomas de una línea, `<html lang>` y metadatos generados en el servidor, y pruebas de paridad que informan claves, marcadores y formas plurales faltantes en cada idioma registrado.
- Los mensajes del servidor son en inglés con códigos de error estables; el navegador muestra el texto traducido de `errors.codes.<CODE>` y una prueba exige traducir cada código nuevo.
- La moneda predeterminada es USD y se puede cambiar: `npm run configure -- --currency EUR --currencies EUR,USD,GBP` valida los códigos ISO 4217 con el mismo código de la aplicación, `npm run doctor` revisa la configuración y el editor de productos ofrece la lista configurada. Los precios existentes nunca se convierten.
- Recorrido automatizado de 23 pantallas (`npm run screenshots`), imágenes WebP compactas y una galería generada en inglés y español.
- Ilustraciones de demostración propias en `public/demo` en lugar de fotos de terceros, por lo que la demo y las capturas funcionan sin conexión.
- Escenarios de navegador para negociación y cambio de idioma, 404 traducidos, formato de moneda y límites entre API y proxy (36 pruebas de navegador en total).

### Cambiado

- El catálogo demo y cada pantalla predeterminada están en inglés. `template.config.ts` reemplaza `locale` por `i18n.defaultLocale`/`i18n.locales`, agrega `currencies` y acepta una `description` por idioma. `npm run configure` ahora recibe `--locale`, `--locales` y `--currencies`.
- Los números insertados en los mensajes se agrupan según el idioma activo.
- Las rutas desconocidas bajo un prefijo de idioma responden con un 404 real; por eso las pantallas de carga pasaron a las rutas de página.
- `/favicon.ico` se sirve desde el ícono declarado en lugar de devolver 404.

### Corregido

- Desajuste de hidratación en la página de agentes conectados (el origen se leía durante el render).
- El patrón del identificador del negocio en el alta era una expresión regular inválida para los navegadores y omitía la validación del lado del cliente.
- Los importes de las tarjetas de métricas ya no se parten dentro de la cifra en móviles angostos.

### Documentación

- Nueva identidad InzaiQ Starter y comandos de clonado actualizados al nombre del repositorio.
- README principal en inglés y una versión completa en español, con navegación clara e índice de guías por idioma.
- Capturas reales de todas las pantallas, una galería visual y un índice de guías con el idioma de cada una.
- Guía de idiomas y moneda (`docs/i18n.md`, `docs/i18n.es.md`) y guías de contrato actualizadas para el proxy, los catálogos de mensajes y los mensajes del servidor en inglés.

## 0.1.0 — 2026-10-17

- Template modular en Next.js con catálogo, inventario, pedidos, auditoría, aislamiento por empresa, roles e importes enteros respaldados por SQL real.
- SDK oficial de MCP, OAuth/PKCE con Better Auth, consentimiento por empresa, scopes y revocación inmediata.
- Precios del servidor, validación del total y moneda confirmados, control de versiones, idempotencia persistente y cancelación/reposición atómicas.
- Adaptadores PostgreSQL para Supabase/Neon y Turso/libSQL, migraciones portables, RLS con denegación predeterminada y datos de ejemplo exclusivos de desarrollo.
- Telemetría estructurada con redacción, OpenTelemetry opcional, diagnóstico y CI.
- Interfaz adaptable y documentación de ensamblaje para agentes.
- Pruebas de aislamiento entre empresas, rollback ante fallo de auditoría, ventas concurrentes, precios/monedas desactualizados y escrituras repetidas.
- Configuración operativa en caliente por empresa, actualizaciones con versión esperada, auditoría y herramientas MCP de ajustes.
- Docker standalone, readiness de esquema, despliegues graduales y guías de operación y rollback.
- Contrato intercambiable de pagos y Stripe Checkout: firma, idempotencia, recuperación, webhooks y conciliación explícita.

### Escala y extensibilidad

- Carga por lotes de las líneas de pedidos e índice de catálogo por empresa/nombre/ID.
- Pool PostgreSQL configurable, validado y con presupuesto por réplica.
- Guías de escala y extensión por módulos, con mapa de archivos y contratos para agentes.
