# Seguridad — Market Castilla

Este documento describe los controles implementados en el código actual y, al final, los **pendientes para producción**. Referencias: `src/lib/auth/*`, `src/modules/payments/*`, `src/modules/restricted/engine.ts`, `src/db/schema.ts`.

## Autenticación

- **Contraseñas con scrypt** (`src/lib/auth/password.ts`): `scrypt(password, salt16, 64)` de `node:crypto`, salt aleatorio por usuario, formato `scrypt:<salt>:<hash>`, comparación con `timingSafeEqual`.
- **Sesiones en base de datos, revocables** (`sessions`): TTL de 7 días, `revoked_at` permite invalidar sesiones individuales sin esperar expiración; el logout revoca la sesión en BD además de borrar la cookie.
- **Cookie firmada con HMAC-SHA256** (`src/lib/auth/session.ts`): el token es `sessionId.hmac(sessionId)` con `SESSION_SECRET` de entorno (falla si no está configurado). Verificación timing-safe. Atributos: `httpOnly`, `SameSite=Lax`, `Secure` en producción, `path=/`.
- Usuarios desactivados (`is_active = false`) pierden acceso aunque tengan sesión vigente: `getSessionUser` lo verifica en cada lectura.

## Autorización: permisos explícitos por rol

Matriz en `src/lib/auth/permissions.ts`, materializada en la tabla `role_permissions` (semilla editable por el owner). Guard único: `requirePermission(permission)` en páginas y acciones del panel.

| Permiso | customer | cashier | picker | driver | accountant | admin | tech_admin | owner |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| orders.view / manage | – | ✔ | ✔ | – | solo view | ✔ | solo view | ✔ |
| orders.cancel / adjust_weight | – | – | solo adjust_weight | – | – | ✔ | – | ✔ |
| catalog.view / manage | – | solo view | solo view | – | solo view | ✔ | ✔ | ✔ |
| prices.manage | – | – | – | – | – | ✔ | – | ✔ |
| inventory.view / adjust / receive | – | solo view | solo view | – | solo view | ✔ | solo view | ✔ |
| purchases.manage / suppliers.manage | – | – | – | – | – | ✔ | – | ✔ |
| customers.view / manage | – | solo view | – | – | solo view | ✔ | solo view | ✔ |
| campaigns.manage / coupons.manage | – | – | – | – | – | ✔ | ✔ | ✔ |
| delivery.view_own | – | – | – | ✔ | – | – | – | ✔ |
| delivery.manage | – | – | – | – | – | ✔ | – | ✔ |
| payments.view / refund | – | solo view | – | – | solo view | ✔ | – | ✔ |
| **bank_accounts.manage** | – | – | – | – | – | – | – | **✔ solo owner** |
| **payouts.manage** | – | – | – | – | – | – | – | **✔ solo owner** |
| reports.view / commission.view | – | – | – | – | ✔ | ✔ | ✔ | ✔ |
| **commission.approve** | – | – | – | – | – | – | – | **✔ solo owner** |
| settings.view / manage | – | – | – | – | solo view | ✔ | ✔ | ✔ |
| restricted_rules.manage | – | – | – | – | – | ✔ | – | ✔ |
| users.manage | – | – | – | – | – | ✔ | – | ✔ |
| integrations.manage | – | – | – | – | – | – | ✔ | ✔ |
| audit.view / pos.sync | – | – | – | – | solo audit.view | ✔ | ✔ | ✔ |

**Regla clave del contrato:** `tech_admin` (la agencia) **nunca tiene permisos de dinero**: `bank_accounts.manage`, `payouts.manage` y `commission.approve` son exclusivos del **owner**. La agencia puede ver la comisión (`commission.view`) y administrar lo técnico/operativo, pero no aprobar su propio cobro ni tocar cuentas bancarias. `accountant` es estrictamente de solo lectura y `driver` solo ve sus propias entregas (`delivery.view_own`).

## Rate limiting de login

`src/lib/auth/rate-limit.ts`: ventana deslizante **en memoria** para el demo. En producción debe reemplazarse por **Redis/Upstash** u otro almacén compartido entre instancias (el limitador en memoria no sobrevive reinicios ni escala horizontal).

## Validación server-side y precios de servidor

- **Todo el checkout se valida con Zod en el servidor** (`checkoutInputSchema` en `src/modules/orders/checkout.ts`): items, contacto, dirección, preferencia de sustitución, método de pago, consentimientos, clave de idempotencia.
- **Los precios SIEMPRE se recalculan en el servidor.** El carrito del navegador solo aporta `variantId` y `qty`; precio, flags de restringido, tarifa de envío y totales se leen de la BD y se calculan con `src/lib/money.ts` (`assertMoney` rechaza cualquier importe no entero). Nunca se confía en montos enviados por el cliente.
- Horarios, zonas de cobertura y reglas de restringidos se verifican también en el servidor en el momento del checkout.

## Webhooks firmados

- Firma **HMAC-SHA256** del cuerpo crudo con secreto de entorno (`PAYMENT_WEBHOOK_SECRET`), verificación **timing-safe** (`timingSafeEqual`) en `PaymentProvider.verifyWebhookSignature` (`src/modules/payments/sandbox.ts`). Un webhook sin firma válida se descarta antes de tocar la BD.
- El proveedor sandbox reproduce el mismo flujo que tendrán Wompi/Mercado Pago: mismo contrato, mismos controles.

## Idempotencia y pagos duplicados

- **Idempotencia de creación:** índice único `(provider, idempotency_key)` en `payments`; `createPayment` devuelve el pago existente ante un reintento (doble clic, reintento de red).
- **Dedupe de webhooks:** índice único `(provider, external_event_id)` en `webhook_events`; un evento repetido responde `duplicate` sin efectos.
- **Estados finales no se re-procesan:** si el pago ya no está `pending`, el webhook solo se registra en `attempts` (`webhook_ignored_*`) y no cambia nada — protección contra doble aprobación/doble cobro.
- Los reembolsos validan que el acumulado no exceda el monto pagado y solo aplican sobre pagos `approved`/`partially_refunded`.
- Regla de oro: el estado de un pago solo cambia por webhook verificado o por acción de un rol autorizado, **nunca** por lo que reporte el navegador del cliente.

## Auditoría de cambios críticos

Tabla `audit_events` (`src/lib/audit.ts`): actor (usuario o etiqueta de sistema/webhook), acción, entidad y snapshots `before`/`after` en jsonb. Se registran, entre otros:

- Cambios de **precios** (`price.update`) e historial en la tabla `prices`.
- Ajustes de **inventario** (`inventory.adjust`) — imposibles sin motivo.
- **Reembolsos** (`refund.create`) y transiciones de **pago** (`payment.approved|rejected|expired`).
- Cambios de **settings** (`settings.update`) con valor anterior y nuevo.
- **Comisión** (`commission.period_created`) con el snapshot completo del cálculo.
- Registro de **peso real** (`order.weight_recorded`).

## Credenciales de integraciones

- Columna `integration_accounts.encrypted_credentials`: credenciales **siempre cifradas** (AES-GCM con clave de entorno, previsto), **nunca en texto plano**.
- **Prohibido guardar credenciales de Treinta** (el POS actual) y prohibido el scraping o la automatización de su interfaz privada (ver `src/modules/pos/provider.ts`).

## Separación de ambientes y secretos

- Los secretos viven en variables de entorno (`DATABASE_URL`, `SESSION_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `PAYMENT_PROVIDER`, `MESSAGING_PROVIDER`); **nunca en el repositorio**. `.env.example` sirve de plantilla sin valores reales.
- El código diferencia demo/producción: cookie `Secure` solo en producción, defaults de demo explícitos (secreto sandbox de webhook) que **no deben llegar a producción**.
- Sandbox de pagos separado del proveedor real por configuración, no por ramas de código.

## Protección de datos personales (Ley 1581/2012, Colombia)

- **Consentimiento con evidencia:** tabla `consents` registra cada otorgamiento/revocación con `kind` (`data_processing`, `marketing_whatsapp`, `age_terms`…), `granted`, `source` y detalle jsonb. El checkout exige `dataConsent` obligatorio; el de marketing es opcional.
- **Opt-out de campañas:** nunca se envían campañas sin consentimiento `marketing_whatsapp` registrado (regla del módulo `messaging`); la revocación se registra como un nuevo consent con `granted = false`.
- Datos mínimos: el documento de identidad del cliente es opcional; la fecha de nacimiento se usa solo para verificación de edad.

## Productos restringidos

- Motor **configurable** (`src/modules/restricted/engine.ts` + settings `restricted.rules`): horario de venta por clase de producto, modalidades permitidas, zonas excluidas, edad mínima, declaración de edad y verificación de cédula en la entrega (`id_check_required` bloquea `markDelivered` sin verificación).
- Regla ausente = venta bloqueada por precaución (fail-closed).
- **Las medidas técnicas NO sustituyen la validación legal:** los horarios y condiciones por defecto son supuestos conservadores pendientes de confirmación jurídica del negocio.

## Pendientes para producción

- **MFA para administradores** (la columna `users.mfa_enabled` existe; falta el flujo TOTP).
- **Prevención de enumeración de cuentas:** respuestas uniformes en login/recuperación.
- **Backups automatizados y plan de recuperación** (RPO/RTO definidos, restauraciones probadas).
- **Rotación de credenciales** (secretos de sesión/webhook, claves de cifrado de integraciones).
- **CSRF:** hoy mitigado por `SameSite=Lax` + Server Actions de Next (verificación de `Origin`); revisar endpoints adicionales que se expongan.
- **Rate limiting distribuido** (Redis) en lugar del limitador en memoria del demo.
- **Monitoreo y logging estructurado:** trazas de webhooks, alertas de pagos fallidos, errores de sincronización.
