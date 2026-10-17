# Administración mediante MCP

El cliente conecta **su agente al servidor del negocio**, no sus credenciales de ChatGPT/Claude a la tienda. La aplicación no necesita una API key de OpenAI/Anthropic. La cuenta del cliente y los permisos disponibles en su plan determinan si puede añadir conectores personalizados.

## Componentes comprobados

- Next.js Route Handler `POST /api/mcp`, SDK oficial `@modelcontextprotocol/server` 2.3.1, Streamable HTTP. La compatibilidad `legacy: stateless` negocia clientes 2025 y 2026 sin sesiones MCP en memoria.
- Better Auth 1.7.10: Organization + JWT + `@better-auth/mcp` (OAuth provider incorporado). No se implementa OAuth casero.
- CIMD identifica clientes mediante documentos HTTPS; DCR queda habilitado como fallback para clientes anteriores. El transporte CIMD oficial valida destinos de red y no sigue redirecciones.
- Authorization code + PKCE, discovery RFC 8414/9728, tokens ligados a `/api/mcp`, acceso de 15 minutos, refresh con `offline_access`.
- Scope por capacidad y tenant firmado. El backend vuelve a consultar membresía, rol y consentimiento vigentes en cada petición. Revocar consentimiento o eliminar membresía impide utilizar incluso un JWT aún vigente.

## Primer arranque

1. Configurar `DATABASE_PROVIDER`, `DATABASE_URL`, `BETTER_AUTH_URL` (origin HTTPS sin path) y `BETTER_AUTH_SECRET` aleatorio de al menos 32 caracteres. Para Turso remoto, `TURSO_AUTH_TOKEN`.
2. Revisar migraciones y aplicar: `npm run db:migrate` y `npm run auth:migrate`. El migrador auth añade RLS y revoca acceso de PUBLIC/anon/authenticated a tablas de autenticación en PostgreSQL; usar una conexión de servidor propietaria. Nunca compartirla con navegador o agente.
3. Abrir `/sign-in`, crear cuenta con contraseña larga, crear o elegir empresa en `/onboarding`. Estas rutas sin prefijo redirigen a `/en/...` o `/es/...` (ver «Idioma de las páginas OAuth»).
4. Configurar dominio HTTPS público accesible desde OpenAI/Anthropic. Un localhost o una dirección de VPN no basta para los conectores cloud. `BETTER_AUTH_URL` debe coincidir con el dominio servido y su Host; revisar configuración del proxy.
5. Verificar `GET /.well-known/oauth-protected-resource` y `GET /.well-known/oauth-authorization-server/api/auth`. No deben redirigir a login ni estar protegidos por autenticación del hosting; el proxy de idioma excluye `/.well-known/` y `/api/`, de modo que tampoco los redirige.
6. Un `POST /api/mcp` sin token devuelve `401` y `WWW-Authenticate` con `resource_metadata`. Nunca se permite acceso demo en MCP.

## Idioma de las páginas OAuth

`src/lib/auth.ts` configura `loginPage: '/sign-in'`, `consentPage: '/consent'` y `postLogin.page: '/onboarding'` sin prefijo de idioma. Cuando el servidor OAuth redirige allí, `src/proxy.ts` responde `307` a `/<idioma>/sign-in`, `/<idioma>/consent` o `/<idioma>/onboarding` y **conserva la cadena de consulta** (`client_id`, `scope` y los parámetros firmados) sin modificarla. La página de consentimiento sigue verificando esa firma con `verifyOAuthQueryParams`. El idioma lo elige la cookie `NEXT_LOCALE` y, si no existe, el `Accept-Language` del navegador con el que la persona autoriza, y luego el idioma predeterminado; el recorrido OAuth no transporta un idioma. Las etiquetas de scopes del consentimiento están en `src/i18n/messages/<idioma>/auth.json` (`consent.scopes.<scope>`); un scope sin traducción se muestra con su identificador. Las respuestas con `307` llevan `Vary: Accept-Language, Cookie` y `Cache-Control: private, no-store`: no cachearlas en el borde. Detalles en [idiomas y moneda](i18n.md). Esto está cubierto por pruebas unitarias de la lógica de redirección (`tests/i18n-routing.test.ts`); un recorrido OAuth completo con un cliente real sigue siendo evidencia pendiente de cada instalación.

## Conectar Claude

En ajustes de conectores, añadir un conector personalizado con `https://tu-dominio/api/mcp`. Usar OAuth con identidad publicada de Claude (CIMD) o registro automático (DCR). Iniciar sesión, elegir empresa, revisar scopes y autorizar. En equipos puede requerirse que un administrador añada primero el conector. Callback cloud oficial: `https://claude.ai/api/mcp/auth_callback`; no se inventan callbacks ni se omite PKCE.

## Conectar ChatGPT

En la superficie de plugins/conectores personalizados disponible para la cuenta, registrar `https://tu-dominio/api/mcp` con OAuth. ChatGPT descubre authorization server, recurso y scopes; soporta CIMD, DCR o cliente preconfigurado. Completar inicio de sesión, selección de empresa y consentimiento. La ruta exacta de configuración cambia según producto, plan y política del workspace. No hace falta publicar en un directorio para probar una conexión personalizada cuando la cuenta lo permite.

## Herramientas y permisos

| Herramienta | Scope | Efecto |
| --- | --- | --- |
| `products_list`, `products_get` | `products:read` | Catálogo, stock y versión actual |
| `products_create`, `products_update` | `products:write` | Crear/editar producto |
| `stock_adjust` | `stock:write` | Movimiento de inventario con motivo e idempotencia |
| `orders_list` | `orders:read` | Pedidos de la empresa |
| `orders_update_status` | `orders:write` + owner/admin | Completar manualmente o cancelar pedido pendiente |
| `orders_create` | `orders:write` | Venta POS en efectivo o pedido web manual pendiente |
| `dashboard_get` | `dashboard:read` | Resumen y ventas separadas por moneda |
| `audit_list` | `audit:read` | Historial de operaciones |
| `settings_get` | `settings:read` + owner/admin | Configuración operativa y versión |
| `settings_update` | `settings:write` + owner/admin | Aviso público y pausa/reanudación de nuevos pedidos sin recompilar |

La lista de herramientas se filtra por scopes; el dominio verifica además el rol vigente. Los scopes no elevan roles. Las escrituras requieren `confirmed: true`, solo después de aprobación explícita del usuario. Esta bandera y las annotations guían al host; **no sustituyen control de acceso ni una firma humana**. Si se necesita aprobación fuerte por operación, añadir una cola de propuestas y aprobación desde la UI antes de habilitar dichas capacidades.

Los nombres, descripciones, errores y resultados de las herramientas MCP están en inglés, independientemente del idioma de la interfaz; el agente conversa con la persona en el idioma de esta. Los datos del comerciante (nombres de producto, descripciones, avisos) se devuelven tal como se guardaron. `tenantId`, SQL, URLs arbitrarias y credenciales no son argumentos de herramientas. Actualizar producto requiere `version`. Inventario y pedidos requieren `idempotencyKey`; reutilizarla al reintentar. El servidor calcula importes y evita stock negativo en transacciones. Un pedido web manual no equivale a un pago cobrado.

## Desconectar y administrar accesos

Abrir `/onboarding/connections` permite consultar los consentimientos del negocio activo y desconectar cada agente mediante la API oficial `oauth2.deleteConsent`. La siguiente llamada MCP revalida consentimiento y rechaza el token. Esta página muestra también el identificador que se utiliza en `STORE_TENANT_ID`.

## Pruebas y operación

`tests/mcp*.test.ts` ejercita el SDK real y permisos, confirmaciones y errores. `tests/auth*.test.ts` ejercita OAuth local, discovery, aislamiento y revocación. La telemetría `auth.request.completed`, `mcp.request.completed` y `mcp.tool.<tool>.completed` usa códigos normalizados sin cuerpo, contraseñas ni tokens. No registrar query strings OAuth.

Antes de aceptar un cliente real: probar consentimiento, rechazo, expiración, refresh, revocación y aislamiento desde ambas cuentas reales, sobre HTTPS. Los tests locales no prueban que una cuenta real de ChatGPT o Claude ya esté conectada. Tampoco cubren entrega de correo, recuperación de contraseña ni MFA: configurar esos módulos de Better Auth para el contrato de producción del cliente.

## Referencias oficiales revisadas (2026-10-17)

- https://better-auth.com/docs/plugins/mcp
- https://better-auth.com/docs/plugins/oauth-provider
- https://better-auth.com/docs/plugins/organization
- https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients.html
- https://ts.sdk.modelcontextprotocol.io/v2/testing.html
- https://developers.openai.com/plugins/build/auth
- https://claude.com/docs/connectors/building
- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery
