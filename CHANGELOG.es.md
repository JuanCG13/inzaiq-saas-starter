# Historial de cambios

[English](CHANGELOG.md) · [Español](CHANGELOG.es.md)

## Sin publicar como versión

### Documentación

- Nueva identidad InzaiQ Starter y comandos de clonado actualizados al nombre del repositorio.
- README principal en inglés y una versión completa en español, con navegación clara e índice de guías por idioma.
- Capturas reales de escritorio y móvil y una galería de las interfaces incluidas.

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
