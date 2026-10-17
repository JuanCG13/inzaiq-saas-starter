# Preparación para operación enterprise

El repositorio aporta una base modular, límites de consultas/pools, controles de integridad, telemetría y plantillas de despliegue/medición. **No existe una capacidad medida de miles o millones de usuarios simultáneos ni un SLA probado.** Las plantillas de HPA y el guion k6 no aprovisionan infraestructura; tampoco convierten por sí solos un servicio Next.js con una base compartida en un sistema de escala global.

El objetivo es poder crecer con evidencia y cambios acotados. Las fronteras del código están en [extending.md](extending.md), los límites de consultas en [scaling.md](scaling.md) y el procedimiento de migración/release/rollback en [production.md](production.md).

## Un contrato de capacidad antes de dimensionar

Definir por recorrido: tasa sostenida/pico, duración del pico, tamaño de datos, distribución entre tenants, mezcla de lectura/escritura, tamaño de respuesta, latencia p95/p99, errores aceptables y presupuesto. Precisar si «simultáneos» significa personas con sesión, conexiones abiertas, solicitudes en vuelo o compras en proceso. Son cantidades distintas.

Como cálculo ilustrativo, 1.000 solicitudes/s con duración media de 0,2 segundos implican unas 200 solicitudes en vuelo en régimen estable; no indican cuántos usuarios humanos existen ni prueban que este sistema alcance esa tasa. Un millón de sesiones casi inactivas y un millón de intentos de compra por segundo requieren diseños diferentes. Un producto/tenant muy popular puede saturar una fila, pool o cuota antes que la CPU web.

La aceptación debe declarar una combinación medible, por ejemplo «este recorrido y dataset a X solicitudes/s durante Y minutos, p95 < Z, errores < E, sin pérdida de invariantes, con un nodo fuera de servicio». Los valores X/Y/Z/E se acuerdan y se demuestran en staging. No reemplazarlos por un número de usuarios estimado a partir del HPA.

## Fronteras de la arquitectura

| Capa | Estado actual verificable | Evolución cuando una medición la justifique |
| --- | --- | --- |
| Edge / CDN | Configuración `NEXT_ASSET_PREFIX` y `DEPLOYMENT_VERSION`; no CDN ni WAF provisionado | Distribuir assets inmutables y conservar versiones previas. TLS, protección de origen, límites y defensa DDoS administrados fuera del proceso Next. |
| Tienda pública | Storefront, administración y API se sirven desde una aplicación Next; catálogo público del tenant configurado | Aislar tráfico público de administración y optimizar lecturas de catálogo mediante contratos explícitos de frescura; la separación física no está implementada. |
| API de negocio / MCP | HTTP y MCP comparten servicios, permisos, tenant y persistencia; están en el mismo despliegue Next | Separar recursos/ingress por clase de tráfico si hace falta; conservar contratos e identidad verificada. No existe un servicio API independiente generado por este template. |
| Workers | No hay worker de propósito general ni planificador durable | Extraer trabajos largos/importaciones/reportes/entregas cuando se definan reintentos, límites, cancelación y estado durable. No ejecutar trabajo indispensable en memoria tras responder. |
| Colas / outbox | No hay broker ni outbox transaccional general integrado | Elegir un servicio probado; persistir el evento con la transacción, consumidores idempotentes, reintentos acotados, DLQ y reconciliación. Añadirlo es una extensión, no activar un flag. |
| Base de datos | Adaptadores PostgreSQL/Supabase/Neon/libSQL, transacciones y pool PG por proceso; una base configurada por instancia | Afinar índices/consultas y presupuesto; después réplicas de lectura o particiones solo con consistencia, lag y failover explícitos. No hay routing automático a réplicas ni sharding. |
| Caché | No hay caché de negocio compartida. Las respuestas del helper HTTP usan `no-store` | Caché pública selectiva con claves por tenant/versión, invalidación, TTL y pruebas de aislamiento. Stock, permisos y decisiones de pago continúan verificándose en su autoridad. |

El CDN no debe cachear sesiones, administración, MCP ni respuestas privadas por una regla global. Separar un catálogo público cacheable exige cambiar y probar su contrato de frescura: hoy `no-store` evita fingir que ya existe esa optimización. Si se incorpora caché de datos de Next compartida entre réplicas, implementar también coordinación de invalidación; un directorio local de contenedor no es una caché distribuida. Ver [guía oficial de self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

Los perfiles físico, digital y SaaS se describen en [business-models.md](business-models.md). Son fronteras de extensión para ensamblar capacidades específicas; no implican logística, entrega digital, suscripciones o workers ya desplegados. El dimensionamiento debe incluir esos proveedores y trabajos cuando se implementen.

## Escalado acotado y conexiones

[deploy/enterprise/hpa.yaml](../deploy/enterprise/hpa.yaml) usa `autoscaling/v2`, de 2 a 6 réplicas, CPU objetivo 65% del request, crecimiento limitado y reducción estabilizada. Es una envolvente inicial para ensayar. Requiere API de métricas, requests de CPU correctos y nodos con recursos; el HPA no provisiona esas dependencias. El [procedimiento](../deploy/enterprise/README.md) explica la transferencia de `spec.replicas` al HPA para que GitOps no lo restablezca a 2 en cada release.

La configuración actual `PG_POOL_MAX=5` con máximo HPA 6 y surge 1 requiere hasta 35 conexiones web antes de reservas. Dos pods drenando y cinco conexiones de otros procesos llevan el ejemplo a 50. **Si el presupuesto real disponible es menor, la configuración es incompatible.** El comprobador [check-budget.mjs](../deploy/enterprise/check-budget.mjs) rechaza ese caso, leyendo los manifiestos locales. Las reservas son hipótesis del operador; verificar pods terminando, migradores, workers, pooler y otras aplicaciones. Turso necesita un presupuesto distinto según sus cuotas; el pool PG no lo controla. Los parámetros exactos están en [database.md](database.md).

No aumentar réplicas ante latencia de DB sin identificar el cuello de botella: más pools pueden aumentar espera, locks y fallos. El request de CPU 100m del manifiesto base tampoco es un tamaño recomendado para producción; a 65% dispara el objetivo alrededor de 65m. Medir event loop, CPU throttling, memoria, consultas y cola del pool antes de fijar requests/limits y máximo HPA. El máximo también es un límite de costo.

## Celdas regionales y partición por tenant: diseño futuro

Una celda sería un conjunto de API/workers/base/colas con un grupo acotado de tenants, cuotas y dominio de fallo propios. El código actual filtra por tenant, pero **no implementa directorio tenant→celda, enrutamiento regional, migración entre celdas, replicación multirregión ni escrituras multi-master**.

Para incorporar ese patrón, primero definir residencia de datos y una autoridad de escritura por tenant. Añadir un directorio confiable, llevar la identidad autenticada a la celda correcta y comprobar autorización allí. Diseñar el traslado del tenant con backfill, verificación, corte y rollback; incluir auditoría, idempotencia, consentimiento OAuth y referencias externas. No usar un header que el cliente elija como prueba del tenant. Probar fallos de región y recuperación antes de prometer aislamiento o continuidad.

Las tablas por tenant y los índices actuales facilitan la evolución; no eliminan vecinos ruidosos ni convierten automáticamente una DB en varios shards. Introducir particiones/celdas cuando volumen, residencia o dominio de fallo lo exijan, manteniendo un contrato por módulo. Evitar una expansión indiscriminada de microservicios antes de conocer qué componente necesita independencia.

## Disponibilidad, datos y recuperación

- Acordar SLO, error budget, RPO y RTO por función. Health comprueba el proceso; readiness valida la disponibilidad de dependencias/esquema dentro del alcance documentado. Una respuesta 200 no prueba que la región sobreviva a una caída ni sustituye un recorrido sintético.
- Elegir una base con alta disponibilidad, copias cifradas y recuperación temporal conforme al proveedor/plan. Configurar retención/acceso y **probar restauración en una base aislada**, comprobando relaciones, auditoría e idempotencia. No hay backups ni restauración automatizados por estos archivos.
- Distribuir réplicas y capacidad de reserva por zonas cuando el SLO lo requiera. La afinidad preferida y el PDB del template no garantizan separación por zona ni supervivencia regional. Ensayar pérdida de pod/nodo, caída de DB, degradación de red y límites de proveedor.
- Conservar binario/configuración/activos previos; migraciones append-only y expand/contract compatibles con N−1/N. Rollback de imagen no revierte datos ni efectos externos. Seguir el runbook de producción, con migración one-off antes del tráfico.
- Definir retención/archivo y trabajos acotados para auditoría, eventos e idempotencia; conservar la ventana necesaria para reintentos. No borrar historia para ocultar saturación ni restaurar toda la DB sobre ventas posteriores a una incidencia.

## Telemetría y protección del servicio

El código ya emite logs estructurados y señales de operación, correlación por request ID y exportación OTLP opcional. No se han desplegado collectors, dashboards, alertas ni RUM persistente. La propagación de trazas del navegador y la instrumentación SQL completa no están implementadas; consultar [telemetry.md](telemetry.md) para el alcance exacto.

El entorno enterprise debe reunir y correlacionar señales de estas capas:

| Señal | Decisión operativa |
| --- | --- |
| Tasa/latencia p50/p95/p99 y errores por operación | Identificar degradación real por recorrido, diferenciando rechazo esperado de error inesperado |
| Ready/pending pods, HPA en máximo, métricas ausentes, throttling, memoria y reinicios | Distinguir falta de capacidad, mala configuración y dependencia caída |
| Conexiones/espera del pool, queries lentas, locks/deadlocks, CPU/IO y lag de DB | Revisar consultas/índices, consistencia y presupuesto antes de añadir pods |
| Reintentos/idempotencia, invariantes de stock y conciliaciones | Detectar daño funcional aunque la latencia siga siendo aceptable |
| Errores/timeouts de proveedores y collector, costos y cuotas | Activar degradación controlada, detener carga y preservar presupuesto |
| Edad/profundidad de cola y DLQ, si se implementan | Escalar workers con capacidad de DB disponible y recuperar trabajos sin duplicar efectos |

Usar nombres de operación y códigos acotados como labels. No poner IDs de tenant, usuario, pedido, tokens, cuerpos ni URLs firmadas en métricas; los logs/auditoría tienen políticas de acceso y retención separadas. Muestrear trazas y dimensionar buffers del collector sin hacer que una caída de telemetría bloquee ventas. Una prueba de carga también debe observar pérdidas de señales y el costo del diagnóstico.

Ante tráfico hostil, colocar defensa DDoS/WAF y límites de solicitud/cuerpo/conexión en edge/ingress antes de llegar a Node y DB. Añadir límites por actor/tenant, presupuestos separados de lectura/escritura y reglas de abuso ajustadas a los agentes legítimos. El presupuesto actual de escrituras públicas por tienda en DB no es una defensa DDoS: el tráfico ya llegó al backend y consume recursos. Los controles de sesión, scopes y aislamiento siguen aplicándose después del edge. No se incluye una NetworkPolicy con destinos inventados: diseñar ingress/egress con el CNI y los endpoints reales de DNS, auth, DB, pagos y telemetría, y comprobar que mantiene la operación.

## Evidencia mínima para publicar una capacidad

1. Mantener gates de corrección, aislamiento, idempotencia, telemetría, build y E2E; no sustituirlos por carga. Consultar [verification.md](verification.md) para los resultados locales existentes.
2. Ejecutar [tests/load](../tests/load/README.md) en staging con revisión, datos, infraestructura y parámetros registrados. Es HTTP de lectura; no mide navegador, escrituras, MCP, pagos ni recuperación. Los VUs no son usuarios humanos.
3. Repetir escenarios de caché fría/caliente, distribución desigual entre tenants, crecimiento del dataset y degradación de dependencias. Asegurar que el generador ofreció la tasa planificada y no fue el cuello de botella.
4. Probar aparte escrituras en sandbox: doble reintento, stock disputado, pedido/pago y eventos duplicados/fuera de orden según el módulo. Verificar estado final y auditoría, no solo HTTP 200. Nunca usar ventas reales como prueba de carga.
5. Validar HPA, agotamiento de DB, drenaje durante release, rollback compatible, restauración y fallos de nodo/zona. Registrar costos, saturación y condiciones de interrupción.
6. Publicar únicamente el rango observado para esa mezcla, revisión y entorno, con p95/p99, errores y límites. La documentación actual **no contiene un resultado k6, Docker ni Kubernetes ejecutado que demuestre capacidad**.

Fuentes técnicas oficiales consultadas para las plantillas: [Kubernetes HPA](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/), [Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/), [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [k6 arrival-rate](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/ramping-arrival-rate/) y [thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/). Su documentación no acredita el rendimiento de este template; define cómo operar y medir los componentes elegidos.
