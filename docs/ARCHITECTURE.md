# Arquitectura — Market Castilla

PWA de comercio para un minimarket de barrio en Bogotá (Colombia). Este documento describe la arquitectura **real** del código en `src/`; lo que aún no existe se marca explícitamente como *fase futura*.

## Stack

| Capa | Tecnología | Notas |
|---|---|---|
| Framework | Next.js 15 (App Router) | Server Components + Server Actions |
| Lenguaje | TypeScript estricto | `tsc --noEmit` como gate de CI |
| UI | React 19, Tailwind CSS 4 | Formularios con React Hook Form + `@hookform/resolvers` |
| Validación | Zod | Esquemas compartidos servidor/cliente; el servidor siempre re-valida |
| Base de datos | PostgreSQL 16 | Extensiones `pg_trgm` y `unaccent` para búsqueda |
| ORM | Drizzle ORM + drizzle-kit | Driver `pg` (node-postgres), pool en `src/db/index.ts` |
| Tests | Vitest | `npm run test` |

Scripts relevantes: `db:push`, `db:generate`, `db:migrate` (drizzle-kit), `db:seed` (`tsx src/db/seed.ts`) y `demo` (push + seed + dev).

## Decisión: Drizzle vs Prisma

Se eligió **Drizzle ORM** sobre Prisma por razones concretas del contexto de despliegue y del dominio:

- **JS puro, sin binarios nativos.** Prisma descarga engines nativos en `postinstall`; esa descarga **falla con frecuencia detrás de proxys TLS corporativos** (interceptación de certificados), que es exactamente el tipo de entorno donde se construye y despliega este proyecto. Drizzle es TypeScript puro sobre el driver `pg`: `npm install` no toca la red más allá del registry.
- **SQL explícito.** El dominio exige control fino: locks pesimistas (`SELECT ... FOR UPDATE` en la reserva de stock), agregados sobre el ledger de inventario, secuencias (`order_number_seq`), `pg_trgm`/`unaccent` en búsqueda. Drizzle permite bajar a SQL con `sql\`...\`` sin abandonar el tipado.
- **Migraciones por drizzle-kit** (`generate`/`migrate`/`push`): SQL versionado y legible, sin formato propietario.
- **Trade-off asumido:** menos "magia" (no hay cliente generado con relaciones implícitas tan ricas como Prisma Client); a cambio, más control y cero sorpresas en runtime. Los joins y agregados se escriben a mano y quedan visibles en el código de dominio.

## Aplicación única modular (monolito modular)

El sistema es **una sola aplicación Next.js** con límites de dominio en `src/modules/*`. Apps separadas (storefront / admin / driver) **se considerarán en fase 4**.

Por qué monolito modular primero:

- Un solo despliegue, una sola BD, una sola transacción: el vertical slice (checkout → reserva → pago) es atómico sin coordinación distribuida.
- El equipo y la operación son pequeños; separar apps hoy multiplicaría infraestructura sin beneficio.
- Los límites ya existen a nivel de módulo: si en fase 4 se separan apps, los módulos de dominio se extraen tal cual porque no dependen de UI.

### Módulos de dominio (`src/modules/*`)

| Módulo | Responsabilidad |
|---|---|
| `config` | Configuración viva tipada (tabla `settings` + Zod), horarios (`schedule.ts`) |
| `catalog` | Categorías, productos, búsqueda con sinónimos + trigram |
| `inventory` | Ledger de movimientos, reservas, ajustes auditados |
| `orders` | Checkout transaccional, máquina de estados, peso real |
| `payments` | Intentos de pago, webhooks, reembolsos, `PaymentProvider` |
| `delivery` | Zonas, cotización de envío, asignación de domiciliario, entrega con código |
| `restricted` | Motor de reglas configurables para productos restringidos (licor, cigarrillos) |
| `commission` | Cálculo transparente y configurable de la comisión de agencia |
| `messaging` | Notificaciones transaccionales (`MessagingProvider`) |
| `pos` | Sincronización con el POS del negocio (`POSProvider`, CSV en MVP) |
| `marketplace` | Pedidos Rappi/DiDi (`MarketplaceProvider`, manual en MVP) |

### Reglas de dependencia entre módulos

- Todos los módulos pueden depender de `src/db` y `src/lib/*` (ids, money, audit, auth). Nunca al revés.
- `config` no depende de ningún otro módulo; es la base que todos consumen (`getSetting`).
- `orders` es el orquestador del slice: usa `inventory` (reservas), `payments` (intento de pago), `restricted`, `delivery` (cotización), `config` y `messaging`.
- `orders/state.ts` es la **única puerta** de cambio de estado; `payments` y `delivery` transicionan pedidos solo a través de `transitionOrder`.
- `inventory` no conoce pedidos más allá del `orderId` de referencia; nunca importa desde `orders`.
- Los adapters (`pos`, `marketplace`, `payments/sandbox`, `messaging`) implementan interfaces del propio módulo; el resto del sistema depende de la interfaz, no de la implementación.
- Los módulos aceptan `DbOrTx` (ver `src/db/index.ts`), de modo que las operaciones se componen dentro de una misma transacción.

## Patrón de adapters/providers intercambiables

Cada integración externa se abstrae detrás de una interfaz TypeScript. La implementación activa se selecciona por variable de entorno (`PAYMENT_PROVIDER`, `MESSAGING_PROVIDER`) o por adapter concreto.

### `PaymentProvider` (`src/modules/payments/provider.ts`)

```ts
export interface PaymentProvider {
  readonly name: string;
  createIntent(input: CreatePaymentIntent): Promise<PaymentIntentResult>;
  /** Verifica la firma de un webhook entrante. */
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;
  /** Extrae del payload el evento normalizado. */
  parseWebhook(rawBody: string): {
    externalEventId: string;
    providerRef: string;
    status: "approved" | "rejected" | "expired";
  };
}
```

Implementada hoy: `SandboxPaymentProvider` (demo, webhooks firmados HMAC-SHA256 contra nuestro propio endpoint). *Fase 2:* `WompiProvider` / `MercadoPagoProvider` con el mismo contrato. Regla de oro: el estado de un pago solo cambia por confirmación del servidor (webhook verificado o rol autorizado), nunca por el navegador.

### `MessagingProvider` (`src/modules/messaging/service.ts`)

```ts
export interface MessagingProvider {
  readonly name: string;
  send(message: { to: string; template: string; body: string }): Promise<{ status: string }>;
}
```

Implementada hoy: `ConsoleMessagingProvider` (deja el mensaje en la tabla `notifications` con status `simulated`, inspeccionable desde Admin). *Fase 2:* `WhatsAppCloudProvider` contra la API oficial de WhatsApp Business.

### `POSProvider` (`src/modules/pos/provider.ts`)

```ts
export interface POSProvider {
  readonly name: string;
  /** Importa catálogo/precios/stock desde el POS (CSV en el MVP). */
  importProducts(source: string): Promise<ImportResult>;
  /** Exporta ventas digitales para registrarlas/conciliarlas en el POS. */
  exportSales(rows: SalesExportRow[]): Promise<string>;
}
```

Implementada hoy: `CsvPosAdapter` — el POS actual (Treinta) no ofrece API pública, así que el MVP importa/exporta por archivos. El stock importado se **concilia contra el ledger** con movimientos de ajuste (nunca se pisa el número), y cada corrida queda registrada en `sync_jobs`. Prohibido: scraping de Treinta o guardar sus credenciales. Si Treinta publica API, se escribe `TreintaApiAdapter` con este mismo contrato.

### `MarketplaceProvider` (`src/modules/marketplace/provider.ts`)

```ts
export interface MarketplaceProvider {
  readonly name: string;
  /** Recibe/importa pedidos nuevos del marketplace. */
  pullOrders(): Promise<MarketplaceOrder[]>;
  /** Publica disponibilidad de productos mapeados. */
  pushAvailability(updates: { externalProductId: string; available: boolean }[]): Promise<void>;
}
```

Implementada hoy: `ManualMarketplaceAdapter` — no hay acceso oficial verificado a las APIs de Rappi/DiDi, y por política del proyecto no se implementan integraciones falsas. Los pedidos de marketplace se registran manualmente con id externo y comisión; el dedupe usa la clave única `(channel, marketplace_order_id)`. *Fase futura:* `RappiApiAdapter` empezando por su sandbox.

## Vertical slice completo (flujo del pedido)

```
Catálogo → Carrito → placeOrder() [transacción]:
  1. Valida horario del canal (settings hours.delivery / hours.pickup)
  2. Carga variantes desde BD (precios y flags del servidor, nunca del navegador)
  3. Motor de restringidos (settings restricted.rules)
  4. Calcula totales en servidor (COP enteros; peso en gramos)
  5. Cotiza envío por zona (delivery_zones + settings delivery.freeFromCop)
  6. En una transacción:
     - nextval('order_number_seq') → número MC-1001
     - INSERT orders + order_items
     - reserveStock() por línea (SELECT ... FOR UPDATE, disponible = ledger − reservas)
     - transitionOrder → pending_payment
     - createPayment() idempotente → intento sandbox con redirectUrl
     - notifyOrderEvent("order_created")
→ Pago sandbox (/pago-sandbox/[ref]) dispara webhook firmado HMAC-SHA256
→ processPaymentWebhook(): dedupe (provider, event_id), estado final no se re-procesa,
  pago approved → pedido paid → confirmed → preparing
→ Peso real: recordActualWeight() recalcula línea y total; si la diferencia supera
  orders.weightTolerancePctBps → weight_adjustment_pending (aprobación)
→ ready → assignDriver() crea delivery con confirmationCode → assigned
→ markPickedUp() → out_for_delivery
→ markDelivered(): valida código (y verificación de cédula si idCheckRequired)
  → delivered → consumeReservations(): reservas consumed + movimientos "sale" en el ledger
→ La venta queda como venta digital atribuible → base de la comisión de agencia
  (computeCommission con settings commission.base)
```

Cancelación o pago fallido en cualquier punto libera las reservas (`releaseReservations`). Métodos offline (efectivo/datáfono/transferencia) confirman el pedido de inmediato y el pago se concilia al recibir.

## Configuración viva (tabla `settings`)

**Nada operativo está hardcodeado.** `src/modules/config/keys.ts` define cada clave con su esquema Zod y su default documentado; los valores viven en la tabla `settings` y se editan desde Admin → Configuración con auditoría (`settings.update` en `audit_events`). Ejemplos: `hours.store` / `hours.delivery` / `hours.pickup` (hoy 07:00–23:00 local y 08:00–20:00 domicilios; ampliar a 24h es un cambio de datos, no de código), `orders.weightTolerancePctBps`, `delivery.freeFromCop`, `restricted.rules`, `commission.base`, `search.synonyms`, `catalog.enablePoundUnit`.

## Manejo de dinero

- Todo importe es **entero en COP** (el comercio minorista colombiano no usa centavos). Nunca `float`.
- `src/lib/money.ts`: `assertMoney` (entero ≥ 0), `applyBps` (porcentajes en basis points, 1000 bps = 10%), `weightLineTotal` (precio por kg/l × gramos/ml ÷ 1000, redondeo half-up).
- Pesos y volúmenes variables siempre en **gramos/mililitros enteros**.

## Procesamiento en segundo plano

- **MVP:** todo es **síncrono dentro de la transacción** del caso de uso. Las notificaciones se escriben en la tabla `notifications`, que funciona como **cola inspectable** (status `queued|sent|simulated|failed`) visible en el panel admin. Los trabajos de sincronización POS quedan en `sync_jobs` con resumen y errores fila a fila.
- **Fase 2:** worker dedicado que drena `notifications` y ejecuta `sync_jobs` fuera de la petición HTTP, sin cambiar el modelo de datos.

## Diagrama de componentes

```
                          ┌──────────────────────────────────────────┐
                          │            Next.js 15 (App Router)       │
                          │  Storefront PWA · Admin · Driver (rutas) │
                          │  RSC + Server Actions · RHF + Zod        │
                          └───────────────────┬──────────────────────┘
                                              │
              ┌───────────────────────────────┼───────────────────────────────┐
              │                     src/modules/* (dominio)                    │
              │                                                                │
              │  config ◄─── (getSetting) ─── orders ───► inventory            │
              │    ▲                            │  │         (ledger+reservas) │
              │    │                            │  └──► restricted             │
              │  catalog                        ├─────► payments ──► Provider  │
              │                                 ├─────► delivery      sandbox  │
              │  commission ◄── (ventas         └─────► messaging ──► console  │
              │                  entregadas)                                   │
              │  pos (CSV adapter)      marketplace (manual adapter)           │
              └────────────────┬───────────────────────────────────────────────┘
                               │  src/lib: ids · money · audit · auth(session,
                               │            permissions, password, rate-limit)
                               ▼
                  ┌─────────────────────────────┐      ┌────────────────────┐
                  │  Drizzle ORM (pg pool)      │      │ Webhook endpoint   │
                  │  PostgreSQL 16              │◄─────┤ (HMAC-SHA256       │
                  │  pg_trgm · unaccent · seq   │      │  verificado)       │
                  └─────────────────────────────┘      └────────────────────┘
```
