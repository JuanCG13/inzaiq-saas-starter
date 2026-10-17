# Añadir una funcionalidad sin rehacer el sistema

Este documento es la receta de extensión para agentes. `template.manifest.json` es un índice de navegación y dependencias: **no carga plugins, genera código ni aplica permisos automáticamente**. La implementación y las pruebas siguen siendo necesarias.

Para adaptar el negocio a entrega física, contenido digital o SaaS, leer [modelos de negocio](business-models.md) y `src/extensions/contracts.ts`. Los puertos y perfiles son contratos; no incluyen adaptadores logísticos, almacenamiento, Billing ni workers funcionales. Reutilizar los helpers de contexto/dinero/referencia sin tratarlos como autenticación o prueba de pago.

El ejemplo propuesto es un módulo de **clientes** con alta y consulta desde administración y MCP. **No está implementado ni habilitado por esta guía.** Se elige una primera entrega pequeña: crear un registro y encontrarlo después. Asociar clientes a pedidos, importar contactos o enviar mensajes son entregas posteriores con sus propios contratos. No modificar el checkout para completar esta primera entrega.

## 1. Definir una entrega verificable

Antes de editar, anotar el recorrido, actores, entradas, resultado observable, rechazo esperado y archivos que tocará cada agente. Para el ejemplo:

| Decisión | Primera entrega propuesta |
| --- | --- |
| Recorrido | Owner/admin crea un cliente; aparece en la lista de su empresa desde UI y MCP |
| Contrato | `createCustomer(actor, input)` y `listCustomers(actor, options)`; DTO explícito sin campos internos de autenticación |
| Autorización | Owner/admin y scopes `customers:read` / `customers:write` cuando el actor sea OAuth |
| Datos | ID opaco, tenant, nombre y contacto limitado a lo realmente requerido; sin datos de pago |
| Reintentos | Alta con clave idempotente persistente; misma clave y mismos datos devuelve el registro original; datos distintos producen conflicto |
| Límites | Longitudes de campos, tamaño de página y máximo de cuerpo definidos antes de exponer la operación |
| Exclusiones | Sin importación masiva, campañas, borrado, acceso público ni relación con pedidos en esta entrega |

Leer los contratos de las dependencias y buscar la operación equivalente con `rg` antes de diseñar otra abstracción. Usar la documentación oficial de las versiones instaladas, incluido `node_modules/next/dist/docs/`. No instalar una biblioteca por una operación que ya cubren Kysely, Zod, Better Auth o el transporte existente.

## 2. Localizar las piezas y asignar propietarios

| Responsabilidad | Referencia existente | Archivo propuesto para clientes |
| --- | --- | --- |
| DTO y errores | `src/core/contracts.ts`, `src/runtime/contracts.ts` | `src/customers/contracts.ts`; reutilizar `Actor` y `AppError` |
| Reglas y transacciones | `src/runtime/service.ts`, `src/core/service.ts` | `src/customers/service.ts` |
| Composición de dependencias | `src/runtime/server.ts` | `src/customers/server.ts` |
| Persistencia tipada | `src/db/schema.ts` | Añadir la tabla al tipo `Database` |
| Migración | `src/db/migrations/003-runtime.ts`, `src/db/migrate.ts` | Nueva migración con el siguiente identificador disponible; registrar sin reescribir las anteriores |
| HTTP | `src/lib/http.ts`, `src/app/api/admin/settings/route.ts` | `src/app/api/admin/customers/route.ts` |
| Identidad y scopes | `src/lib/request-actor.ts`, `src/lib/actor.ts`, `src/lib/auth.ts` | Reutilizar resolución del actor; registrar los nuevos scopes |
| MCP | `src/lib/mcp.ts` | Registrar `customers_list` / `customers_create` con esquema y filtros de rol, scope y módulo |
| UI | `src/lib/api-client.ts`, `src/components/admin-workspace.tsx` | Componente de clientes y entrada en el workspace; el componente solo llama HTTP |
| Pruebas | `tests/runtime-settings.test.ts`, `tests/runtime-settings-http.test.ts`, `tests/mcp-tools.test.ts` | Pruebas del módulo y su recorrido en `tests/e2e/` |

Los archivos compartidos —schema, migraciones, auth, MCP, manifest y navegación— deben tener un solo responsable durante una colaboración. Los demás agentes entregan sus contratos o cambios acotados al responsable. No refactorizar todo `src/core` para añadir un módulo aislado.

## 3. Implementar el servicio antes de los adaptadores

1. Crear contratos explícitos y `createCustomerService(db, options)`. Inyectar Kysely y el hook de telemetría; no guardar tenant, actor o solicitud en variables globales. Los métodos reciben un `Actor` verificado.
2. Validar de nuevo en el servicio: un llamador interno o MCP no depende de la validación HTTP. Rechazar campos desconocidos en mutaciones y devolver errores normalizados. Ningún campo `tenantId` del cuerpo concede privilegios.
3. Comprobar rol **y** scope en cada método. `scopes === undefined` representa sesión propia; `scopes: []` no concede nada. Los helpers privados de `src/core/service.ts` no son APIs reutilizables: seguir el patrón existente o extraer un helper pequeño y probado solo cuando varios módulos lo necesiten.
4. Diseñar `commerce_customers` con `tenant_id`, claves e índices adecuados. Todo acceso filtra por tenant; una relación futura usará claves foráneas compuestas por tenant/recurso. Añadir default-deny RLS para PostgreSQL en el registro de migraciones. RLS no sustituye los filtros del backend propietario de las tablas.
5. Persistir recurso, resultado/huella de idempotencia y auditoría en la misma transacción. Reutilizar el patrón de `commerce_stock_operations` o el del dominio; no crear deduplicación en memoria. No incluir nombre, email ni cuerpo del formulario en audit/diagnóstico. Una falla de auditoría debe revertir el alta.
6. Para una edición posterior, exigir versión actual y hacer actualización condicional; no implementar “última escritura gana”. Para una integración externa, persistir primero su intento y una clave estable, llamar fuera de la transacción y reconciliar el resultado. La integración de pagos muestra ese patrón, pero no debe importarse para un alta de clientes sin efectos externos.

## 4. Conectar HTTP, MCP y UI con la misma regla

- HTTP: usar `requestActor(request)`, `route` y `jsonBody`. La ruta conserva comprobación de origen, límite de cuerpo, errores seguros y correlación. Parsear Zod, llamar al servicio y devolver solo el DTO. No duplicar la transacción en la ruta.
- MCP: añadir scopes en `MCP_SCOPES` de `src/lib/auth.ts`, etiquetas de consentimiento donde correspondan y filtros de disponibilidad en `src/lib/mcp.ts`. Registrar herramientas estrechas con schemas explícitos; las escrituras usan la confirmación existente. Una herramienta oculta no reemplaza la autorización del servicio. Las conexiones previas necesitan consentimiento para scopes nuevos; nunca ampliarlos silenciosamente.
- UI: usar `api()` para conservar request ID y `no-store`. Presentar carga, vacío, éxito y error; conservar la clave idempotente al reintentar el mismo alta. Tras un conflicto de versión, recargar/revisar, sin forzar cambios. Probar teclado y pantalla pequeña. El contacto nunca se guarda en telemetría o localStorage solo por comodidad.
- Módulo: registrar `customers` en `template.manifest.json` con sus rutas reales y `requires: ["auth", "telemetry"]` una vez implementado. Añadir `catalog`, `orders` u otra dependencia solo si se utiliza de verdad. Si se ofrece desactivación, ampliar el tipo/valor de `src/template.config.ts`, el control HTTP, el filtro MCP y la navegación; agregar comprobación de dependencias en `scripts/doctor.ts`. El manifest no realiza ese trabajo por sí solo.

Los ajustes runtime actuales solo admiten aviso y pausa. No usarlos como almacenamiento de código, objetos arbitrarios, contactos, secretos o configuración monetaria. Un módulo nuevo se publica como código versionado.

## 5. Mantener el costo acotado al crecer

Listar con límite y orden estables; crear índices que comiencen por tenant y sirvan al filtro/orden real. Para recorridos grandes, diseñar paginación por cursor y probar su continuidad; no traer todos los clientes para filtrarlos en JavaScript. Evitar consultas por fila y comprobar el plan de la consulta cuando haya volumen representativo.

Los servicios deben poder ejecutarse en varias réplicas: estado duradero, idempotencia y límites compartidos en la base; sin locks o colas únicamente en memoria para garantizar integridad. No mantener transacciones SQL abiertas durante llamadas de red. Acotar timeouts, reintentos y tamaño de lote; reintentar solo fallos transitorios conocidos después de rollback.

Reutilizar el pool de `getDatabase()` por proceso y presupuestar conexiones totales por réplicas/workers, siguiendo [producción](production.md). Usar PostgreSQL o libSQL remoto cuando la aplicación se distribuya; un archivo SQLite local no es una base compartida entre pods. No añadir Redis, colas o microservicios hasta que una carga, duración o dependencia concreta lo justifique. Si se requiere un worker, primero definir persistencia, idempotencia, permisos, cancelación y observabilidad; no fingir que un `setTimeout` es una cola durable.

## 6. Probar comportamiento y observabilidad

| Caso de aceptación | Evidencia mínima |
| --- | --- |
| Alta y lectura | Registro persistido tras crear otra instancia del servicio; visible desde el recorrido UI/MCP |
| Aislamiento | Otra empresa no puede listar, leer ni modificar el registro con su ID |
| Permisos | Roles, scopes vacíos/insuficientes, consentimiento revocado y módulo desactivado rechazan donde corresponda |
| Reintento/concurrencia | Misma alta no se duplica; clave con datos distintos y edición obsoleta rechazan |
| Atomicidad | Falla de auditoría o dependencia revierte los cambios que deben ser atómicos |
| Datos y consulta | Campos/límites rechazados, paginación estable, constraints e índices comprobados en SQLite y PostgreSQL WASM |
| Diagnóstico | Outcome y duración seguros, mismo request ID de UI a API, sin contactos; sink caído no rompe el negocio |
| Compatibilidad | Versión anterior funciona sobre esquema expandido; datos nuevos no impiden rollback del binario |

Usar `commerce.operation.completed` y el envelope actual para los resultados del servicio, con nombres de operación estables. Las rutas reutilizan `withOperation`/`emitEvent`; la UI hereda `ui.request.completed`. Si se añade otra señal, documentar qué decisión explica. No emitir IDs/contactos como labels de métricas. Registrar una excepción inesperada en la frontera responsable y no duplicarla en cada capa.

Ejecutar primero las pruebas dirigidas al riesgo nuevo. Cuando pasan, correr `npm run verify` sobre el candidato integrado y `npm run test:e2e` para cambios del recorrido. `npm run doctor` verifica configuración/esquema en el entorno autorizado; SQLite/PGlite y respuestas simuladas no prueban un proveedor cloud. Consultar [telemetría](telemetry.md) y [flujo de agentes](agent-workflow.md).

## 7. Migrar, desplegar y entregar

1. **Expandir:** nueva migración aditiva; tablas/columnas compatibles con N−1 y N. Registrar el identificador y RLS en `src/db/migrate.ts`; actualizar requisitos de `src/lib/readiness.ts` cuando el código dependa de la nueva migración. Nunca migrar por solicitud o desde cada réplica.
2. **Rellenar si hace falta:** proceso separado, reiniciable, por lotes acotados y con progreso duradero. No bloquear el arranque con una conversión masiva. Definir cómo conviven las escrituras viejas/nuevas mientras dura.
3. **Cambiar:** probar en staging la imagen inmutable, schema expandido, readiness, clientes N−1/N y recorrido. Aplicar expansión una vez con el operador autorizado; desplegar N y observar errores, latencia y resultados. Conservar digest/configuración/activos anteriores. No cambiar código dentro de contenedores vivos.
4. **Volver si falla:** retirar N y restaurar el digest anterior compatible. No deshacer automáticamente esquema ni borrar los datos escritos; reparar hacia delante cuando sea necesario. Una pausa comercial no drena pods ni detiene todas las escrituras.
5. **Contraer después:** retirar columnas/lecturas antiguas solo tras terminar backfill, retirar consumidores N−1 y cerrar la ventana de rollback. Es otra migración y otra entrega revisada.

Entregar el cambio con alcance, contrato, archivos propios, dependencias, identificador de migración, comandos/resultados, pasos UI de aceptación, límites externos no comprobados y rollback. Actualizar documento del módulo, manifest, versión, CHANGELOG y referencia del README. Los gates, permisos o pruebas nunca se desactivan para acelerar la entrega. Ver [producción](production.md) para promoción y [PR template](../.github/PULL_REQUEST_TEMPLATE.md) para el registro de evidencia.
