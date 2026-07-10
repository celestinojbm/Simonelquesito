# Estado real del proyecto — Informe de traspaso

> Documento de handoff para continuar el trabajo con otro asistente sin perder
> contexto. **Todo lo afirmado aquí se verificó contra el código, el esquema, las
> migraciones y el historial del repositorio** (no contra recuerdos de
> conversación). Las rutas se citan como `archivo:línea`. Fecha del corte:
> 2026-07-10. Último commit al escribir: `73660a8`.

---

## 1. Resumen ejecutivo

- **Nombre del proyecto.** Marca comercial: **“Simón El Quesito”** (definida en
  `src/db/presets.ts:187`, preset `salsamentaria`). Nombre técnico del paquete:
  `salsamentaria` (`package.json`). Es una **instancia de la plantilla
  replicable** `celestinojbm/marketcastilla` (documentado en el encabezado del
  esquema `src/db/schema.ts:2` y en `.env.example`).
- **Problema que resuelve.** Gestión operativa de una tienda física tipo POS:
  inventario por ledger, ventas en mostrador, pedidos, fiado (crédito de barrio),
  catálogo y configuración del negocio.
- **Tipo de negocio.** Salsamentaria en Bogotá (embutidos, carnes frías, quesos,
  charcutería) — núcleo perecedero y vendido por peso. El preset trae 9
  categorías propias (`src/db/presets.ts:163-206`).
- **Objetivo actual.** Operar **solo el panel administrativo y el reparto**: es un
  despliegue *admin-only* — el storefront público está apagado por configuración
  (`STOREFRONT_ENABLED=false`, `src/middleware.ts:25-38`). El código de la tienda
  pública `(store)` sigue existiendo pero no se sirve.
- **Estado general estimado.** **Avanzado en el núcleo, incompleto en la
  operación de tienda “de verdad”.** Motor de inventario, pedidos, caja, fiado,
  catálogo, permisos y configuración implementados y desplegados en producción.
  Faltan piezas clásicas de un POS de mostrador (arqueo de caja, recibos,
  compras, gestión de usuarios desde UI) y hay varias fuentes de descuadre de
  inventario documentadas (§7.11).
- **Qué puede usar ya la cliente.** Iniciar sesión, cargar/editar catálogo,
  registrar entradas de inventario y lotes con vencimiento, vender en la caja
  física (escáner + balanza), tomar pedidos internos, gestionar entregas y llevar
  el fiado. Desplegado y accesible en **https://simonelquesito.vercel.app**.
- **Qué sigue incompleto / simulado / sin probar.**
  - **Simulado:** mensajería/WhatsApp (`MESSAGING_PROVIDER=console`), pagos
    (`PAYMENT_PROVIDER=sandbox`), correo (`EMAIL_PROVIDER=console`).
  - **Solo esquema (tabla sin código):** caja/arqueo (`cash_sessions`), gastos
    (`expenses`), compras/proveedores/cuentas por pagar
    (`purchase_orders`/`suppliers`/`payables`).
  - **Sin UI:** gestión de usuarios y edición de permisos.
  - **No implementado:** recibos/facturación, impresión, exportación PDF/Excel,
    stock mínimo, traslados, multi-sucursal real, impuestos calculados.
  - **Datos:** el negocio corre con **datos demo** (8 usuarios `*.demo`,
    9 categorías, 1 zona, **sin productos**); faltan razón social, NIT, dirección,
    catálogo real, etc. (ver `docs/PENDING_DATA.md`).

---

## 2. Alcance funcional actual

Leyenda de estado: **[OK]** implementado y probado · **[PARCIAL]** implementado
parcialmente · **[SIN PRUEBA]** implementado pero sin prueba automatizada ·
**[UI]** solo interfaz · **[PLAN]** planificado / solo esquema · **[FUERA]**
descartado o retirado del panel.

| Módulo | Estado | Rutas / Archivos | Acciones / Endpoints | Tablas | Notas y límites |
|---|---|---|---|---|---|
| **Punto de venta (Caja)** | [SIN PRUEBA] | `/admin/caja` · `caja/page.tsx`, `caja-client.tsx` | `posLookupAction`, `posSearchAction`, `posSaleAction` (`actions/pos.ts`) → `registerPosSale` (`modules/pos/sale.ts`) | `orders`, `order_items`, `payments`, `inventory_movements`, `inventory_reservations` | Funcional: escáner USB + balanza Web Serial + pesados. **Sin** descuento, pago combinado, vuelto, recibo ni sesión de caja. |
| **Registro de ventas** | [OK] | Caja + `/admin/pedidos` | `registerPosSale`, `transitionOrder` | `orders`, `order_status_events` | Cada venta es un pedido real (`pos_physical`) pagado/entregado. Cubierto indirectamente por `tests/vertical-slice.test.ts`. |
| **Inventario** | [OK] núcleo | `/admin/inventario` | `adminAdjustStock`, `adminReceiveLot`, `adminDiscardLot` | `inventory_movements`, `inventory_reservations`, `inventory_lots`, `inventory_locations` | Stock = ledger. Ver §7 (probado en `tests/inventory-lots.test.ts`) y §7.11 (riesgos de deriva). |
| **Productos** | [SIN PRUEBA] | `/admin/productos`, `.../[id]`, `.../asistente`, `.../imagenes` | `adminCreateProduct`, `adminUpdateProduct`, `adminSetProductActive`, `analyzeProductAction` | `products`, `product_variants`, `product_images`, `prices` | Alta manual, por foto (IA/Claude) y por CSV. Historial de precios auditable. |
| **Categorías** | [OK] | Se siembran del preset | (seed) | `categories` | 9 categorías de salsamentaria. Sin CRUD de categorías desde UI. |
| **Variantes / peso / unidades** | [OK] | En productos | — | `product_variants` | `unit/pack/kg/g/l/ml/lb`; venta por peso con balanza. Sin conversión entre presentaciones (§7.7). |
| **Entradas/salidas de inventario** | [OK] | `/admin/inventario` | `adminReceiveLot`, `adminAdjustStock` | `inventory_movements` | Tipos `purchase_receipt/initial/adjustment/shrinkage/return_in/sale`. `transfer` y `return_out` definidos pero **sin uso** (§7.2). |
| **Ajustes de inventario** | [OK] | `stock-adjust.tsx` | `adminAdjustStock` | `inventory_movements` | Exige motivo; auditado. |
| **Compras** | [PLAN] | — | — | `purchase_orders`, `purchase_order_items`, `purchase_receipts` | Tablas existen, **sin código que las lea/escriba**. |
| **Proveedores** | [PLAN] | — | — | `suppliers` | Solo esquema. |
| **Clientes** | [PARCIAL] | Vía Fiado / pedidos | `enrollInStoreAction`, checkout | `customers`, `customer_addresses`, `consents` | No hay pantalla dedicada de “Clientes”; se crean al fiar o al pedir. |
| **Cuentas por cobrar (Fiado)** | [OK] | `/admin/fiado` | `creditPurchaseAction`, `creditPaymentAction`, `creditLimitAction`, `creditStatusAction`, `archive/restore` | `credit_accounts`, `credit_plans`, `credit_installments`, `credit_ledger` | Ledger inmutable, cupos, cuotas, mora, archivado 90d. Probado en `tests/credit-membership-fold.test.ts`. |
| **Cuentas por pagar** | [PLAN] | — | — | `payables` | Solo esquema. |
| **Caja (apertura/cierre/arqueo)** | [PLAN] | — | — | `cash_sessions` | Tabla con `openingCop/closingCop/expectedCop` pero **ningún código la usa** (solo aparece en el `DELETE` del seed). |
| **Gastos** | [PLAN] | — | — | `expenses` | Tabla sin ninguna lectura/escritura en la app. |
| **Devoluciones** | [PARCIAL] | `stock-adjust.tsx` (return_in) | `adminAdjustStock`, refunds de pago | `refunds`, `inventory_movements` | Solo ajuste manual `return_in`. **El reembolso no reingresa stock automáticamente** (§7.11-e). |
| **Descuentos** | [PARCIAL] | Checkout / cupones | `previewCouponAction`, `createPromotionAction` | `promotions`, `coupons` | Motor de cupones probado (`tests/personal-coupon.test.ts`), pero **la Caja no aplica descuentos**; sección Promociones retirada del panel. |
| **Impuestos** | [PLAN] | — | — | (`product_variants.tax_rate_bps`, `orders.tax_cop`) | Campos existen pero **ni checkout ni POS calculan impuesto**; precio es IVA-incluido sin desglose. |
| **Facturación / Recibos** | [PLAN] | — | — | — | No hay generación de factura ni recibo. |
| **Reportes / Dashboard** | [SIN PRUEBA] | `/admin` (Dashboard), `/admin/analitica` | consultas server-side | (varias) | Dashboard: ventas del día por canal, top ventas, stock bajo, lotes por vencer. Analítica: rangos + barras. |
| **Usuarios** | [PARCIAL] | — | — | `users` | Modelo y hashing existen, pero **no hay UI para crear/editar usuarios**; solo se crean por seed. |
| **Roles y permisos** | [PARCIAL] | Guardas en código | `roleHas`, `requirePermission` | `role_permissions` | Matriz de 8 roles (`lib/auth/permissions.ts`). Materializada en BD para edición, pero **sin pantalla de edición**. |
| **Auditoría** | [PARCIAL] | (visor retirado) | `recordAudit` | `audit_events` | El **registro** funciona y se usa (inventario, precios, fiado…); el **visor** `/admin/auditoria` fue retirado del panel. |
| **Alertas de inventario** | [PARCIAL] | Dashboard + Inventario | `listExpiringLots` | `inventory_lots` | Lotes por vencer: sí. **Stock mínimo/reorden: no existe** (sin campo `minStock`). |
| **Vencidos / próximos a vencer / Lotes / Fechas venc.** | [OK] | `/admin/inventario` | `receiveLot`, `discardExpiredLot`, `listExpiringLots` | `inventory_lots` | FEFO real. Probado. |
| **Códigos de barras** | [SIN PRUEBA] | Caja + alta de productos | `posLookupAction` | `product_variants.barcode` | Escáner USB (teclado) en caja; `@zxing` para leer con cámara en alta. |
| **Impresión** | [PLAN] | — | — | — | Sin `window.print()` ni impresión de tickets/etiquetas. |
| **Exportación PDF/Excel/CSV** | [PARCIAL] | — | `adminImportCsv` | — | **Solo IMPORTA** CSV (POS/Treinta). No hay exportación PDF/Excel/CSV (sin librerías). |
| **Configuración del negocio** | [SIN PRUEBA] | `/admin/configuracion` (+ `/fondos`, `/panel`) | `updateSettingAction`, `setAdminPanelAction` | `settings`, `section_backgrounds` | Editor de settings tipados (horarios, contacto, crédito, comisión, marca…). |
| **Sucursales** | [PLAN] | — | — | `branches`, `inventory_locations` | Esquema multi-sucursal, pero la lógica asume **una sola ubicación** (§7.4). |
| **Integraciones externas** | [FUERA]/[SIM] | (retirado) | `disconnectMercadoPagoAction`, callback OAuth | `integration_accounts` | Mercado Pago/WhatsApp/POS en modo sandbox/console; sección Integraciones retirada del panel. |
| **Mensajes / WhatsApp bot** | [SIM] | `/admin/mensajes` (bot retirado) | `toggle/reply/simulate` | `notifications`, `wa_conversations`, `wa_messages` | Consola de mensajes activa; envío real requiere cuenta Meta (`console` por ahora). |
| **Canastas recurrentes** | [FUERA] | (retirado) | `subscriptions.ts` | `subscriptions`, `subscription_items` | Código existe; sección retirada del panel; cron eliminado. |
| **Premium / membresías** | [FUERA] | (retirado de Fiado) | `cancelMembershipAction` | `memberships`, `membership_charges` | Extraído de la UI de Fiado; tablas/lógica dormidas. |
| **Reparto (repartidor)** | [SIN PRUEBA] | `/repartidor` | `driverPickUp`, `driverDeliver`, `driverIncident`, `/api/driver/location` | `deliveries`, `drivers` | Vista del domiciliario con reporte de ubicación GPS. |
| **Uso móvil/tablet/escritorio** | [SIN PRUEBA] | Todo el panel | — | — | UI responsive (Tailwind, `md:` breakpoints, nav inferior móvil). |
| **Offline / contingencia sin internet** | [PLAN] | — | — | — | **No hay operación offline.** Todo es server-rendered contra la BD; hay `sw.js` (instalación PWA) pero no transacciones offline. |

---

## 3. Flujos completos existentes

### 3.1 Crear un producto
- **UI:** `/admin/productos` → “Asistente” (foto/voz/texto con IA) o alta manual;
  edición en `/admin/productos/[id]`.
- **Backend:** `adminCreateProduct`/`adminUpdateProduct` (`actions/admin.ts`).
  Valida con Zod; genera `slug`/`sku`; guarda variante con `saleUnit`, `priceCop`,
  `costCop` (manual), `barcode`. Si es por peso, `costCop`/precio se guardan por kg
  (`admin.ts:226`).
- **Datos:** `products`, `product_variants`, `product_images`, `prices` (historial).
- **Validaciones:** permiso `catalog.manage`; unicidad de `slug`/`sku`.
- **Casos límite sin control:** no valida colisión de `barcode` en el formulario;
  no exige stock inicial.

### 3.2 Registrar inventario inicial
- **UI:** `/admin/inventario` → “Ajustar” → tipo *inicial*.
- **Backend:** `adminAdjustStock` → `adjustStock` (`inventory/service.ts:327`),
  inserta movimiento `initial` (positivo) y auditoría.
- **Datos:** `inventory_movements`.
- **Límites:** entradas positivas **no crean lote** (sin vencimiento); para eso se
  usa “Recibir lote”.

### 3.3 Recibir mercancía (con lote y vencimiento)
- **UI:** `/admin/inventario` → “Recibir lote” (`lot-receive.tsx`).
- **Backend:** `adminReceiveLot` → `receiveLot` (`service.ts:206`): crea
  `inventory_lots` + movimiento `purchase_receipt` + auditoría, en transacción.
- **Datos:** `inventory_lots`, `inventory_movements`, `audit_events`.
- **Límites:** **no existe recepción desde una orden de compra** (las tablas de
  compras no se usan); no recalcula costo.

### 3.4 Realizar una venta en caja (POS)
- **UI:** `/admin/caja`. Campo de escaneo siempre enfocado (pistola USB = teclado,
  Enter agrega). Pesados: buscar producto + balanza Web Serial (o gramos a mano).
  Elegir medio de pago (efectivo/datáfono/transferencia) → “Registrar venta”.
- **Backend:** `posSaleAction` → `registerPosSale` (`pos/sale.ts:47`). En una
  transacción: crea `orders` (`channel: pos_physical`, número `MC-####`), inserta
  items, **reserva** stock, camina el pedido `confirmed→preparing→ready→delivered`
  (que **consume** inventario por FEFO) y registra `payments` (aprobado) + auditoría
  `pos.sale`. Idempotente por `idempotencyKey` de tiquete.
- **Datos:** `orders`, `order_items`, `inventory_reservations`,
  `inventory_movements`, `payments`, `audit_events`.
- **Validaciones:** cantidades enteras > 0; producto activo; idempotencia.
- **Casos límite / riesgos:** si el sistema tiene **menos** stock que lo vendido,
  **no bloquea**: infla el stock con un `adjustment` auditado y sigue (§7.11-b).
  **No hay descuento, ni pago combinado, ni cálculo de vuelto, ni impresión.**

### 3.5 Descontar inventario
- **Backend:** al pasar un pedido a `delivered`, `transitionOrder`
  (`orders/state.ts:91`) llama `consumeReservations` → `consumeByFefo`
  (`inventory/service.ts:172,113`): marca la reserva `consumed` e inserta
  movimientos `sale` negativos, descontando **primero de los lotes más próximos a
  vencer**.
- **Riesgo:** en productos por peso variable se descuenta la cantidad **estimada**,
  no la realmente pesada (§7.11-a).

### 3.6 Abrir y cerrar caja / arqueo
- **NO EXISTE.** La tabla `cash_sessions` está definida (`schema.ts:899-908`) pero
  **no hay ninguna función, acción ni pantalla** que abra/cierre caja ni cuadre
  efectivo. Es una brecha respecto a un POS de mostrador tradicional.

### 3.7 Registrar un gasto
- **NO EXISTE en la app.** Tabla `expenses` definida, sin lectura/escritura.

### 3.8 Hacer una devolución
- **Parcial.** No hay flujo “devolución de venta”. Se puede: (a) ajustar stock con
  tipo `return_in` en Inventario; (b) los reembolsos de pago viven en `refunds` y
  el estado `refunded` del pedido. **El reembolso no reingresa inventario
  automáticamente** (§7.11-e).

### 3.9 Consultar reportes
- **UI:** `/admin` (Dashboard) y `/admin/analitica`.
- **Backend:** consultas Drizzle server-side (ventas del día por canal, ticket
  promedio, top productos, stock bajo, lotes por vencer). Analítica con presets de
  rango y barras.
- **Límites:** sin exportación; sin P&L; no distingue por sucursal.

### 3.10 Crear usuarios y asignar permisos
- **NO EXISTE UI.** Los usuarios se crean **solo por el seed** (`src/db/seed.ts`).
  El modelo de permisos (`role_permissions`, `roleHas`, `requirePermission`) está
  implementado, pero **no hay pantalla** para dar de alta usuarios ni editar la
  matriz. Para agregar un usuario real hoy hay que insertarlo en la BD o ampliar
  el seed. **(Crítico para producción — ver §10 P1.)**

---

## 4. Arquitectura técnica

- **Lenguaje:** TypeScript (`strict`), ejecutado con Node 22/24.
- **Framework:** Next.js 15.5 (App Router, Server Components, Server Actions).
- **Frontend:** React 19; Tailwind CSS v4 (`@tailwindcss/postcss`); estado de
  cliente puntual con hooks/Context (`cart-context`, `toast`); formularios con
  `react-hook-form` + `@hookform/resolvers`.
- **Backend:** el mismo proceso Next (Server Actions + Route Handlers). Lógica de
  dominio en `src/modules/*`; helpers en `src/lib/*`.
- **Base de datos:** PostgreSQL 16 (Supabase en producción, **esquema aislado por
  inquilino** vía `search_path`). Dinero siempre en **COP enteros**; pesos en
  gramos/ml enteros — nunca float (`schema.ts:4-8`).
- **ORM:** Drizzle ORM 0.44 (`drizzle-orm`, `pg`); migraciones con `drizzle-kit`.
- **Autenticación:** propia. Cookie `mc_session` firmada con **HMAC-SHA256**
  (`SESSION_SECRET`), sesiones persistidas en tabla `sessions` (TTL 7 días),
  cookie `httpOnly`+`sameSite=lax`+`secure` en prod (`lib/auth/session.ts`).
  Contraseñas con **scrypt + salt** y `timingSafeEqual` (`lib/auth/password.ts`).
- **Autorización:** matriz de permisos por rol (`lib/auth/permissions.ts`,
  materializada en `role_permissions`); guardas `requirePermission` en páginas y
  acciones; filtrado del menú por `roleHas`.
- **Almacenamiento de archivos:** **sin bucket externo.** Imágenes de producto y
  fondos se guardan como **data-URI en la BD** y se sirven por
  `/api/images/[id]` y `/api/section-bg/[key]`.
- **Hosting / infraestructura:** Vercel (producción `simonelquesito.vercel.app`);
  Supabase (Postgres). `buildCommand` = `next build` (`vercel.json`) — el seed ya
  **no** corre en cada deploy (protegido tras el aprovisionamiento inicial).
- **Servicios externos (todos desacoplados tras interfaces):** Anthropic Claude
  (`@anthropic-ai/sdk`, asistente/visión), Mercado Pago (pagos, sandbox), WhatsApp
  Cloud API (mensajería, `console`), Resend (correo, `console`), Twilio Voice
  (bot de llamadas), Leaflet (mapas de reparto, opcional).
- **Sistema de estilos:** Tailwind v4 + variables CSS de marca inyectadas por
  `branding` (colores del preset).
- **Manejo de estado:** mínimo en cliente; la verdad vive en el servidor/BD.
- **Validaciones:** Zod en acciones/checkout y en el registro de settings
  (`modules/config/keys.ts`).
- **Reportes:** consultas SQL/Drizzle renderizadas server-side (sin motor BI).
- **PDF / impresión / etiquetas:** **no hay** (sin librerías; sin `print()`).
- **Pruebas:** Vitest — 9 suites (ver §5). Sin pruebas E2E de navegador.
- **CI/CD:** GitHub Actions (`.github/workflows/ci.yml`): levanta Postgres, corre
  `db:push`, `db:seed`, `typecheck`, `test`, `build`. Deploy por push a la rama
  (Vercel).
- **Monitoreo / logs / errores:** logs de Vercel; errores de dominio con clases
  propias (`PosError`, `InsufficientStockError`, `InvalidTransitionError`) y
  resultados `{ ok, message }` en acciones. Sin Sentry/observabilidad externa.

**Esquema de arquitectura (texto):**

```
Navegador (panel /admin, /repartidor)  ──HTTPS──►  Next.js en Vercel
   │  Server Components (lectura)                     │
   │  Server Actions (mutaciones)  ───────────────────┤
   │  Route Handlers /api/* (webhooks, imágenes, GPS) │
   │  Middleware (gateo STOREFRONT_ENABLED)           │
   └───────────────────────────────────────────────►  src/modules/* (dominio)
                                                        │  Drizzle ORM
                                                        ▼
                                            PostgreSQL / Supabase (esquema aislado)
Servicios externos (interfaces intercambiables, hoy en sandbox/console):
   Claude · Mercado Pago · WhatsApp Cloud · Resend · Twilio · Leaflet
Flujo de venta:  Caja → registerPosSale → reserva → estados → consumo FEFO → pago
Flujo de dinero: siempre COP enteros; inventario = ledger append-only.
```

---

## 5. Estructura del repositorio

```
Simonelquesito/
├─ src/
│  ├─ app/
│  │  ├─ (store)/         Tienda pública (APAGADA por middleware, código presente)
│  │  ├─ admin/           Panel: caja, pedidos, productos, inventario, mensajes,
│  │  │                   fiado, configuración, analítica, dashboard
│  │  ├─ repartidor/      Vista del domiciliario
│  │  ├─ api/             Route handlers: webhooks, imágenes, GPS, callbacks
│  │  └─ actions/         Server actions (mutaciones) por dominio
│  ├─ modules/            Lógica de dominio (orders, inventory, pos, credit, …)
│  ├─ lib/                auth, money, ids, audit, crypto, format, search, sku
│  ├─ components/         UI reutilizable (layout, cart, scale, map, ui, admin)
│  └─ db/                 schema.ts, seed.ts, presets.ts, index.ts (conexión)
├─ drizzle/               Migraciones SQL + meta/_journal.json
├─ tests/                 Vitest (9 suites)
├─ docs/                  Documentación (este archivo, PENDING_DATA, DEPLOY, …)
├─ public/                Íconos/logo (SVG), manifest, sw.js
├─ .github/workflows/ci.yml
├─ vercel.json            buildCommand = "next build"
├─ drizzle.config.ts      lee .env.local, dialect postgresql
├─ next.config.ts         images.unoptimized, serverActions bodyLimit 4mb
└─ package.json
```

- **Propósito de carpetas clave:** ver árbol. `src/app/(store)` es código de la
  plantilla madre que **se conserva pero no se sirve** (decisión de instancia, no
  código muerto — `src/middleware.ts:6-11`).
- **Archivos de entrada:** `src/app/layout.tsx` (raíz), `src/app/admin/layout.tsx`
  (guarda de sesión del panel), `src/middleware.ts`, `src/db/index.ts` (pool pg).
- **Configuración:** `next.config.ts`, `drizzle.config.ts`, `vercel.json`,
  `tsconfig.json`, `eslint.config.mjs`, `.github/workflows/ci.yml`.
- **Variables de entorno requeridas (nombres; ver `.env.example`):**
  `DATABASE_URL`, `SESSION_SECRET`, `STOREFRONT_ENABLED`, `BUSINESS_PRESET` (solo
  seed), `PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET`, `MESSAGING_PROVIDER`,
  `EMAIL_PROVIDER`. Opcionales/integración: `MERCADOPAGO_*`,
  `INTEGRATION_CREDENTIALS_KEY`, `APP_URL`, `WHATSAPP_*`, `RESEND_API_KEY`,
  `EMAIL_FROM`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `TWILIO_AUTH_TOKEN`,
  `VOICE_FORWARD_PHONE`, `WOMPI_*`, `MAPS_*`, `POS_PROVIDER`, `RAPPI_*`, `DIDI_*`.
  **Conexión de infra adicional en Vercel:** `DB_SEARCH_PATH` (enruta al esquema
  del inquilino) y opcional `DB_FORCE_SESSION_POOLER`/`DB_POOL_MAX`.
- **Scripts (`package.json`):** `dev`, `build`, `start`, `lint`, `typecheck`,
  `test`, `test:watch`, `db:push`, `db:generate`, `db:migrate`, `db:seed`, `demo`.
- **Comandos:** instalar `npm ci` · ejecutar `npm run dev` · probar `npm test` ·
  compilar `npm run build` · desplegar: push a la rama (Vercel). Sembrar demo:
  `BUSINESS_PRESET=salsamentaria npm run db:seed`.
- **Archivos viejos/duplicados/sin uso:** no se hallaron `.bak/.old/.tmp` ni
  residuos del starter de Next. `console.log` solo en `seed.ts` (legítimo).
  `src/modules/marketplace/provider.ts` es una interfaz placeholder (Rappi/DiDi).
  **Deuda técnica real:** módulos/tablas *dormidos* de funciones retiradas del
  panel (canastas, promociones, whatsapp bot, integraciones, premium, comisión,
  identidades) siguen en el código sin consumidores de UI.

---

## 6. Base de datos

- **Motor:** PostgreSQL 16 (Supabase en prod; esquema aislado por `search_path`).
- **Tamaño:** **59 tablas** y **14 enums** (`src/db/schema.ts`, 1280 líneas).
- **Convenciones:** IDs `text` con prefijo (`ord_`, `itm_`…); dinero COP entero;
  cantidades en unidad mínima; timestamps `withTimezone`.
- **Migraciones:** dos, en `drizzle/meta/_journal.json`:
  - `0000_init` — 46 tablas.
  - `0001_fixed_mesmero` — **corrige el drift**: agrega las 13 tablas faltantes
    (`credit_*`, `memberships`, `membership_charges`, `subscriptions`,
    `subscription_items`, `identity_verifications`, `verification_codes`,
    `wa_conversations`, `wa_messages`, `section_backgrounds`) + 26 `ALTER`
    (enums `payment_method`/`sales_channel`, columnas nuevas).
  - **Última migración = `0001_fixed_mesmero`**; con ella el esquema en disco
    coincide con `schema.ts` (la BD de prod se aprovisionó aplicando el esquema
    completo + 0001; CI usa `db:push` que reconcilia contra `schema.ts`).
- **Datos semilla (`src/db/seed.ts`):** 1 negocio + 1 sucursal (placeholders
  “PENDIENTE”), settings por defecto, matriz de permisos, **8 usuarios demo**
  (`*.demo`, contraseña `demo1234`), 1 ubicación de inventario por defecto, 1 zona
  de entrega demo, **9 categorías** del preset, cuenta de integración POS.
  **No siembra productos** (`seed.ts` lo dice: cada negocio importa su catálogo).
- **Datos de prueba:** los mismos demo (no hay datos reales cargados aún).

**Enums (14):** `role`, `order_status`, `fulfillment_type`, `payment_status`,
`payment_method`, `sale_unit`, `inventory_movement_type`, `reservation_status`,
`substitution_preference`, `delivery_status`, `sales_channel`,
`sync_job_status`, `purchase_order_status`, `commission_period_status`.

**Relaciones (diagrama textual, principales):**

```
businesses 1─* branches 1─* inventory_locations 1─* inventory_lots
                     └─* delivery_zones                  └─* inventory_movements *─1 product_variants
users 1─* sessions                                              inventory_reservations *─1 product_variants
users 1─1 drivers                                        categories 1─* products 1─* product_variants 1─* prices
customers 1─* customer_addresses / consents                               products 1─* product_images
customers 1─1 credit_accounts 1─* credit_plans 1─* credit_installments
              credit_accounts 1─* credit_ledger
customers 1─1 memberships 1─* membership_charges
customers 1─* subscriptions 1─* subscription_items
orders 1─* order_items *─1 product_variants
orders 1─* order_status_events / payments / (1─1) deliveries
payments 1─* refunds
suppliers 1─* purchase_orders 1─* purchase_order_items / purchase_receipts   (SIN USO)
suppliers 1─* payables                                                        (SIN USO)
promotions 1─* coupons ;  loyalty_accounts 1─* loyalty_transactions
audit_events (transversal) ; settings / section_backgrounds (config)
```

- **Índices/restricciones destacados:** únicos en `users.email`, `orders.number`,
  `orders.location_token`, `payments(provider,idempotency_key)`,
  `variants.sku`, `credit_accounts.customer`, `memberships.customer`,
  `webhook_events(provider,external_event_id)`; índices por FK y por
  `inventory_lots.expires_at`.
- **Riesgos de integridad / campos faltantes / redundancias:**
  - **Sin FK a `businessId` en muchas tablas** (products, categories, orders…): el
    aislamiento multi-negocio depende del **esquema por inquilino**, no de FKs.
  - **`customer_addresses.zone_id`, `orders.zone_id`** son `text` sin FK a
    `delivery_zones`.
  - **Falta** `product_variants.min_stock`/`reorder_point` (sin alerta de stock
    mínimo) y `units_per_pack` (sin conversión paquete→unidad).
  - **Tablas redundantes / sin uso hoy:** `purchase_orders`,
    `purchase_order_items`, `purchase_receipts`, `payables`, `cash_sessions`,
    `expenses`, y las de funciones retiradas (subscriptions, memberships,
    promotions/coupons, wa_*, loyalty_*, commission_*). No causan daño, pero
    inflan el esquema.
  - **`costCop`** existe pero no se mantiene como promedio (ver §7.6).

---

## 7. Inventario

> Parte crítica. El núcleo (ledger + FEFO + reservas con lock + auditoría) está
> **sólidamente implementado y probado** para producto por unidad. Verificado en
> `src/modules/inventory/service.ts`, `src/db/schema.ts:444-514`,
> `src/app/admin/inventario/*`, `src/modules/pos/sale.ts`,
> `src/modules/orders/state.ts`, `tests/inventory-lots.test.ts`.

### 7.1 Cálculo del stock — derivado, no columna
Stock **no** se almacena: se **deriva sumando `inventory_movements`**
(`getStock`, `service.ts:31-48`): `physical = Σ qty` por variante; `reserved =
Σ` reservas `active`; `available = physical − reserved`. La misma fórmula se
repite en SQL en la UI (`inventario/page.tsx:27-28`). Fuente de verdad:
`inventory_movements` (`schema.ts:477-496`).

### 7.2 Tipos de movimiento
`movementTypeEnum` (`schema.ts:93-102`): `purchase_receipt, sale, adjustment,
shrinkage, return_in, return_out, transfer, initial`. **`return_out` y
`transfer` están definidos pero nunca se producen** en el código.

### 7.3 Operaciones
- **Entradas:** `receiveLot` (con lote/vencimiento) o `adjustStock`
  (`initial`/`adjustment(+)`/`return_in`); import CSV concilia por `adjustment`.
  **No hay recepción desde orden de compra.**
- **Ventas:** `consumeReservations`→`consumeByFefo` al pasar a `delivered`.
- **Devoluciones:** solo `return_in` manual; `return_out` sin uso; el reembolso
  no reingresa stock.
- **Ajustes:** `adjustStock` (exige motivo, auditado).
- **Mermas:** `shrinkage` por ajuste negativo y `discardExpiredLot` (baja de lote).
- **Traslados:** **no implementados.**

### 7.4 Multi-sucursal — solo esquema
Hay `branches`/`inventory_locations`/`locationId`, pero **`getStock` no filtra por
ubicación** y todas las escrituras usan `getDefaultLocationId` (única ubicación
`isDefault`). `inventory_reservations` **no tiene ubicación**. → De facto **una
sola ubicación**; con >1 sucursal el stock se mezclaría.

### 7.5 Lotes + vencimientos (FEFO) — implementado y probado
`inventory_lots` con `expiresAt`/`qtyRemaining`. `consumeByFefo` ordena por
`expiresAt asc nulls last`; remanente sin lote cae a movimiento sin `lotId`.
`discardExpiredLot` y `listExpiringLots(5)` para alertas.

### 7.6 Costeo — parcial
Precio: `priceCop` + historial `prices` + `compareAtCop`. **Costo:** `costCop`
etiquetado “promedio” pero **se fija a mano** (alta/edición/CSV); `receiveLot` no
lo recalcula y `purchase_order_items.unitCostCop` no se usa. **Último costo y
margen: no implementados.**

### 7.7 Unidades y conversiones
`unit/pack/kg/g/l/ml/lb`; ledger en unidad mínima (g/ml). Conversión solo de
**visualización** (g→kg, ml→L). **Paquete:** sin `units_per_pack`; un “six pack”
es su propia variante con su propio stock → **sin conversión entre
presentaciones** de un mismo producto.

### 7.8 Prevención de stock negativo — parcial
Único guardado en `reserveStock` (`SELECT … FOR UPDATE` + `InsufficientStockError`)
para checkout y POS. **Huecos:** `adjustStock`/`consumeByFefo` no imponen piso en
0; en POS, si falta stock, **infla** el stock con un ajuste positivo en vez de
bloquear.

### 7.9 Alertas
Lotes por vencer: sí (dashboard + inventario). **Stock mínimo/reorden: no existe.**
Único “aviso”: filas con `available <= 0` en rojo (no configurable).

### 7.10 Trazabilidad / auditoría
Doble registro: ledger inmutable (`inventory_movements` con `reason/reference/
createdBy`) + `audit_events` (`recordAudit` en recepción, descarte, ajuste y
auto-ajuste de POS). **Hueco menor:** el consumo por venta no crea `audit_event`
propio (se apoya en `order_status_events`).

### 7.11 Defectos de diseño que causan deriva físico vs sistema (⚠ importante)
- **(a) Peso variable — deriva garantizada.** `recordActualWeight`
  (`modules/orders/weight.ts`) recalcula el **precio** con el peso real pero
  **no ajusta la cantidad reservada ni genera movimiento** por la diferencia →
  al entregar se descuentan los **gramos estimados**, no los cortados. En una
  salsamentaria (casi todo por peso) esto **descuadra el inventario en cada
  venta pesada**.
- **(b) Auto-ajuste silencioso en POS** (`sale.ts:150-173`): sube el stock del
  sistema para igualar lo vendido → **oculta mermas/robos**.
- **(c) Doble contabilidad de lotes:** `qtyRemaining` se lleva aparte del ledger;
  entradas positivas por `adjustStock` no crean lote → con el tiempo
  `Σ movimientos ≠ Σ qtyRemaining`.
- **(d) Sin piso en cero:** ajustes/consumos pueden dejar `physical` negativo.
- **(e) Reembolsos no restauran inventario:** `transitionOrder` no maneja
  `refunded` para reingresar stock.
- **(f) Ficción multi-ubicación:** todo colapsa a la ubicación por defecto.
- **(g) Costeo no ligado a recepción:** COGS/margen poco confiables.
- **(h) Reservas sin expiración:** no hay proceso que libere reservas de pedidos
  estancados (`pending_payment`) → deriva de **disponibilidad** (“agotado”
  falso).

---

## 8. Punto de venta y caja

Evidencia: `src/app/admin/caja/caja-client.tsx`, `src/modules/pos/sale.ts`,
`src/app/actions/pos.ts`, `src/modules/orders/state.ts`.

| Aspecto | Estado | Detalle |
|---|---|---|
| Flujo del carrito (tiquete) | **[OK]** | Agregar, sumar/restar unidades, eliminar línea, vaciar. |
| Búsqueda de productos | **[OK]** | En vivo (debounce) por nombre; `posSearchAction`. |
| Código de barras | **[OK]** | Pistola USB (teclado) con Enter; también SKU. |
| Productos por peso | **[OK]** | Balanza Web Serial (`scale-panel`) o gramos a mano. |
| Precios manuales | **[NO]** | El precio viene de la variante; no se edita en caja. |
| Descuentos | **[NO]** | POS fija `discountCop: 0`. Sin cupones en caja. |
| Impuestos | **[NO]** | No se calcula IVA/impoconsumo; precio IVA-incluido sin desglose. |
| Métodos de pago | **[PARCIAL]** | Efectivo / datáfono / transferencia — **uno por venta**. |
| Pagos combinados / split | **[NO]** | No soportado en caja. |
| Ventas a crédito (fiado) | **[NO en caja]** | El fiado se registra en `/admin/fiado`, no desde el tiquete. |
| Cambio / vuelto | **[NO]** | No se pide monto recibido ni se calcula vuelto. |
| Cancelación de venta | **[PARCIAL]** | Estado `cancelled` existe en la máquina de estados; **no hay botón de anular** una venta de caja ya registrada. |
| Devoluciones | **[PARCIAL]** | Ver §3.8 / §7.11-e. |
| Impresión de recibos | **[NO]** | Sin impresión/PDF; solo muestra “Venta MC-#### registrada”. |
| Numeración de ventas | **[OK]** | Secuencia Postgres `order_number_seq` → **`MC-####`** (prefijo heredado de Market Castilla, aún hardcodeado en `sale.ts:114`). |
| Apertura de caja | **[NO]** | Tabla `cash_sessions` sin código. |
| Cierre de caja / arqueo | **[NO]** | Idem. |
| Diferencias de caja | **[NO]** | Idem. |
| Turnos | **[NO]** | No hay concepto de turno. |
| Usuario asociado | **[OK]** | La venta guarda `acknowledgedBy`/auditoría con `rol:email`. |
| Historial | **[OK]** | Visible en `/admin/pedidos` (canal “Tienda física”) y última venta en caja. |
| Seguridad frente a edición/eliminación de ventas | **[OK, por diseño]** | Los pedidos **no se editan/borran**; todo cambio es una transición registrada en `order_status_events` + `audit_events`. Idempotencia por tiquete evita duplicados. |

**Resumen:** la caja es una **registradora ágil** (escáner + balanza + venta
inmediata con inventario y auditoría al día), pero **le faltan las piezas de un
POS de mostrador completo**: arqueo/turnos, recibo impreso, descuentos, vuelto y
pago combinado.

---

## 9. Interfaz y experiencia de usuario

- **Pantallas del panel (todas server-rendered, `force-dynamic`):** Dashboard,
  Analítica, Caja, Pedidos (+detalle, +nuevo), Productos (+detalle, +asistente,
  +imágenes), Inventario, Mensajes, Fiado, Configuración (+fondos, +panel).
  Repartidor: `/repartidor`. Auth: `/login`.
- **Navegación:** menú lateral (`admin-nav.tsx`) filtrado por permisos; en móvil,
  barra superior desplazable. Sección activa resaltada por prefijo.
- **Responsive:** Tailwind con breakpoints `md:`; el panel se refluye a una
  columna en móvil; la caja está pensada para tablet/escritorio con escáner.
- **Estados vacíos:** presentes (“Tiquete vacío”, “Sin cuentas de fiado”, “Sin
  pedidos activos”, etc.).
- **Estados de carga:** botones con “Procesando…/Registrando…”; carga diferida de
  la consola de Fiado y de Leaflet.
- **Mensajes de error / confirmaciones:** patrón `{ ok, message }` → banner de
  error (rojo) y `toast` de éxito; `window.confirm` en acciones destructivas
  (archivar fiado, descartar lote).
- **Accesibilidad:** uso de `aria-label`, roles `alert/status`, `sr-only`; foco
  gestionado en la caja. No auditada formalmente.
- **Problemas visuales / mockups / datos falsos visibles:**
  - **Logo:** es una **recreación en SVG** (aprobada), no el archivo de marca real
    (`docs/PENDING_DATA.md`).
  - **Login muestra credenciales demo** en pantalla (heredado de la plantilla) —
    los usuarios son `@marketcastilla.demo`.
  - **Prefijo `MC-`** en números de venta (heredado, no “SEQ-”/“SEQ salsamentaria”).
  - Datos de negocio “PENDIENTE” en pie de página/legales hasta cargar los reales.
- **Botones que no hacen nada / difíciles para no técnicos:** no se detectaron
  botones muertos en el panel activo; sí hay **fricción** para no técnicos en:
  configuración por “settings” JSON tipados, ausencia de pantalla de usuarios, y
  dependencia de hardware (balanza Web Serial requiere Chrome + permiso de puerto).

---

## 10. Seguridad y permisos

- **Inicio de sesión:** `loginAction` (`actions/auth.ts`) con **rate-limit**;
  contraseñas **scrypt+salt**; cookie de sesión **firmada HMAC** y persistida en
  BD (`lib/auth/session.ts`).
- **Sesiones:** TTL 7 días, revocables (`sessions.revokedAt`), cookie `httpOnly`
  + `sameSite=lax` + `secure` en prod. Verificación en cada request server-side.
- **Recuperación de contraseña:** **no existe** flujo de “olvidé mi contraseña”
  para staff (solo alta por seed / futura UI de usuarios).
- **Roles:** 8 (`customer, cashier, picker, driver, accountant, tech_admin,
  owner, admin`), con la regla de contrato: **`tech_admin` (agencia) nunca recibe
  permisos de dinero** (`bank_accounts.manage`, `payouts.manage`) — solo `owner`.
- **Permisos reales:** 31 permisos (`lib/auth/permissions.ts`), aplicados vía
  `requirePermission` en páginas y **dentro de cada acción sensible**.
- **Protección de rutas:** `admin/layout.tsx` redirige a `/login` si no hay
  sesión o el rol no corresponde; middleware apaga el storefront.
- **Protección de endpoints:** webhooks validan firma (HMAC sandbox;
  `x-signature` MP; `X-Hub-Signature-256` WhatsApp; token GPS de 128 bits) y hacen
  **dedupe** (`webhook_events`); la API de mapa se autentica por token opaco.
- **Validación front y back:** Zod en acciones/checkout/settings; la validación de
  negocio **siempre** ocurre en servidor (el cliente no decide precios/stock).
- **Exposición de secretos:** credenciales de integración **cifradas AES-256-GCM**
  (`lib/crypto.ts`, `INTEGRATION_CREDENTIALS_KEY`); `.env.local` nunca commiteado;
  no se detectaron secretos en el repo.
- **SQL injection:** bajo riesgo — Drizzle parametriza; los `sql\`\`` usan
  interpolación parametrizada.
- **XSS:** React escapa por defecto; imágenes/fondos como data-URI (sin HTML de
  usuario). Sin `dangerouslySetInnerHTML` con datos de usuario detectado.
- **CSRF:** Server Actions de Next (POST con verificación de origin) + cookie
  `sameSite=lax`. OAuth de MP usa `state` firmado.
- **Carga de archivos:** solo imágenes como data-URI vía Server Action con límite
  4mb; sin ejecución.
- **Eliminación de datos:** borrados suaves (fiado `archivedAt`); pedidos/ledger
  **no se borran**.
- **Auditoría:** `audit_events` transversal; **pero el visor fue retirado del
  panel** (el registro sigue).
- **Logs sensibles:** no se registran contraseñas ni tokens en claro; `seed.ts`
  imprime credenciales **demo** (esperado).
- **Dependencias:** stack moderno (Next 15.5, React 19, Drizzle 0.44); sin
  auditoría `npm audit` incluida en este informe.
- **Acceso entre negocios/usuarios/sucursales:** el aislamiento entre **negocios**
  se apoya en el **esquema por inquilino** (no en FKs/`businessId`), correcto para
  esta instancia mono-negocio; **entre sucursales no hay separación** (§7.4).

### Hallazgos priorizados

- **P0 — crítico:**
  - **Credenciales demo activas en producción** (`*.demo` / `demo1234`, listadas
    en la página de login). Cualquiera con la URL puede entrar como `owner`.
    **Acción:** crear usuarios reales y desactivar/borrar los demo antes de operar.
- **P1 — alto:**
  - **No hay UI de gestión de usuarios ni de permisos** → no se pueden crear
    usuarios reales sin tocar la BD/seed (§3.10).
  - **Sin recuperación de contraseña** para staff.
  - **Rol `postgres` en la conexión de producción** (más privilegiado de lo ideal;
    pendiente migrar al rol dedicado `salsamentaria` cuando el pooler lo sincronice
    — nota de infraestructura de sesiones previas).
  - **Descuadres de inventario** (§7.11 a/b/e/h) — impacto operativo real en una
    salsamentaria por peso.
- **P2 — medio:**
  - Visor de auditoría retirado (el registro existe, pero no hay forma de
    consultarlo desde el panel).
  - Prefijo `MC-` heredado en números de venta.
  - Datos de negocio “PENDIENTE” y logo placeholder.
  - Tablas muertas inflando el esquema (compras, caja, gastos, y funciones
    retiradas) — riesgo de confusión para quien retome el proyecto.

---

## Anexo — Cobertura de pruebas automatizadas (Vitest)

`tests/`: `commission`, `credit-membership-fold`, `inventory-lots` (FEFO),
`marketing-consent`, `mercadopago` (webhook), `money`, `personal-coupon`,
`restricted` (motor de restringidos), `vertical-slice` (flujo de pedido).
**No hay** pruebas de UI/E2E, ni de la caja/POS como tal, ni de la máquina de
estados completa.
