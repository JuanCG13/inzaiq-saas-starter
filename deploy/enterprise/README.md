# HPA de referencia

Este directorio agrega un HPA al Deployment `agentic-ecommerce` de [../kubernetes.yaml](../kubernetes.yaml). **No se ha aplicado a un cluster ni probado bajo carga.** `minReplicas: 2` y `maxReplicas: 6` son un punto de partida limitado, no una promesa de disponibilidad ni capacidad.

## Antes de habilitarlo

1. Seguir [producción](../../docs/production.md): imagen inmutable, Secret existente, base remota, migraciones previas y readiness. Usar el mismo namespace para Deployment, Service, PDB y HPA.
2. Tener `metrics.k8s.io` operativo, normalmente mediante Metrics Server administrado por la plataforma. Confirmar `kubectl top pods` y condiciones del HPA. El HPA no instala métricas ni crea nodos; hacen falta recursos disponibles o un escalador de nodos configurado aparte.
3. Dimensionar CPU/memoria y conexiones con una carga representativa. La meta CPU del 65% se calcula sobre el **request**: con el `100m` del manifiesto base, equivale a unos `65m` por pod, no al 65% del límite de 1 CPU. Ese request es un ejemplo y puede causar escalado demasiado temprano. Mantener requests en todos los contenedores relevantes si se agregan sidecars.
4. Separar la propiedad de `spec.replicas`: con HPA activo, el manifiesto de Deployment gestionado por GitOps **debe omitirlo**. Reaplicar el manifiesto base sin adaptarlo vuelve a imponer 2 réplicas.

Para un Deployment existente gestionado mediante client-side `kubectl apply`, seguir la transición oficial: `kubectl apply edit-last-applied deployment/agentic-ecommerce -n <namespace>`, quitar `spec.replicas` de la configuración previamente aplicada y después del manifiesto de ese entorno. Así se evita la reducción transitoria a una réplica que puede provocar simplemente borrar el campo. Si se usa Server-Side Apply/GitOps, transferir la propiedad del campo siguiendo el mecanismo de esa herramienta. Validar esta transición en staging; no ejecutar estos pasos sobre producción como una copia ciega.

El HPA no reemplaza el Deployment: conservar sus probes, recursos, Secret, afinidad y estrategia `maxUnavailable: 0`, `maxSurge: 1`. Renderizar la configuración final de entorno, revisar su diff y validarla con el API server antes de aplicar. Ejemplo de validación, **sin crear recursos**:

```sh
kubectl apply --dry-run=server -n <namespace> -f deploy/enterprise/hpa.yaml
```

Ese comando requiere acceso al cluster y no se ejecutó durante la preparación del template. La validación YAML local no demuestra compatibilidad con la versión/políticas del cluster.

## Presupuesto de conexiones

Para PostgreSQL/Supabase/Neon, calcular el máximo de conexiones cliente antes de aumentar réplicas:

```text
conexiones necesarias = (HPA máximo + pods de surge + reserva de pods terminando)
                        × PG_POOL_MAX + reserva de otros procesos
```

La aplicación crea un pool por proceso. Con `maxReplicas=6`, `maxSurge=1` y `PG_POOL_MAX=5`, son **35 conexiones** de procesos web activos/surge, antes de reservas. Dos pods terminando y cinco conexiones de otros procesos elevan el ejemplo a **50**. Los pods terminando pueden superar temporalmente el número `réplicas + surge`: medir la duración real de drenaje y ajustar esa reserva, sobre todo ante rollouts sucesivos. La reserva de otros procesos debe incluir migradores, workers, consolas operativas y cualquier instancia fuera de este Deployment. Restar primero del límite del proveedor las conexiones reservadas para administración/replicación y otros servicios. Si los dos templates comparten una DB/pooler, sumar ambos presupuestos.

El comprobador local lee `maxReplicas` del HPA y `maxSurge` del manifiesto base; admite surge entero o porcentaje. No consulta el proveedor ni conoce overlays adicionales. Ejecutarlo sobre los valores finales, pasar el mismo `PG_POOL_MAX` del Secret y recalcular si cambian imagen/procesos/sidecars:

```sh
DB_APP_CONNECTION_BUDGET=50 PG_POOL_MAX=5   DRAINING_POD_RESERVE=2 OTHER_CONNECTION_RESERVE=5   node deploy/enterprise/check-budget.mjs
```

Sale con código `2` si no cabe, `1` si la configuración es inválida y `0` si la aritmética cabe. Un resultado favorable **no valida throughput, límites de un pooler, latencia, cuotas del proveedor ni la exactitud de las reservas**. Con presupuesto disponible 40, el ejemplo de 50 es incompatible: reducir `maxReplicas`/`PG_POOL_MAX` y volver a medir, o ampliar explícitamente la asignación real de DB. No elevar el HPA sin esta revisión. Si hay pooler, validar además sus límites de conexiones cliente y servidor, su modo y la compatibilidad transaccional; no asumir equivalencia 1:1. `PG_POOL_MAX` no controla Turso/libSQL: evaluar sus cuotas, latencia y límites de concurrencia por separado. Ver [base de datos](../../docs/database.md).

## Comportamiento y operación

- Crecimiento estabilizado durante 30 segundos, limitado por la menor variación entre 50% y 2 pods por 60 segundos. Reducción estabilizada durante 300 segundos, limitada por la menor variación entre 25% y 1 pod por 60 segundos. Son valores iniciales que hay que ensayar; no reaccionan instantáneamente a picos.
- Alertar por `ScalingLimited`, ausencia de métricas, pods pendientes/no listos, CPU throttling, memoria, latencia y saturación de DB. No escalar por CPU si el cuello real es DB: más pods pueden empeorarlo. Métricas de cola/RPS requieren un adaptador y SLO medidos; no están incluidas.
- Dos réplicas con afinidad preferida no garantizan dos zonas ni tolerancia a la pérdida de una región. Elegir topología/capacidad por zona y probar interrupciones de nodos. PDB cubre ciertas interrupciones voluntarias, no todas las averías.
- No se incluye NetworkPolicy genérica: inventar egress/ingress puede cortar DNS, base de datos, autenticación, pagos y OTLP. Diseñar políticas por entorno con CNI compatible, resolver los destinos externos reales y probarlas antes de bloquear tráfico.

Fuentes oficiales: [HorizontalPodAutoscaler y transición de replicas](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/), [Deployment y pods terminando](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/). Plan de capacidad y límites: [enterprise.md](../../docs/enterprise.md). Carga reproducible: [tests/load](../../tests/load/README.md).
