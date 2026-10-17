# Adaptar el template a físicos, digitales o SaaS

La base ya tiene catálogo, inventario, pedidos, identidad por empresa, auditoría, MCP y ajustes operativos. Ecommerce incluye pago manual y Stripe Checkout de pago único. **No incluye entregas por transportista, archivos protegidos, licencias, suscripciones, una cola durable ni un outbox implementado.** Tampoco tiene certificación de capacidad empresarial o de millones de usuarios.

`src/extensions/contracts.ts` aporta interfaces TypeScript de integración y helpers ejecutables de validación. `extensionProfiles` en el manifest es un índice declarativo: seleccionar un perfil no instala servicios, crea tablas ni habilita cobros. Todos los perfiles figuran como `contract-only` porque aún necesitan adaptadores, persistencia y recorridos completos.

## Qué reutilizar y qué implementar

| Perfil | Base reutilizable | Integración que falta | Puerto disponible |
| --- | --- | --- | --- |
| Físicos con entrega | Catálogo/SKU, stock, pedido e importe confirmado, pago y auditoría | Direcciones, paquetes, cotización, transportista, entregas parciales, devoluciones y conciliación logística | `FulfillmentProvider` |
| Digitales | Identidad, pedido, pago único, auditoría | Comprador autenticado, derechos por recurso, almacenamiento privado, descargas autorizadas, revocación | `EntitlementProvider` |
| SaaS de nicho | Empresa/usuarios/roles, permisos de agentes, administración y telemetría | Producto del nicho, Billing, planes, suscripciones, derechos, cuotas y recuperación de cobros | `SubscriptionProvider` + `EntitlementProvider` |

Elegir una entrega completa y pequeña siguiendo [extensión](extending.md). Un catálogo digital no debe simular stock infinito incrementando existencias. Un plan SaaS no debe usar decrementos de inventario ni pedidos de pago único para representar renovaciones; definir el modelo comercial correspondiente mediante migraciones aditivas.

## Contratos y frontera de confianza

- `createIntegerMoney` conserva importes enteros en unidades menores y moneda mayúscula del contrato de `Order`. No convierte monedas ni valida la disponibilidad comercial de cada proveedor. Impuestos/envío/descuentos deben formar parte del total canónico antes de cobrar.
- `createExtensionContext` valida y copia un `Actor` ya verificado junto con operación, clave idempotente y request ID. Congela también los scopes; conserva la diferencia entre scopes ausentes y vacíos. **Validar forma no autentica ni autoriza.** El servicio debe comprobar membresía actual y rol∩scope antes de invocar un proveedor.
- `createOrderReference` rechaza tenant distinto y copia únicamente ID, tenant e importe. No incluye contacto ni estado mutable. No acredita pago: cargar el estado persistido y verificar elegibilidad justo antes de conceder derechos o despachar.
- Las referencias `TenantResourceReference`/`ProviderResourceReference` se resuelven desde vínculos persistidos del tenant. Comprobar también todas las referencias anidadas; un ID del proveedor enviado por el cliente no prueba propiedad. El verificador de webhook debe comprobar firma/cuerpo original y luego vincular evento, cuenta y recurso.
- `AsyncProviderResult` distingue terminado, pendiente y conciliación necesaria. Aceptar un trabajo no significa que la entrega o revocación terminó. Persistir el identificador de operación y consultar/reconciliar con límite y backoff. El adaptador debe validar URLs, fechas y estados externos; las interfaces no realizan esa validación automáticamente.

Las credenciales permanecen en el gestor de secretos. No serializar `ExtensionContext` completo en jobs ni tratar sus scopes guardados como autorización permanente. Un worker debe reconstruir el contexto autorizado según la política actual o usar una identidad de servicio con permisos explícitos; nunca inventar un owner para saltar verificaciones.

## Físicos: entrega verificable

Usar un transportista o agregador que cubra la zona del cliente; por ejemplo, [EasyPost documenta webhooks](https://docs.easypost.com/docs/webhooks) para recibir eventos de sus recursos. El enlace describe una opción de integración, no un proveedor configurado ni una garantía de cobertura comercial.

Primera entrega: un paquete por pedido, una cotización elegida y una dirección validada. Persistir cotización/servicio, costo aprobado, vínculo tenant/pedido/transportista y estados. `dispatch` recibe la referencia de cotización persistida; el contrato no implementa la cotización. Definir primero cómo incorporarla al total del pedido, con moneda compatible y vencimiento. Crear etiquetas o envíos con clave estable fuera de la transacción SQL; persistir intento y resultado para recuperar timeouts sin duplicar despachos.

Verificar el webhook según el mecanismo del proveedor y deduplicar sus eventos antes de cambiar estado. Admitir retrasos, duplicados y orden distinto; un evento antiguo no debe deshacer una entrega confirmada. El método opcional `cancel` solo existe si el proveedor lo admite. Cancelar una etiqueta, interceptar un paquete, devolver mercancía y reembolsar dinero son operaciones distintas. No reponer inventario hasta la devolución física según la política acordada. Datos de dirección y contacto se envían únicamente al proveedor necesario y no a logs/audit/job payloads.

## Digitales: derecho primero, URL después

Mantener los objetos en almacenamiento privado. Tras comprobar pago/derecho, registrar una concesión ligada a tenant, comprador y recurso con clave idempotente. En cada solicitud de descarga, autenticar comprador, verificar pertenencia y vigencia, resolver internamente el objeto y emitir una URL breve; nunca aceptar un bucket/key arbitrario desde el navegador.

Las [URLs prefirmadas de S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) conceden acceso temporal con los permisos de quien firma; pueden reutilizarse hasta vencer y pueden expirar antes si vencen las credenciales. Por eso no son un mecanismo de “un solo uso”. No registrarlas en telemetría ni enviarlas a un CDN público. Revocar un derecho impide emitir nuevas URLs, pero no garantiza invalidar inmediatamente enlaces ya emitidos: usar expiración corta o una descarga mediada si el negocio requiere revocación inmediata.

El checkout actual permite datos de contacto sin crear una identidad de comprador. Para contenido protegido, implementar una cuenta o un procedimiento de reclamación verificado antes de otorgar acceso. Un email escrito en el checkout no demuestra control de ese email. Refunds y disputas necesitan una política explícita de revocación y un proceso auditable; no borrar silenciosamente el historial comercial.

## SaaS: proveedor de Billing y política de acceso separada

Usar Billing del proveedor en vez de construir un motor propio de renovaciones. En Stripe, crear planes/precios recurrentes y Checkout de suscripción con el SDK oficial, en un sandbox aislado y con claves restringidas. La integración actual solo usa pago único; cambiar una variable no la convierte en suscripciones. Mantener el cliente/API versionados del proyecto y verificar compatibilidad antes de ampliar el adaptador.

Los [webhooks de suscripciones de Stripe](https://docs.stripe.com/billing/subscriptions/webhooks) cubren cambios de estado y cobro asíncronos. Persistir el vínculo tenant/cliente/suscripción y reconciliar el estado actual ante eventos duplicados o atrasados. Considerar creación, renovación, fallo de factura, cambio de plan, cancelación, pausa y fin de trial. No conceder acceso por la página de retorno. Definir cómo cada estado, período y política de gracia afecta al producto; `SubscriptionProvider.status` entrega estado comercial, no autoriza por sí solo una acción del usuario.

[Stripe Entitlements](https://docs.stripe.com/billing/entitlements) es una opción para asociar prestaciones comerciales con acceso. Si se usa, sincronizar esos derechos con el recurso/tenant correcto; no reemplaza la autorización de datos de la aplicación. `EntitlementProvider` permite conservar esa separación. Implementar portal de gestión cuando corresponda, cuotas con consumo atómico y claves idempotentes, y reglas de downgrade que no eliminen datos sin política definida. Cancelar al final del período no equivale a revocar hoy.

Antes de habilitar impuestos, definir jurisdicciones, registros aplicables, códigos de producto y total canónico con el proveedor; no activar una bandera y asumir que toda obligación está resuelta. Factura comercial, factura fiscal local, prorrateo, refund y disputa requieren decisiones propias. Una cuenta Stripe por despliegue no es un marketplace: pagos a vendedores separados requieren Connect u otra integración específica.

## Outbox y tareas durables: contrato, no servicio instalado

`OutboxWriter<TTransaction>.append` define la futura escritura de una intención en **la misma transacción** que cambia el negocio. `DurableEffectIntent` contiene IDs/referencias y una clase acotada de operación, sin contacto, credenciales ni payloads arbitrarios. `DurableJobLease` explicita intento, token y vencimiento del lease. No existen tabla, dispatcher, claim/ack, scheduler ni implementación de esos puertos en el template.

Cuando un flujo necesite trabajo asíncrono, ensamblar una cola administrada o librería durable existente y su persistencia. Exigir unicidad por tenant/operación/clave, reclamación atómica, fencing del lease, reintentos limitados, dead-letter y conciliación. El consumidor debe tolerar entrega al menos una vez; no prometer ejecución exactamente una vez. Un callback tras commit o un timer en memoria no sustituye un outbox. Asegurar compatibilidad de payloads N−1/N antes de desplegar workers.

## Qué exige una instalación empresarial

La estructura modular permite añadir capacidades, pero no prueba una capacidad determinada. Antes de comprometer volumen/SLA, medir carga representativa, consultas/índices, conexiones por réplica, límites de proveedores, latencia y recuperación. Mantener límites de páginas/cuerpos/lotes y presupuestos de recursos por tenant para evitar que una empresa monopolice el servicio. Para operaciones críticas, definir SLO y alertas útiles, respaldo/PITR y prueba de restauración, retención/PII, rotación de secretos y respuesta a incidentes. SSO/SCIM, permisos más granulares, multi-región y certificaciones no se presentan como implementados.

Pruebas obligatorias por adaptación: tenant cruzado, rol/scope, cálculo monetario, duplicado concurrente, timeout tras éxito externo, firma inválida, evento atrasado, revocación, refund/cancel según contrato, rollback de auditoría y recuperación tras caída. Probar proveedor real en sandbox y registrar la evidencia aparte de los tests locales. Publicar como imagen inmutable con expand-contract y rollback compatible; seguir [producción](production.md).

Los ocho tests de `tests/extension-contracts.test.ts` verifican los helpers de dinero/contexto/referencia y su integración con la frontera de telemetría. **No validan ningún transportista, S3, Billing ni worker.** La documentación oficial enlazada se consultó el 2026-10-17; no se aprovisionaron cuentas ni se realizaron operaciones externas al añadir estos contratos.
