# Escala y extensión del template

Este documento describe el código actual y una ruta de evolución. **No se ha medido una capacidad máxima de usuarios, pedidos por segundo, tamaño de catálogo ni disponibilidad.** Las pruebas de corrección/concurrencia local no sustituyen una prueba de carga en el proveedor, región y despliegue reales.

## Base que ya permite crecer

- UI, HTTP y MCP comparten el servicio de negocio en `src/core/service.ts`. Una funcionalidad nueva puede conservar las mismas invariantes y exponerse a interfaces distintas.
- Tenant y permisos se verifican en cada operación. La persistencia conserva claves únicas por tenant, referencias compuestas, auditoría transaccional e idempotencia durable.
- PostgreSQL/Supabase/Neon usan `pg`; Turso usa libSQL remoto. El estado de negocio no depende de la memoria de una réplica. El pool sí es local al proceso.
- Nuevas versiones pueden desplegarse con base compartida y migraciones compatibles. La preparación de despliegue, límites y requisitos están en [production.md](production.md).
- Los módulos y dependencias están en `template.manifest.json`. Desactivar un módulo no elimina sus datos ni equivale a un servicio desplegado por separado.

## Límites actuales comprobables en el código

| Superficie | Límite actual | Qué no garantiza |
| --- | --- | --- |
| Listas del dominio | 50 filas por defecto, máximo 200; offset hasta 1.000.000 | El límite de respuesta no limita las filas que el motor debe escanear/ordenar. |
| Listas HTTP de productos/pedidos | 100 por defecto y máximo; offset hasta 100.000 | No es paginación por cursor; altas concurrentes pueden desplazar páginas. |
| Listas MCP | Máximo solicitado 100; omitirlo conserva el defecto de dominio 50 | El coste total depende de las consultas asociadas y del tamaño de los datos. |
| Auditoría HTTP | Últimas 100 entradas | No implementa exportación histórica masiva. |
| Dashboard | Cinco pedidos recientes; agregados de todo el tenant | El agregado no tiene ventana de fechas ni coste constante. |
| Pedido | Hasta 100 líneas enviadas, agrupadas por producto | Un carrito grande prolonga la transacción y sus bloqueos. |
| Unidades | Hasta 1.000.000 por producto/pedido; stock máximo 1.000.000.000 | No hay unidades fraccionarias ni inventario por almacén. |
| Dinero | Enteros exactos hasta Number.MAX_SAFE_INTEGER | El total histórico del dashboard también debe caber en ese rango. |
| Runtime | Lectura del ajuste desde DB; UI consulta cada 30 segundos visible y al recuperar foco | No existe difusión push ni caché distribuida de esta configuración. |

El código de referencia está en `src/core/service.ts`, `src/lib/http.ts`, `src/lib/mcp.ts` y `src/runtime/components.tsx`. La pausa de ventas es un control de admisión dentro de la transacción; permite reintentos de pedidos ya aceptados y no cancela operaciones en curso.

## Consultas e índices: riesgos concretos

| Área | Comportamiento actual | Siguiente mejora mínima cuando corresponda |
| --- | --- | --- |
| Pedidos | `listOrders` obtiene la página y todas sus líneas en una consulta agrupada por tenant + IDs: dos consultas para una página no vacía, una si está vacía. | La regresión `domain-scaling.test.ts` cuenta ejecuciones reales en libSQL/PostgreSQL WASM, verifica aislamiento, offsets y snapshots persistidos. No aumentar el tamaño de página sin evaluar volumen de líneas/respuesta. |
| Recientes del dashboard | Cuatro consultas iniciales (productos, cantidad de pedidos, ingresos y últimos pedidos), más una consulta agrupada de líneas: hasta cinco. | El test de regresión comprueba cinco consultas con cinco pedidos recientes. El coste de los agregados históricos sigue creciendo con los datos. |
| Orden del catálogo | Ordena por `name, id`; una migración nueva incorpora `commerce_products_tenant_name_id` sobre `(tenant_id, name, id)`, además del índice único tenant/SKU. | La existencia y columnas del índice se prueban en ambos motores. Medir el plan elegido y coste de escritura en la base gestionada; no se presenta una mejora de latencia medida. |
| Búsqueda | `lower(name)` o `lower(sku)` con patrón `%texto%`. | Para catálogos grandes, introducir un contrato de búsqueda dedicado. Elegir implementación por proveedor después de medir; un índice B-tree de nombre no resuelve por sí solo el patrón de contenido. |
| Páginas profundas | Usa offset para productos, pedidos y auditoría. | Añadir cursor estable con desempate por ID y compatibilidad con clientes existentes. Alinear índices con los filtros y el orden elegido. |
| Dashboard histórico | Cuenta y suma productos/pedidos del tenant en cada solicitud; ingresos agrupados por moneda. | Primero ventanas de fecha y medidas de coste; después agregados incrementales o caché compartida con invalidación definida, si la medición lo exige. |
| Inventario solicitado simultáneamente | Actualizaciones condicionales serializan ventas del mismo SKU y mantienen stock no negativo. | Medir espera de locks y percentiles de checkout. Aumentar réplicas web no elimina contención sobre un único producto. |

Los conteos de listados/dashboard también se comprueban sobre consultas ejecutadas en los tests de regresión; **no son resultados de un benchmark de capacidad o latencia**. Los índices existentes cubren claves tenant/ID, tenant/SKU, idempotencia de pedido y ajuste, fechas por tenant en pedidos/auditoría y líneas por tenant/pedido. No hay particionamiento ni sharding. La migración portable del índice usa `CREATE INDEX` normal: sobre tablas grandes puede bloquear escrituras mientras se construye. Medir y planificar su aplicación en staging; una construcción online/concurrente requiere un procedimiento específico del motor compatible con el migrador, no asumir que este índice se instala sin bloqueo.

Un pedido nuevo de N productos distintos realiza aproximadamente `6 + 2N` sentencias del servicio dentro de la transacción: comprobaciones, cabecera, actualización de stock e inserción de cada línea, total final, auditoría y carga de respuesta. No cuenta BEGIN/COMMIT, reintentos ni validación de sesión. No abrir llamadas externas mientras esas filas estén bloqueadas. Una optimización posterior puede agrupar inserciones de líneas sin debilitar las condiciones de stock, el orden de bloqueo o la atomicidad.

## Conexiones, tiempos y réplicas

`getDatabase()` mantiene un único cliente de aplicación por proceso. Para PostgreSQL, Supabase y Neon lee estos parámetros de entorno al crear el pool:

| Variable | Valor por defecto | Rango aceptado | Opción de `createDatabase()` |
| --- | ---: | ---: | --- |
| `PG_POOL_MAX` | 5 | 1–100 | `maxConnections` |
| `PG_CONNECTION_TIMEOUT_MS` | 10 000 ms | 100–60 000 ms | `connectionTimeoutMillis` |
| `PG_IDLE_TIMEOUT_MS` | 30 000 ms | 1 000–600 000 ms | `idleTimeoutMillis` |

La validación exige enteros decimales sin espacios, signos, exponentes ni fracciones; también rechaza cero. La factoría directa valida los mismos rangos. El máximo limita cada pool, no todas las réplicas en conjunto. Evitar crear una nueva factoría por solicitud: cada invocación de `createDatabase()` crea otro cliente.

No se establecen explícitamente `statement_timeout`, `lock_timeout` ni un plazo global de transacción; la configuración del proveedor puede añadir sus propios límites. El timeout HTTP/readiness no implica que el driver haya cancelado la consulta SQL subyacente.

Antes de aumentar réplicas, calcular `procesos simultáneos × conexiones máximas`, incluyendo la versión antigua/nueva durante publicación, migraciones, jobs y otras aplicaciones. El manifiesto de dos réplicas con un pod adicional de despliegue puede tener tres procesos: hasta 15 conexiones de aplicación con el defecto actual, más consumidores externos. No es una cifra de capacidad de tráfico.

Configurar el pooler recomendado para el proveedor y el camino de migración según [production.md](production.md). Validar que sus límites, afinidad de sesión y semántica transaccional sean compatibles. Turso tiene su propio cliente/servicio y no hereda los cinco slots de `pg`.

SQLite local con WAL es útil para desarrollo y una instalación de un solo host con disco durable. No distribuir copias del archivo entre réplicas: divergen. Compartir un archivo no convierte SQLite en una arquitectura de escritura multinodo. Para réplicas web independientes, seleccionar una base remota compartida soportada.

## Retención y trabajo en segundo plano

Auditoría, idempotencia y registros operativos crecen con el uso. No borrar claves de idempotencia indiscriminadamente: después de borrarlas una solicitud antigua puede volver a aplicar una venta o un ajuste. Definir una política de retención, archivado y rechazo de solicitudes fuera de ventana antes de purgar datos comerciales.

`commerce_rate_limits` dispone de `expires_at` e índice de expiración, pero no tiene un limpiador programado en este template. Si se utiliza su presupuesto público, añadir un job acotado para eliminar únicamente buckets vencidos. No confundir este mantenimiento con la eliminación de claves comerciales.

Las futuras exportaciones, importaciones, sincronizaciones y backfills deben procesarse por lotes con progreso durable, idempotencia, límite de concurrencia y señal de error. Para efectos externos disparados por un commit, incorporar un outbox transaccional y un consumidor con deduplicación; no lanzar una promesa suelta desde una solicitud. Todavía no hay una cola ni un worker genérico instalado.

## Medir antes de comprometer capacidad

1. Preparar una base de staging con distribución representativa de productos, pedidos, líneas, tenants y actividad; usar datos sintéticos o anonimizados. Guardar tamaño y versión exacta.
2. Definir el objetivo de latencia/error del cliente. Medir lecturas, búsqueda, checkout simultáneo del mismo SKU, replay idempotente y actualización de versión con clientes abiertos.
3. Registrar p50/p95/p99, errores y reintentos, espera de pool, conexiones activas/en espera, filas examinadas, duración de consulta/transacción y bloqueo. La telemetría actual ya ofrece duración/resultado por operación; los gauges de pool y timings de consulta **no están instrumentados explícitamente**.
4. Inspeccionar planes del motor real para consultas lentas. El motor WASM de pruebas valida SQL e invariantes, no la latencia de red, pooler o capacidad del servicio gestionado.
5. Cambiar una limitación a la vez, comparar contra la línea base y conservar la evidencia. Repetir la prueba de stock, aislamiento, auditoría y rollback después de cada optimización.

No extrapolar usuarios simultáneos a partir de tests unitarios, del número de réplicas del ejemplo o del plan contratado de la base.

## Extender módulos sin fragmentar reglas

Un módulo nuevo debe declarar: propósito, tablas/migración, método de dominio, permisos/scopes, contrato de entrada/salida, claves de idempotencia cuando corresponda, eventos permitidos y pruebas de error. Mantener las rutas HTTP y herramientas MCP como adaptadores; no duplicar en ellas cálculo de dinero, stock o permisos.

Introducir cambios de esquema con migraciones nuevas y estrategia expandir/migrar/retirar. Mantener contratos antiguos durante la transición y añadir campos opcionales antes de hacerlos obligatorios. Usar `template.manifest.json` para dependencias; separar un servicio de despliegue solo cuando exista una necesidad medida de aislamiento, ciclo de publicación o capacidad propia. Un monolito modular conserva transacciones simples mientras los módulos compartan el mismo proceso y base.

## Pagos online: cola operativa y reconciliación

El ecommerce añade `src/payments/contracts.ts` y un proveedor registrable. Las llamadas externas ocurren fuera de transacciones SQL; el intento y su clave de proveedor son durables. Los eventos firmados se deduplican y cambian pedido/stock/auditoría atómicamente. Las tablas tienen unicidad por proveedor/sesión/evento y un índice de estado/fecha para localizar intentos que requieren revisión.

No existe un worker automático para intentos sin sesión vinculada, reservas que nunca reciben un webhook o reconciliación de pagos posteriores a cancelación. Antes de aceptar volumen real, definir alertas, operador y procedimiento para esos estados. Un reintento conserva la misma clave dentro de la ventana garantizada del proveedor; fuera de ella requiere revisión y no crea otra sesión a ciegas. No considerar pago un retorno del navegador ni restaurar stock por un timeout HTTP.

Al incorporar otra pasarela, implementar el puerto, validar moneda/importes y firma, registrar el proveedor y pasar pruebas de duplicado, fuera de orden, timeout, sesión desconocida, idempotencia y rollback. La prueba criptográfica local de Stripe no certifica credenciales ni webhooks de una cuenta real.

## Ruta hacia tráfico de gran escala

“Millones de usuarios simultáneos” debe descomponerse en sesiones abiertas, solicitudes por segundo, lecturas/escrituras, distribución de tenants/SKU, regiones y latencia objetivo. Un millón de pestañas inactivas no equivale a un millón de checkouts concurrentes. Ninguna de esas capacidades está certificada por este repositorio.

La ruta siguiente es arquitectura futura, no infraestructura instalada ni una promesa de capacidad:

1. **Distribución de contenido:** CDN para imágenes y activos inmutables versionados. Solo cachear respuestas públicas diseñadas para ello; nunca sesiones, permisos, checkout ni APIs privadas. El catálogo público cacheado requiere invalidación por producto/tenant y TTL explícito.
2. **Réplicas web sin estado:** balanceador, límites de admisión, autoscaling y presupuesto total de conexiones. Añadir procesos solo cuando la base/proveedores aún tengan capacidad; de lo contrario aumenta la cola y los timeouts.
3. **Lecturas separadas:** caché compartida e invalidación, búsqueda especializada y, si el proveedor lo permite, réplicas de lectura para consultas tolerantes a desfase. Checkout, stock, confirmación de pagos, membresía/revocación y admisión requieren una ruta con consistencia adecuada; no enviarlas automáticamente a una réplica atrasada.
4. **Trabajo asíncrono:** outbox, cola durable y workers acotados para exportaciones, integraciones, reconciliación y agregados. Mantener idempotencia y backpressure. Una cola no autoriza contestar “pago realizado” antes de confirmar el efecto real.
5. **Distribución de tenants:** si una base alcanza un cuello de botella medido, incorporar un directorio de tenant a base/shard resuelto desde identidad confiable. Mantener una transacción de pedido/stock/auditoría dentro del mismo shard. Definir migración de tenants, aislamiento, índices por shard y recuperación antes de mover tráfico.
6. **Datos históricos:** partición/archivado por política y volúmenes medidos, dashboards por ventana y agregados. Comprobar restricciones únicas, claves de idempotencia y referencias antes de particionar; repartir tablas sin preservar esas invariantes rompe la seguridad comercial.

Para un tenant o SKU muy popular, el límite puede ser la escritura serializada sobre el mismo stock. Resolverlo requiere un diseño explícito de reservas/particiones de inventario y sus compensaciones, no solamente más pods. Las funciones futuras pueden usar los puertos actuales, pero sharding, caché compartida, cola, réplicas de lectura y stock distribuido requieren código, operación y pruebas adicionales.
