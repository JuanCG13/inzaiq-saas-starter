## Problema y resultado

Qué necesita el cliente, qué cambia y cómo se comprueba desde la interfaz o MCP.

## Contratos e impacto

- Empresa/módulo afectado y permisos requeridos:
- Compatibilidad con API/MCP y clientes abiertos de la versión anterior:
- Datos, dinero, stock, auditoría e idempotencia afectados:
- Señales de telemetría agregadas o modificadas, sin secretos ni datos personales:

## Evidencia

- [ ] Revisé el código y documentación oficial de las versiones instaladas.
- [ ] `npm run verify` pasa con el commit de este PR.
- [ ] E2E del recorrido afectado pasa en un entorno aislado; adjunto resultado.
- [ ] Pruebas relevantes cubren éxito, rechazo y fallas; indico lo no probado.
- [ ] Actualicé versión, CHANGELOG, README y contrato del módulo cuando corresponde.
- [ ] Todo texto visible nuevo está en `src/i18n/messages` en inglés y español, cada código de error nuevo tiene `errors.codes` en ambos y las capturas afectadas de `docs/screenshots` se regeneraron (o indico que no cambian).

## Publicación y rollback

- ¿Configuración dinámica o nueva imagen? Indicar opción y alcance:
- Migraciones nuevas, compatibilidad N/N−1 y orden de aplicación:
- Backfill reanudable, restricciones de bloqueo y retiro diferido de columnas:
- Imagen anterior/digest, activos conservados y condiciones para detener la publicación:
- Recuperación de datos si no alcanza con volver a la imagen anterior:

- [ ] No modifiqué migraciones ya aplicadas ni incluí credenciales.
- [ ] No uso `down`, reinicio de base ni edición de contenedores vivos como rollback.
- [ ] Si cambia infraestructura, adjunto validación real o marco explícitamente la pendiente.

Ver [flujo del agente](../docs/agent-workflow.md) y [operación en producción](../docs/production.md).
