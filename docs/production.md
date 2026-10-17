# Producción, actualizaciones y recuperación

Este template está preparado para **publicar imágenes nuevas gradualmente** y cambiar ajustes de negocio autorizados sin reconstruir la aplicación. No modifica código dentro de contenedores en ejecución. Los archivos de despliegue son una base revisable; no se ha verificado continuidad sin cortes en un clúster real ni se ha provisionado infraestructura.

## Elegir el tipo de cambio

| Cambio | Camino | Requiere publicación |
| --- | --- | --- |
| Pausar nuevas ventas o mostrar un aviso | Configuración de la empresa, con permisos y versión | No; se guarda en la base y se consulta desde la interfaz |
| Producto, precio, existencias | UI o herramienta MCP del dominio | No; conserva validación, auditoría e idempotencia |
| Marca compilada, idiomas y moneda predeterminada (`template.config.ts`), textos de `src/i18n/messages`, código, dependencias o contrato | Rama, pruebas, imagen inmutable y despliegue gradual | Sí |
| Esquema de datos | Migración nueva compatible, ejecutada una sola vez antes de dar tráfico a la nueva versión | Sí, con procedimiento de datos |

Los ajustes `acceptingOrders`, `notice` y `version` son persistentes por empresa. Pausar pedidos impide crear nuevas operaciones; no cancela ventas, no desconecta usuarios y no sustituye el retiro de un pod del balanceador. La interfaz consulta cambios periódicamente y al recuperar el foco; el servidor decide si puede aceptar cada escritura. Los cambios de configuración del proceso o secretos inyectados por variables de entorno requieren sustituir los pods.

## Artefactos de este repositorio

- `Dockerfile`: imagen Node 24/Next standalone, usuario sin privilegios, proceso Node como PID 1 y puerto interno **3000**. El POS puede mapear externamente `3001:3000`.
- Target Docker `migrations`: herramientas y código de la misma revisión para trabajos de migración aislados. No forma parte del arranque web.
- `.dockerignore`: excluye `.env`, bases locales, llaves, dependencias y resultados locales.
- `deploy/kubernetes.yaml`: Deployment con dos réplicas, Service interno y presupuesto de disrupción. Referencia un **Secret existente**; no incluye credenciales ni crea un proveedor.
- `docs/agent-workflow.md`: contrato de cambios por agentes y evidencia necesaria para promoción.

El manifiesto es un ejemplo de Kubernetes, no una obligación de usar Kubernetes. En VPS se puede aplicar el mismo esquema con dos grupos de contenedores y un proxy. Se necesitan capacidad para la versión anterior y la nueva, base compartida, readiness, drenaje y activos compatibles; reiniciar un único proceso no equivale a una actualización continua.

## Preparación del entorno

1. Elegir PostgreSQL remoto (Supabase/Neon/PostgreSQL) o Turso/libSQL remoto. **No usar SQLite local con réplicas independientes**: cada pod tendría una base distinta; un volumen compartido tampoco convierte SQLite en una solución de escritura multinodo.
2. Configurar HTTPS, proxy/ingress y límites de solicitudes. No almacenar en caché respuestas de autenticación, API, MCP ni contenido privado. Permitir streaming en MCP y respetar `Cache-Control`; no introducir un caché público de HTML autenticado.
3. Crear el Secret `agentic-ecommerce-runtime` mediante el gestor de secretos de la instalación. Contiene las variables de `.env.example` necesarias para el proveedor, URLs HTTPS, `BETTER_AUTH_SECRET` y tenant público si corresponde. Las claves de proveedores/pagos/telemetría permanecen solo del lado servidor. Nunca insertar secretos en la imagen, repositorio, argumentos de build o variables `NEXT_PUBLIC_*`.
4. Mantener **el mismo secreto de autenticación y la misma base de sesiones** en todas las réplicas y durante la coexistencia de versiones. Una rotación requiere un plan propio; cambiarlo como efecto secundario de cada publicación invalida sesiones/tokens.
5. Configurar y ensayar backup/restauración, alertas y acceso del operador. Medir capacidad y límites del proveedor con la base de staging.
6. Elegir namespace, registro, digest de imagen e ingress del manifiesto. El hostname y la imagen de ejemplo no son una instalación ejecutable sin estas decisiones. La afinidad entre nodos es una preferencia; no garantiza distribución ni supervivencia a la pérdida del único nodo.

### Presupuesto de conexiones

La fábrica PostgreSQL utiliza por defecto un pool de **5 conexiones por proceso**, configurable mediante `PG_POOL_MAX` o `createDatabase({ maxConnections })`. `PG_CONNECTION_TIMEOUT_MS` y `PG_IDLE_TIMEOUT_MS` controlan espera de conexión e inactividad; [límites y validación](database.md). Con dos pods y `maxSurge: 1` puede haber tres procesos, aproximadamente 15 conexiones de aplicación, más las de migración, tareas y otras instancias. Calcular el presupuesto completo antes de elevar réplicas o activar autoscaling. Usar la URL agrupada del proveedor para runtime y una conexión directa/de sesión para migraciones. Los límites y comportamiento de Turso se validan aparte; no hereda el pool `pg`.

## Construir una sola vez

Desde el commit revisado, con Docker BuildKit y sin `.env.local` productivo en el checkout:

```bash
RELEASE_SHA=$(git rev-parse HEAD)
APP_IMAGE="registry.example.com/your-team/agentic-ecommerce:${RELEASE_SHA}"
MIGRATION_IMAGE="registry.example.com/your-team/agentic-ecommerce-migrations:${RELEASE_SHA}"
ASSET_PREFIX="https://assets.example.com/agentic-ecommerce/${RELEASE_SHA}"

docker build --target runner   --build-arg DEPLOYMENT_VERSION="$RELEASE_SHA"   --build-arg NEXT_ASSET_PREFIX="$ASSET_PREFIX"   -t "$APP_IMAGE" .
docker build --target migrations -t "$MIGRATION_IMAGE" .
```

Los dominios/registro del ejemplo deben sustituirse. Fijar `NODE_IMAGE` a un digest revisado para reproducibilidad de la imagen base; el valor predeterminado es una etiqueta de Node 24 Debian. El lockfile fija paquetes. Construir para la arquitectura de destino, analizar la imagen y conservar su digest/SBOM según la plataforma. Promover **el mismo digest** de staging a producción; no recompilar por pod.

`DEPLOYMENT_VERSION` y `NEXT_ASSET_PREFIX` se resuelven durante el build mediante `next.config.ts`. Cambiarlas únicamente en el entorno del contenedor no reescribe los bundles. Las variables `NEXT_PUBLIC_*` también quedan embebidas durante compilación. `DATABASE_URL`, secretos y otras opciones del servidor se entregan al proceso al arrancar.

Para una comprobación aislada con una base de staging ya migrada:

```bash
docker run --rm --env-file /secure/staging-runtime.env   -p 3000:3000 "$APP_IMAGE"
```

Este comando no reemplaza el balanceador ni prueba coexistencia de versiones. El contenedor usa `/api/health` para su HEALTHCHECK; comprobar además `/api/readiness` y un recorrido autenticado real.

### Activos y clientes de versiones anteriores

Antes de enviar tráfico al nuevo build, publicar su `.next/static` bajo **`$ASSET_PREFIX/_next/static/`** en almacenamiento/CDN controlado. Conservar los activos de las revisiones anteriores durante toda la ventana de rollback y vida de los clientes abiertos. Se puede extraer el directorio de la imagen sin ejecutar la aplicación:

```bash
ASSET_CONTAINER=$(docker create "$APP_IMAGE")
docker cp "$ASSET_CONTAINER:/app/.next/static" ./release-static
docker rm "$ASSET_CONTAINER"
```

La carga a CDN depende del proveedor y debe comprobar permisos, rutas, cabeceras y que los JS/CSS responden antes de promocionar. Usar nombres versionados para `public/` cuando cambie su contenido; `assetPrefix` no reescribe automáticamente esos archivos. No publicar `.next/server`, fuentes ni secretos como activos. Si no hay CDN, configurar en el proxy un almacén compartido que conserve las rutas inmutables de todas las revisiones soportadas; servir solo el directorio estático del pod que reciba la petición no basta durante una transición.

`deploymentId` detecta una navegación que mezcla versiones y puede provocar una recarga completa. No es una garantía de conservación del estado local ni un router hacia pods antiguos. Probar explícitamente una pestaña vieja con un carrito sin confirmar y una operación pendiente mientras cambia la versión. No forzar una recarga durante un cobro; mantener contratos compatibles y reintentos con su clave original. La aplicación no garantiza persistencia de todos los formularios/carritos en memoria al recargar.

Actualmente las mutaciones usan HTTP, no Server Actions. Si se agregan Server Actions, suministrar una clave estable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` durante build para las réplicas y versiones coexistentes, mediante el secret BuildKit `next_server_actions_key`. El Dockerfile admite ese montaje; no usar ARG/ENV versionados para la clave. Conservar también la compatibilidad de funciones y probar clientes anteriores; una clave compartida por sí sola no recupera funciones eliminadas.

Los datos comerciales se obtienen desde APIs dinámicas. Si un módulo incorpora ISR o `'use cache'`, debe diseñar caché compartido e invalidación entre réplicas antes de publicar. El `emptyDir` de `.next/cache` del manifiesto es local al pod, no un caché distribuido.

### Idioma, redirecciones y `public/`

Las páginas viven bajo un prefijo de idioma (`/en/...`, `/es/...`) y `src/proxy.ts` responde `307` a una URL de página sin prefijo, con `Vary: Accept-Language, Cookie` y `Cache-Control: private, no-store`, porque el destino depende del visitante. En el proxy inverso o CDN:

- No almacenar esa redirección en una caché compartida y reenviar `Cookie` y `Accept-Language` al origen; si el borde los elimina, todas las URL sin prefijo caen en el idioma predeterminado.
- No redirigir ni reescribir `/api/*`, `/_next/*` ni `/.well-known/*`. El proxy de idioma ya las excluye junto con cualquier ruta que contenga un punto; las sondas `/api/health` y `/api/readiness`, MCP, OAuth y los webhooks de pago usan esas rutas.
- Seguir sin cachear HTML autenticado. Las páginas con prefijo son URL por idioma; esta guía no define una política de caché pública para ellas.
- El idioma predeterminado y los idiomas ofrecidos están compilados: cambiarlos es una imagen nueva, no un ajuste en caliente.

Los archivos de `public/` (por ejemplo las ilustraciones `public/demo/*.svg`) los copia el Dockerfile a la imagen y se sirven desde el origen de la aplicación en `/demo/...`, sin hash de contenido; `assetPrefix` no los reescribe. Al sustituir las imágenes de demostración por activos del cliente, usar nombres nuevos (ver arriba) para no servir una versión antigua desde una caché.

La primera publicación con prefijos de idioma cambia las URL de página (`/cart` pasa a `/en/cart`). Una versión nueva redirige las URL antiguas, incluidas las URL de retorno de Stripe ya enviadas y las de OAuth, que se guardan sin prefijo. Una versión anterior no conoce `/en/...`: durante la convivencia N−1/N o un rollback, una URL con prefijo que llegue a un pod anterior no tiene ruta allí. Ensayarlo en staging con ambas versiones, igual que el resto de la transición; no se ha medido en un clúster real.

## Migraciones sin romper la versión anterior

Aplicar **expandir → migrar datos → cambiar lecturas/escrituras → retirar** en entregas separadas:

1. **Expandir:** agregar tablas, columnas opcionales o estructuras con valores compatibles. Crear un archivo de migración nuevo; nunca editar o reordenar una migración ya aplicada.
2. **Compatibilidad:** demostrar que N−1 y N pueden leer y escribir sobre el esquema expandido. Revisar también el esquema generado por Better Auth, plugins y el contrato HTTP/MCP.
3. **Migrar datos:** ejecutar backfills por lotes, con progreso durable, límites y reintentos seguros. Estimar bloqueos y tamaño de tablas; operaciones que bloquean escrituras necesitan otra estrategia o una ventana comunicada.
4. **Cambiar:** publicar el código nuevo y observar. Si se requiere escritura doble, definir el campo de verdad y cómo reparar diferencias antes de activar las nuevas lecturas.
5. **Retirar:** borrar/renombrar columnas, retirar campos API o hacer restricciones más estrictas solo cuando no haya pods/clientes antiguos compatibles pendientes y la ventana de rollback haya concluido. Esta fase es otra entrega, no parte de la primera expansión.

Serializar releases y ejecutar las migraciones **una sola vez** con una cuenta de servidor autorizada. No colocarlas en `CMD`, `initContainer` de cada réplica ni endpoint de solicitud. Utilizar el target `migrations` de la misma revisión y un archivo protegido con la conexión directa/de sesión:

```bash
docker run --rm --env-file /secure/migration.env   "$MIGRATION_IMAGE" npm run db:migrate

# Revisar el SQL de autenticación antes de aplicarlo.
docker run --rm --env-file /secure/migration.env   "$MIGRATION_IMAGE" node --import tsx scripts/auth-migrate.ts

docker run --rm --env-file /secure/migration.env   "$MIGRATION_IMAGE" npm run auth:migrate
```

En Kubernetes ejecutar estas mismas órdenes en un Job de una sola ejecución, con Secret de migración separado y sin reintentos ciegos después de un resultado incierto. Esperar y revisar su resultado antes de modificar el Deployment. Capturar la revisión aplicada. El migrador de auth puede proponer cambios distintos al actualizar plugins; revisar el SQL generado y su compatibilidad, no asumir que toda actualización es aditiva.

La readiness actual comprueba la configuración de autenticación, que el registro `commerce_migrations` contenga **todos los identificadores de migración requeridos por esta revisión** y que existan las tablas del esquema de autenticación. Las consultas también comprueban acceso a la base; no se limita a un `SELECT 1`. Acepta migraciones adicionales desconocidas para permitir expansiones compatibles mientras conviven versiones. **No inspecciona todas las columnas ni detecta cambios manuales del esquema**: si se modifica una tabla o columna por fuera del migrador, se necesita una validación de integridad adicional. Cualquier cambio incompatible exige un plan de transición explícito. Comprobar el comportamiento con una base atrasada, expandida y no disponible. En ecommerce también valida la configuración local del proveedor de pagos seleccionado; esa comprobación no llama al proveedor ni confirma que sus credenciales funcionen remotamente.

## Publicar gradualmente

1. Obtener evidencia del commit exacto: tipos, suite de dominio/seguridad/telemetría y build mediante `npm run verify`; E2E mediante `npm run test:e2e` en su checkout aislado. La CI existente separa verificación y navegador; ninguna automatiza el despliegue.
2. En staging, construir/arrancar la imagen, comprobar sus archivos standalone/native bindings, secretos, HTTPS, OAuth y proveedor remoto elegido. Ejecutar el recorrido de venta/cancelación y los pagos habilitados con el modo de prueba del proveedor.
3. Ensayar una actualización N−1→N con ambas versiones recibiendo tráfico: venta concurrente, replay idempotente, cambio de tenant, cliente antiguo, rechazo de esquema incompatible y terminación durante solicitudes en vuelo. Registrar errores/latencia antes y durante la transición.
4. Guardar digest anterior, configuración, revisión de esquema, punto de restauración y condiciones de rollback. Aplicar migraciones compatibles y publicar activos nuevos antes de cambiar tráfico.
5. Revisar los cambios de manifiesto y actualizar la imagen. Ejemplo de comandos para el operador autorizado; no se han ejecutado al crear este template:

```bash
kubectl --namespace commerce diff -f deploy/kubernetes.yaml
kubectl --namespace commerce apply -f deploy/kubernetes.yaml
kubectl --namespace commerce set image deployment/agentic-ecommerce   app="registry.example.com/your-team/agentic-ecommerce@sha256:REPLACE_WITH_VERIFIED_DIGEST"
kubectl --namespace commerce rollout status deployment/agentic-ecommerce --timeout=10m
```

Antes de aplicar, sustituir la imagen de ejemplo del manifiesto por el digest deseado; no aplicar primero una imagen inexistente en una instalación viva. Usar un único mecanismo declarativo/GitOps cuando exista, para no competir con cambios imperativos. El ejemplo de `set image` es una alternativa para instalaciones administradas directamente.

`maxUnavailable: 0`, `maxSurge: 1` y dos réplicas mantienen los pods anteriores mientras los nuevos no pasan readiness, si hay capacidad para el pod adicional. No cubren una caída de base, un esquema incompatible ni falta de recursos. La startup probe permite el arranque; liveness detecta proceso no saludable; readiness decide si recibe tráfico. Un fallo de base no debe provocar una tormenta de reinicios por liveness.

El `preStop` espera 10 segundos para propagación del retiro de endpoints; luego Node recibe SIGTERM. El margen total es 45 segundos. Ajustar esos tiempos, el proxy y los límites de solicitud según mediciones; no matar el proceso con SIGKILL ni cerrar conexiones antes de que terminen operaciones en vuelo. MCP usa transporte sin sesiones en memoria, pero eso no elimina solicitudes en vuelo. El PodDisruptionBudget limita desalojos voluntarios; no garantiza disponibilidad durante fallas físicas.

6. Observar readiness, errores HTTP/MCP, latencia, pool, transacciones, ventas y webhooks si están habilitados. Comparar con la línea base y confirmar el recorrido de negocio desde UI y agente. Solo después dar por completada la publicación.

## Volver a una revisión anterior

Detener la promoción si fallan readiness, autorización, invariantes de dinero/stock, activos viejos, pagos o la latencia acordada. Capturar referencias de error y versión sin datos personales.

```bash
kubectl --namespace commerce rollout pause deployment/agentic-ecommerce
# Tras comprobar compatibilidad del esquema con el digest anterior:
kubectl --namespace commerce set image deployment/agentic-ecommerce   app="registry.example.com/your-team/agentic-ecommerce@sha256:PREVIOUS_VERIFIED_DIGEST"
kubectl --namespace commerce rollout resume deployment/agentic-ecommerce
kubectl --namespace commerce rollout status deployment/agentic-ecommerce --timeout=10m
```

`rollout undo` también recupera una revisión de Deployment, pero no restaura bases, activos, servicios externos ni necesariamente la configuración de Secret. Conservar revisiones exactas de todo lo necesario. Mantener el esquema expandido compatible y el secreto de sesión estable durante el retorno.

**No ejecutar migraciones `down` automáticamente.** Volver al binario anterior no deshace ventas, cargos, webhooks ni datos escritos por la versión nueva. Si hubo corrupción, la decisión es reparación hacia delante o recuperación controlada desde backup/PITR con reconciliación de operaciones posteriores; restaurar una copia sin esa reconciliación puede perder ventas o duplicar efectos externos. No reintentar cargos o stock con claves nuevas para “reparar” un resultado desconocido.

La preparación del repositorio no demuestra disponibilidad sin cortes. Antes de comprometer un SLA, conservar evidencia de la imagen real, base remota, balanceador, carga, clientes N−1/N y rollback en la instalación elegida.

## Referencias

Documentación oficial contrastada con Next **16.4.2** instalado en `node_modules/next/dist/docs/`:

- [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [Salida standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [Secretos de build Docker](https://docs.docker.com/build/building/secrets/)
- [Rolling updates Kubernetes](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Startup, liveness y readiness](https://kubernetes.io/docs/concepts/workloads/pods/probes/)
