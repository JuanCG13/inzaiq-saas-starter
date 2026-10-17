# Pagos: manual y Stripe Checkout

El template permite recibir pedidos manuales y, al configurar Stripe, cobrar con Checkout alojado. La integración usa `stripe@23.0.0` con API `2026-09-30.endive`. No se creó una cuenta de Stripe ni se procesaron cargos durante el desarrollo; las pruebas automatizadas usan firmas reales del SDK y respuestas simuladas, sin llamadas de cobro.

## Configuración por cliente

| Variable del servidor | Uso |
| --- | --- |
| `PAYMENT_PROVIDER` | `manual` por defecto; `stripe` activa Checkout. |
| `STRIPE_SECRET_KEY` | Clave de la cuenta del comercio. Preferir una clave restringida con los permisos mínimos para crear Checkout Sessions y sus recursos relacionados; verificar esos permisos en el entorno de pruebas de la cuenta. Se aceptan claves restringidas o secretas, de test o live. |
| `STRIPE_WEBHOOK_SECRET` | Secreto de firma del endpoint correspondiente a este despliegue y modo. El secreto de `stripe listen` es diferente del registrado en el Dashboard. |
| `STRIPE_INTEGRATION_IDENTIFIER` | Opcional. Identificador estable de la integración: un nombre y ocho letras finales. Default `agentic-commerce-kpvqbzcw`. No cambiar durante intentos pendientes. |

Estas variables no deben tener prefijo `NEXT_PUBLIC_`. Guardar credenciales en el gestor de secretos del hosting, nunca en Git, chats, registros ni respuestas HTTP. El proveedor se inicializa cuando se usa; `manual` no requiere secretos de Stripe. Reiniciar el proceso después de cambiar configuración o credenciales.

Cada despliegue usa **una cuenta comercial de Stripe**. Las organizaciones siguen aisladas en la aplicación, pero no representan cuentas conectadas ni distribución de fondos. Un marketplace con cuentas por vendedor requiere una integración adicional de Stripe Connect y sus procesos de habilitación; no está implementado aquí. La disponibilidad de Stripe y de cada moneda/método depende del país y la cuenta del cliente.

## Activar en un entorno de prueba

1. Ejecutar las migraciones del template y configurar el tenant público y las URLs de la aplicación. Usar credenciales de test de una cuenta autorizada por el comercio.
2. Elegir `PAYMENT_PROVIDER=stripe` y proporcionar los dos secretos del servidor.
3. Registrar `https://tu-dominio/api/payments/webhooks/stripe` como endpoint de eventos **snapshot**, con API `2026-09-30.endive`, y seleccionar:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
4. Para probar localmente con Stripe CLI, reenviar esos mismos eventos a `http://localhost:3000/api/payments/webhooks/stripe` y usar su secreto de firma local. Crear el pedido desde la tienda para obtener una sesión que ya tenga su vínculo persistido; un evento genérico de `stripe trigger` no contiene los identificadores de ese pedido.
5. Comprobar pago exitoso, método demorado, fallo, vencimiento, retorno sin webhook todavía y reenvío del mismo evento. Verificar pedido, inventario, auditoría y telemetría. Solo después configurar un endpoint y claves live y realizar la validación operativa del comercio.

No habilitamos impuestos automáticos, gastos de envío calculados, cupones ni conversión automática de moneda. Agregarlos requiere incorporar sus importes al cálculo canónico del pedido antes de cobrar. Los métodos de pago se eligen dinámicamente según la configuración de Stripe; el código no fija una lista de métodos.

## Flujo y recuperación

El servidor valida el total y la moneda que confirmó el comprador, vuelve a calcular precios desde el catálogo y reserva stock con el pedido. La pasarela recibe ese importe entero en la unidad menor de la moneda. Checkout muestra una línea agregada con el texto fijo en inglés `Store order` (`src/payments/providers/stripe.ts`); no se localiza, el adaptador no envía un `locale` a Stripe y el idioma de la página alojada lo decide Stripe (no probado aquí). El detalle de productos queda en el pedido interno. No se envían datos del cliente como metadata. Las URL de retorno se guardan sin prefijo (`/checkout/return?from=success|cancel`): el proxy de idioma las lleva a `/<idioma>/checkout/return` según la cookie `NEXT_LOCALE` o `Accept-Language` del comprador y conserva la consulta ([idiomas](i18n.md)).

La sesión se crea con un identificador de idempotencia persistido por intento. Sus parámetros son estables: URLs, importe, moneda, organización y pedido. El ID de sesión y la URL se guardan para poder reanudar después de una caída. Un timeout no libera stock ni crea automáticamente otro intento: puede haber ocurrido después de que Stripe aceptara la petición. Se reintenta con la misma clave durante una ventana conservadora de 23 horas. Si vence esa ventana sin recuperar la sesión, se requiere conciliación.

El retorno del navegador muestra el estado; no confirma el pago. El servidor verifica la firma del **cuerpo crudo** del webhook con el SDK oficial y exige coincidencia test/live. Un evento solo afecta un pedido si coinciden tenant, pedido, sesión persistida, importe y moneda. `completed` o `async_payment_succeeded` confirman únicamente si `payment_status=paid`; un pedido de importe cero también admite `no_payment_required`. Las finalizaciones todavía impagas se ignoran hasta su resultado posterior.

El servicio deduplica eventos en la base de datos y realiza la transición y los ajustes de stock en una transacción. Fallo o vencimiento cancela un pedido pendiente y restaura stock una sola vez. Un evento de fallo tardío no revierte un pedido completado. Un pago que llega después de una cancelación se marca para conciliación; no se hace un reembolso ni se vuelve a descontar stock automáticamente. Un webhook que se adelanta al guardado del vínculo de sesión recibe un error reintentable.

La URL de pago devuelta debe ser HTTPS y pertenecer exactamente a `checkout.stripe.com`. Dominios personalizados de Checkout requieren ampliar esa política de confianza explícitamente y agregar pruebas. La aplicación nunca recibe datos de tarjeta.

## Monedas e importes

`amountMinor` mantiene su significado en la aplicación y Stripe: por ejemplo, `2500 USD` representa USD 25,00 y `2500 PYG` representa ₲ 2.500. El adaptador permite solo las monedas de `STRIPE_CURRENCY_EXPONENTS`, compara su exponente con el de `Intl` y nunca adivina una conversión. Incluye PYG, JPY, CLP y KRW de cero decimales, y USD, EUR, ARS, BRL, MXN, COP, UYU y otras monedas de dos decimales.

ISK y UGX tienen representaciones especiales en Stripe y están rechazadas. MGA y monedas de tres decimales también requieren una adaptación explícita y pruebas antes de habilitarse. Una moneda no implementada se rechaza antes de reservar stock. El adaptador aplica un máximo conservador de 99.999.999 unidades menores; límites inferiores y mínimos de métodos/cuenta los valida Stripe. Que una moneda esté en la lista del código no garantiza disponibilidad comercial para una cuenta determinada. La moneda predeterminada y las ofrecidas en el editor (`currency`, `currencies` en `src/template.config.ts`) son independientes de esta lista: una moneda ofrecida pero ausente de `STRIPE_CURRENCY_EXPONENTS` se puede usar en pedidos manuales y se rechaza aquí con `PAYMENT_CURRENCY_UNSUPPORTED` ([idiomas y moneda](i18n.md)).

## Extender a otra pasarela

Implementar `PaymentProvider` en `src/payments/contracts.ts` y registrar una instancia en `src/payments/registry.ts`. El puerto exige:

- `validateCheckoutInput`: validación sin efectos externos, incluida representación de moneda y restricciones conocidas antes de reservar stock.
- `createCheckout`: checkout alojado, clave idempotente estable, URL de proveedor validada y vencimiento verificable.
- `verifyWebhook`: verificación criptográfica del cuerpo original antes de devolver un `PaymentEvent` normalizado; retornar `null` para eventos ignorados.
- `idempotencyRetentionMs`: ventana conservadora garantizada por la pasarela. Si no ofrece esta garantía, necesita otro diseño de recuperación antes de incorporarse.

Usar únicamente los datos firmados de la pasarela para sesión, tenant, pedido, importe y moneda. El servicio compartido realiza la comparación contra el pedido persistido, deduplicación y transacciones. Agregar configuración del servidor y pruebas de contrato, errores, repetición, eventos fuera de orden y recuperación. Las rutas usan un registro explícito de proveedores, nunca importan código ni URLs a partir de texto enviado por el cliente. Otras pasarelas no están implementadas por el solo hecho de existir este puerto.

El cliente también tiene validación explícita. Para incorporar, por ejemplo, un proveedor con ID `nueva-pasarela`, recorrer estos puntos en orden:

| Archivo | Cambio necesario |
| --- | --- |
| `src/payments/providers/<proveedor>.ts` | Implementar el adaptador con el SDK oficial, secretos exclusivos del servidor y validación de los destinos de checkout del proveedor. Usar `src/payments/providers/stripe.ts` como referencia del contrato, sin copiar sus reglas de moneda, firma ni ventana de idempotencia a otra pasarela. |
| `src/payments/registry.ts` | Añadir el ID a `getPaymentProvider`, tanto al resolver `PAYMENT_PROVIDER` como al recuperar un pedido asociado a ese ID. Conservar las instancias y credenciales de proveedores anteriores mientras existan intentos pendientes. No convertir este registro en importaciones dinámicas controladas por el comprador. |
| `src/app/api/store/payment-options/route.ts` | Añadir una etiqueta para el nuevo ID y devolver `{ provider, label, mode: 'redirect' }`. La etiqueta del servidor está en inglés y no se muestra: el texto visible sale de `payment.method.*` en `cart.json`. Actualmente la etiqueta distingue Stripe de una etiqueta genérica; reemplazar esa selección por un mapa explícito cuando haya más pasarelas. Mantener `{ provider: 'manual', label, mode: 'manual' }` para pedidos manuales, sin exponer configuración secreta. |
| `src/components/checkout-attempt.ts` | Ampliar la unión `PaymentOption.provider` y la validación del proveedor en `parseSavedAttempt`. Extender `checkoutRedirectUrl` con los hosts HTTPS exactos autorizados **por proveedor**; sus fallos son códigos de `CheckoutAttemptError` que el carrito traduce con `cart.json` (`failures.*`), no frases. Seguir rechazando credenciales en la URL, puertos inesperados, protocolos alternativos y dominios que solo comparten un sufijo. La misma validación protege tanto las respuestas del servidor como los intentos recuperados de `sessionStorage`. |
| `src/app/[lang]/cart/page.tsx` | Ampliar el filtro de proveedores de la respuesta de `/api/store/payment-options`. Actualizar las ramas de creación y recuperación que hoy llaman `checkoutRedirectUrl(..., 'stripe')` y guardan `provider: 'stripe'`. Actualizar también la selección del texto de pago (`payment.method.stripe` / `payment.method.manual` en `src/i18n/messages/{en,es}/cart.json`, que además contiene la nota de redirección y «Retomar pago») y la selección del botón de reanudar. Todo texto nuevo va en ambos idiomas. Conservar el snapshot enviado, la clave y el bloqueo ante resultados inciertos. |
| `src/app/[lang]/checkout/return/page.tsx` | Sustituir la asignación de proveedor Stripe en la recuperación por la identidad verificada que devuelva el servidor. No derivar identidad ni estado de pago de parámetros de la URL. Mantener la consulta de estado antes de retirar del carrito las cantidades enviadas. |
| `src/components/admin-workspace.tsx` | Añadir, si corresponde, el nombre comercial del proveedor en la presentación del pedido. La condición `!selected.paymentProvider` debe seguir impidiendo confirmaciones y cancelaciones manuales de **cualquier** pedido gestionado por una pasarela. |

Al admitir varias pasarelas, transportar la identidad del proveedor en el descriptor `checkout` de las respuestas de creación y recuperación. Para hacerlo, actualizar `CheckoutResult` y `ResumeCheckoutResult` en `src/payments/contracts.ts`, sus respuestas en `src/payments/service.ts`, `CheckoutRecovery` en `src/components/checkout-attempt.ts` y el tipo de respuesta del POST en `src/app/[lang]/cart/page.tsx`. Así el cliente usa el proveedor asociado al intento persistido aunque la configuración del comercio haya cambiado desde que cargó la página. Actualmente esas dos ramas del cliente fijan Stripe porque es la única pasarela online implementada; ampliar únicamente el registro del servidor no basta.

La ruta compartida `src/app/api/payments/webhooks/[provider]/route.ts` resuelve el ID mediante el registro y entrega el cuerpo crudo al adaptador; registrar su URL con la nueva pasarela y probar su formato real de firma. Las rutas `src/app/api/store/orders/route.ts` y `src/app/api/store/checkout/resume/route.ts` deben seguir usando el servicio compartido, sin lógica paralela de stock ni confirmaciones provenientes del navegador. Mantener el protocolo `x-checkout-protocol` de extremo a extremo; si el nuevo contrato deja de ser compatible con clientes existentes, versionar su negociación y rechazar clientes antiguos **antes** de reservar stock. Agregar las variables nuevas a `.env.example` y documentar el proceso de test/live del proveedor.

Antes de habilitarlo, extender `tests/checkout-recovery.test.ts` con URLs válidas y maliciosas del nuevo proveedor; `tests/e2e/hosted-checkout.spec.ts` con creación, respuesta perdida, recarga, retorno cancelado y recuperación de la misma sesión; y las pruebas de adaptador/servicio basadas en `tests/payments-stripe.test.ts` y `tests/payments-domain.test.ts`. Incluir el cambio de proveedor entre descubrimiento y POST, sin pérdida de la identidad original. El carrito debe conservarse ante incertidumbre; el estado `not_found` debe permitir reenvío con la misma clave; ninguna URL de retorno debe actuar como comprobante de pago.

## Diagnóstico y pruebas

`commerce.payment.*` registra resultados normalizados y conserva el ID de solicitud de la ruta. Los mensajes crudos del SDK, cuerpos de webhook, secretos y datos del cliente no se escriben en telemetría. Los códigos `PAYMENT_PROVIDER_UNAVAILABLE`, `PAYMENT_SIGNATURE_INVALID`, `PAYMENT_EVENT_MISMATCH` y `PAYMENT_RECONCILIATION_REQUIRED` distinguen las acciones operativas sin revelar esos datos. Los mensajes del servidor están en inglés y el código es el contrato; el navegador muestra el texto de `errors.codes.<CÓDIGO>` en el idioma activo. Un código nuevo de un adaptador necesita su entrada en `src/i18n/messages/en/errors.json` y `es/errors.json`; `tests/error-codes.test.ts` falla si falta.

```sh
npx vitest run tests/payments-stripe.test.ts tests/payments-domain.test.ts
```

La suite del adaptador comprueba parámetros idempotentes, moneda de cero decimales, redirecciones de confianza, firmas del SDK, payload alterado, firma vencida, modo incorrecto, pago demorado, importe cero y ausencia de PII en errores y eventos. Las pruebas del servicio verifican persistencia y transiciones con libSQL y PostgreSQL local. Esto no sustituye la prueba de integración con una cuenta Stripe y el hosting final.

Referencias oficiales: [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create), [fulfillment y eventos demorados](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted), [firma de webhooks](https://docs.stripe.com/webhooks/signature), [monedas](https://docs.stripe.com/currencies), [idempotencia](https://docs.stripe.com/api/idempotent_requests), [claves restringidas](https://docs.stripe.com/keys).
