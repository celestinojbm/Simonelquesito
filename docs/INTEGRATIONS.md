# Integraciones externas

Este documento describe el estado real de cada integración de la plataforma Market Castilla, el contrato de código que la abstrae, las credenciales/aprobaciones necesarias y lo que **explícitamente no se hace**. Toda integración se modela detrás de un adapter intercambiable; su estado y credenciales (siempre cifradas) viven en la tabla `integration_accounts`, los mapeos de productos externos en `external_product_mappings`, las corridas de sincronización en `sync_jobs` y los eventos entrantes deduplicados en `webhook_events`.

| Integración | Estado actual | Contrato | Adapter activo |
|---|---|---|---|
| POS Treinta | Sin API pública — sincronización por CSV | `POSProvider` | `CsvPosAdapter` |
| Pagos | Sandbox funcional (sin dinero real) | `PaymentProvider` | `SandboxPaymentProvider` |
| WhatsApp | Simulado (mensajes en BD) | `MessagingProvider` | `ConsoleMessagingProvider` |
| Marketplaces (Rappi/DiDi) | Registro manual/CSV | `MarketplaceProvider` | `ManualMarketplaceAdapter` |
| Mapas | No se usa proveedor (zonas por barrio) | — | — |

---

## 1. POS Treinta

**Estado actual.** Treinta es la caja del punto físico y **no ofrece API pública**. La sincronización del MVP es por archivos (Excel exportado desde Treinta → CSV → plataforma, y viceversa). `POS_PROVIDER=csv` en `.env`.

**Contrato en el código.** `src/modules/pos/provider.ts` define `POSProvider` con dos operaciones:

- `importProducts(source)` — importa catálogo/precios/stock.
- `exportSales(rows)` — exporta ventas digitales para conciliarlas en el POS.

**Adapter activo.** `CsvPosAdapter` (`src/modules/pos/csv-adapter.ts`):

- **Importación**: CSV con cabecera `sku,codigo_barras,nombre,categoria,precio,costo,stock` (compatible con el Excel exportable de Treinta). Crea o actualiza variantes por SKU/código de barras y crea la categoría si no existe.
- **Conciliación de stock**: el stock del CSV **nunca pisa** el número del sistema; se calcula la diferencia contra el ledger y se registra un movimiento de tipo `adjustment` con razón "Conciliación importación POS (CSV)", referenciado al job (`referenceType: "sync"`).
- **Trazabilidad**: cada importación crea un registro en `sync_jobs` (`kind: pos_import_products`) con resumen (`imported`, `updated`, `totalRows`) y errores fila a fila; termina en `completed` o `completed_with_errors`.
- **Exportación**: `exportSales` genera un CSV (`numero,fecha,canal,estado,subtotal,envio,total,metodo_pago`) con las ventas digitales para cuadre de caja en Treinta.

**Credenciales y aprobaciones.** No aplican: no hay API. La cuenta se representa en `integration_accounts` con `kind: pos_treinta` sin credenciales.

**Qué NO se hace (prohibiciones de proyecto):**

- **No** se hace scraping de Treinta.
- **No** se automatiza su interfaz privada (web o app).
- **No** se guardan credenciales de Treinta (ni en texto plano ni cifradas): no se necesitan.

**Futuro.** Si Treinta publica una API oficial, se implementa `TreintaApiAdapter` con el mismo contrato `POSProvider`, sin reescribir la aplicación. Cambiar a otro POS = escribir otro adapter.

---

## 2. Pagos

**Estado actual.** `PaymentProvider` (`src/modules/payments/provider.ts`) con `SandboxPaymentProvider` activo (`PAYMENT_PROVIDER=sandbox`). No mueve dinero.

**Contrato en el código.** `createIntent()` devuelve `providerRef` y `redirectUrl`; `verifyWebhookSignature()` valida la firma del webhook; `parseWebhook()` normaliza el evento (`approved | rejected | expired`). **Regla de oro**: el estado de un pago solo cambia por confirmación del servidor (webhook verificado o acción de un rol autorizado), nunca por lo que diga el navegador del cliente.

**Sandbox disponible.** `src/modules/payments/sandbox.ts`: el "checkout de la pasarela" es la pantalla local `/pago-sandbox/[ref]` donde se aprueba o rechaza; esa pantalla dispara un webhook **firmado HMAC-SHA256** (`PAYMENT_WEBHOOK_SECRET`) contra nuestro propio endpoint, igual que haría Wompi/Mercado Pago. La verificación usa comparación en tiempo constante (`timingSafeEqual`). Idempotencia en dos niveles: clave única `(provider, idempotency_key)` en `payments` y dedupe de eventos `(provider, external_event_id)` en `webhook_events`.

**Adapters previstos (fase 2).** `WompiProvider` y `MercadoPagoProvider` con el mismo contrato (las ramas ya están previstas en `getPaymentProvider()`). Requisitos — todos **PENDIENTE**:

| Requisito | Wompi | Mercado Pago |
|---|---|---|
| Cuenta de comercio verificada | PENDIENTE | PENDIENTE |
| Llave pública | `WOMPI_PUBLIC_KEY` — PENDIENTE | — |
| Llave privada / token | `WOMPI_PRIVATE_KEY` — PENDIENTE | `MERCADOPAGO_ACCESS_TOKEN` — PENDIENTE |
| Secreto de eventos/webhooks | `WOMPI_EVENTS_SECRET` — PENDIENTE | `MERCADOPAGO_WEBHOOK_SECRET` — PENDIENTE |
| Certificación de webhooks en sandbox del proveedor | PENDIENTE | PENDIENTE |

Nequi y Daviplata se ofrecen **vía agregador** (Wompi/Mercado Pago los exponen como métodos), no con integración directa.

**Pagos offline.** Efectivo, datáfono y transferencia se registran como pagos `pending` que el personal confirma manualmente al recibir; se concilian a mano.

**Qué NO se hace.** No se marca un pago como aprobado desde el cliente; no se aceptan webhooks sin firma válida; no se integran pasarelas sin sandbox certificado.

---

## 3. WhatsApp

**Estado actual.** `MessagingProvider` (`src/modules/messaging/service.ts`) con proveedor `console` activo (`MESSAGING_PROVIDER=console`): cada envío queda **simulado y registrado** en la tabla `notifications` con `status: "simulated"`, inspeccionable en Admin → Mensajes. Cubre los eventos transaccionales del pedido (creado, pago confirmado, preparación, sustitución, ajuste de peso, listo, en camino, entregado).

**Producción (fase 2).** `WhatsAppCloudProvider` con el mismo contrato contra la **WhatsApp Business Cloud API de Meta**. Requisitos — todos **PENDIENTE**:

- Verificación del negocio en Meta Business Manager — PENDIENTE.
- Número dedicado para el canal (`BUSINESS_WHATSAPP_NUMBER`) — PENDIENTE.
- Plantillas de mensaje aprobadas por Meta — PENDIENTE.
- Token permanente y configuración (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`) — PENDIENTE.

**Obligatorio en cualquier escenario:**

- **Consentimiento y opt-out**: nunca se envían campañas sin consentimiento registrado (tabla `consents`, kind `marketing_whatsapp`) y siempre con mecanismo de baja.
- **Transferencia a humano**: el cliente debe poder pasar de mensajes automáticos a una persona.

**Qué NO se hace.** No se usan libretas no oficiales ni automatización de WhatsApp personal/Business App (riesgo de bloqueo del número); solo la API oficial de Meta.

---

## 4. Marketplaces (Rappi / DiDi)

**Estado actual.** No existe acceso oficial verificado a las APIs de Rappi/DiDi para este negocio. **Por política del proyecto no se implementa una integración falsa** ni se automatizan interfaces privadas.

**Contrato en el código.** `MarketplaceProvider` (`src/modules/marketplace/provider.ts`): `pullOrders()` y `pushAvailability()`. Adapter activo: `ManualMarketplaceAdapter` — los pedidos de marketplace se registran a mano desde el panel admin (o por importación CSV) con:

- Canal `rappi`/`didi` e id externo en `orders.marketplace_order_id`; **dedupe** por índice único `(channel, marketplace_order_id)`.
- Mapeo SKU interno ↔ producto externo en `external_product_mappings` (único por `(integration_id, external_id)`).
- Registro de la comisión del marketplace por pedido (`orders.marketplace_commission_cop`).

**Checklist para activar la integración real** (todo PENDIENTE):

1. Verificar acceso oficial al programa de partners/desarrolladores de Rappi y DiDi Food.
2. Obtener credenciales (`RAPPI_CLIENT_ID`/`RAPPI_CLIENT_SECRET`, `DIDI_APP_ID`/`DIDI_APP_SECRET`) y guardarlas cifradas en `integration_accounts`.
3. Integrar y probar primero contra el **sandbox** del marketplace.
4. Certificación del flujo (recepción de pedidos, aceptación, disponibilidad) exigida por el partner.
5. Implementar `RappiApiAdapter` (y equivalente DiDi) con el mismo contrato `MarketplaceProvider`.

**Qué NO se hace.** Nada de scraping ni bots sobre las apps de tendero; nada de integraciones simuladas presentadas como reales.

---

## 5. Mapas

**Estado actual.** Desacoplado y **sin proveedor** (`MAPS_PROVIDER=none`). El MVP resuelve cobertura de domicilios con **zonas por barrio**: `delivery_zones` guarda la lista de barrios (`neighborhoods` en JSONB), tarifa, mínimo de pedido y ETA — sin polígonos ni geocodificación.

**Futuro.** Si se necesita mapa/GPS (fase 4), se configura `MAPS_PROVIDER` y `MAPS_API_KEY` sin tocar el modelo de zonas.

**Qué NO se hace.** No se depende de ningún API de mapas para operar el MVP.
