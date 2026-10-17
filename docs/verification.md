# Verificación de la versión 0.1.0

Fecha: 2026-10-17. Esta evidencia corresponde al código de esta entrega y a pruebas locales; no demuestra una instalación cloud ni una conexión a una cuenta real de ChatGPT/Claude.

## Resultados

| Comprobación | Resultado |
|---|---|
| TypeScript y tipos de rutas Next | PASS |
| Vitest: dominio, seguridad, autenticación, MCP y telemetría | 201/201 PASS, 18 archivos |
| Compilación Next.js de producción | PASS con DEMO_MODE=false y salida standalone |
| Arranque standalone de producción | PASS: página, health, readiness, catálogo y rechazo de acceso admin sin sesión |
| Diagnóstico de configuración y tablas locales | PASS, 10 comprobaciones |
| npm audit, dependencias de producción | 0 vulnerabilidades reportadas en esta ejecución |
| Navegador | 6/6 PASS: escritorio, móvil, recuperación y configuración en caliente |

### Integridad y aislamiento

Las pruebas ejecutan SQL sobre archivos libSQL y PostgreSQL en WASM (PGlite), sin sustituir el motor por mocks. Cubren aislamiento de empresas, roles y scopes, claves foráneas compuestas, restricciones y RLS bajo un rol sin privilegios. Incluyen dos conexiones que compiten por stock, ausencia de stock negativo, recuperación posterior al conflicto, reintentos limitados, cancelación única, versiones, importes enteros, moneda confirmada, idempotencia persistente y rollback si falla la auditoría.

### Autenticación y MCP

Better Auth ejecuta sus migraciones reales tanto sobre SQLite como sobre PostgreSQL. Las pruebas realizan registro, login, organización, DCR, autorización con PKCE, consentimiento, JWT firmado, validación del recurso, rechazo de token alterado, refresh y revocación. El cliente y servidor del SDK MCP oficial intercambian herramientas y ejecutan cambios autorizados. No se sustituye OAuth ni JSON-RPC por una implementación de prueba.

La frontera HTTP de autenticación y discovery tiene pruebas adicionales con errores inyectados: conserva cookies, challenges y URLs originales; normaliza fallos inesperados como 503 con referencia de solicitud. Los mocks se usan para inyectar fallos y sustituir singletons por bases reales de prueba. Las pruebas de pagos simulan la respuesta externa de Checkout; la verificación criptográfica usa el SDK real de Stripe.

### Diagnóstico

Se verifican correlación entre capas, redacción de secretos/PII, resultados success/rejected/failure, respuestas 401/503 y continuidad del negocio cuando falla el exportador. La auditoría de negocio sí es obligatoria y transaccional. La revisión estática no encontró alertas críticas; sus advertencias de console se revisaron como salidas del CLI de migraciones y, en POS, falsos positivos sobre impresión de tickets.

No se verificó un collector OTLP externo. El navegador emite eventos de correlación; almacenamiento RUM y trazas distribuidas del frontend requieren un adaptador del cliente.

### Configuración en caliente y despliegue

Las pruebas verifican configuración por tenant, roles y scopes, escritura con versión esperada, conflicto concurrente y rollback de auditoría. La pausa rechaza nuevos pedidos dentro de la transacción; permite recuperar pedidos ya creados con la misma clave idempotente. MCP expone lectura y actualización con autorización y confirmación de la modificación.

Readiness valida conectividad, migraciones requeridas y tablas de autenticación; admite migraciones adicionales compatibles. Las pruebas distinguen base caída, esquema incompleto y fallo de autenticación: devuelven 503 normalizado mientras liveness sigue independiente de la base. El Dockerfile, manifiesto Kubernetes y guía de despliegue están preparados, pero no se ejecutó Docker ni una actualización real entre réplicas en este entorno. Continuidad, drenaje, CDN de assets y rollback deben validarse en la infraestructura elegida.

### Stripe y recuperación

Se prueban firmas con el SDK oficial, manipulación del cuerpo, firma vencida, modo test/live, importe, moneda y vinculación de tenant/pedido/sesión. Las pruebas del servicio usan libSQL y PostgreSQL real en WASM; cubren idempotencia persistente, concurrencia, eventos duplicados o fuera de orden, fallo/expiración, reposición única y conciliación de pagos tardíos. El HTTP rechaza clientes antiguos antes de reservar stock y no revela datos personales al reanudar.

Las respuestas de creación de sesiones se simulan: no hubo cargos ni cuenta Stripe conectada. El navegador prueba recuperación de una respuesta perdida y que el parámetro de retorno no confirma pagos. La conciliación de intentos desconocidos o pagos tardíos requiere intervención operativa; no hay un worker de conciliación automático.

### Escala y extensibilidad

La lista de pedidos carga sus líneas en un lote acotado y mantiene el filtro de tenant. Las pruebas sobre libSQL y PostgreSQL comprueban dos consultas con resultados, una con lista vacía, paginación, aislamiento y snapshots de los precios originales; el dashboard usa como máximo cinco consultas. La migración de índice tenant/nombre/ID es aditiva. Esto reduce consultas, no demuestra una tasa de tráfico.

Los escenarios k6, el overlay de autoescalado y los contratos de nuevos modelos de negocio son preparación. No se ejecutó un benchmark remoto ni se demostró capacidad de miles o millones de usuarios simultáneos. Los perfiles de entregas físicas, acceso digital y suscripciones describen puertos, no proveedores activos; ver sus estados en el manifest.

## Recorridos de navegador

1. Abrir catálogo, ver detalle y añadir un producto al carrito.
2. Ingresar datos de cliente y crear pedido pendiente con precios del servidor.
3. Cancelar desde administración y comprobar reposición de stock.
4. Crear un segundo pedido, confirmar pago manual y comprobar estado persistido.
5. Recorrer catálogo, detalle y carrito móvil.
6. Recuperar una respuesta de checkout perdida, sin duplicar el POST, y comprobar estados de retorno verificados por servidor.
7. Pausar pedidos desde Ajustes, observar el aviso en otra pestaña y rechazar la operación sin consumir stock; reanudar y comprar.

Las pruebas usan datos y base demo persistentes y verifican respuestas HTTP y estado de stock después de operar desde la interfaz. Capturan escritorio 1440 px y móvil 390 px, comprueban ausencia de desbordamiento horizontal de página y de errores JavaScript de la aplicación. Los reportes y capturas quedan en `test-results/` y `playwright-report/`, ignorados por git.

En este entorno el navegador se obtuvo de `@sparticuz/chromium` 153 mediante npm porque la descarga estándar de Chromium no estaba disponible. Playwright acepta `PLAYWRIGHT_EXECUTABLE_PATH` y `PLAYWRIGHT_EXTRA_ARGS` para ese caso; no hay una ruta local fija en el repositorio. Los tests inician Next con webpack. Una caché persistente de Turbopack dañada se apartó y la compilación de producción pasó con caché limpia. Las imágenes externas bloqueadas por el entorno usan el fallback visual; no se afirman pruebas de entrega de imágenes de terceros.

## Reproducir

En un checkout aislado:

```bash
npm ci
npm run demo:setup
npm run doctor
npm run typecheck
npm test
DEMO_MODE=false NEXT_TELEMETRY_DISABLED=1 npm run build
npx playwright install chromium
npm run test:e2e
```

Las pruebas de navegador modifican la base demo. No se ejecutan sobre datos del cliente. GitHub Actions incluye jobs independientes de tipos/pruebas/build y navegador; la ejecución alojada se consulta en la pestaña Actions del repositorio.

## Pendiente para cada instalación real

- Validar Supabase/Neon/Turso con sus credenciales, TLS, pooler, límites de transacción y backup/restauración.
- Desplegar por HTTPS y probar OAuth desde la cuenta y plan concretos de ChatGPT/Claude.
- Configurar proveedor de correo y recuperación de cuenta si forman parte del contrato del cliente.
- Configurar controles de tráfico público, retención de auditoría y datos, y collector/alertas si se requieren.
- Activar Stripe en modo test con la cuenta del cliente y comprobar eventos reales, reintentos, conciliación y retorno. Habilitar live solo después de esa validación.
- Integrar fiscalidad, logística y otras pasarelas cuando correspondan.
