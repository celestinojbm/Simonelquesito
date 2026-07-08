# Market Castilla — Especificación de producto

PWA de comercio para minimarket de barrio (Castilla, Bogotá, Colombia). Documento de referencia funcional; el código en `src/` es la fuente de verdad técnica.

---

## 1. Visión

Llevar la tienda de barrio al canal digital **sin perder su trato cercano**: pedidos por web/PWA con domicilio o recogida, productos por peso como se venden en la plaza (banano por kilo, queso por libra), sustituciones conversadas por WhatsApp y venta responsable de productos restringidos. Todo parametrizable por el negocio (horarios, tolerancias, reglas, sinónimos) desde el panel — nunca hardcodeado — y con una relación transparente y auditable con la agencia digital que lo opera.

Principios de ingeniería que atraviesan el producto:

- Dinero siempre en **COP enteros** (nunca float); pesos en **gramos/ml enteros**.
- El stock nunca se edita directo: todo pasa por el **ledger** `inventory_movements`.
- Toda mutación crítica queda en `audit_events`.
- Precios y totales se calculan **siempre en el servidor** (`placeOrder` nunca confía en el navegador).
- Configuración versionada en la tabla `settings`, validada con Zod (`src/modules/config/keys.ts`).

## 2. Usuarios y roles (resumen de `src/lib/auth/permissions.ts`)

La matriz de permisos se siembra en BD (`role_permissions`) y es ajustable por el propietario. Regla contractual: **`tech_admin` (agencia) nunca recibe permisos de dinero** (`bank_accounts.manage`, `payouts.manage`, `commission.approve` son exclusivos del owner).

| Rol | Enum | Permisos clave |
|---|---|---|
| Cliente | `customer` | Sin permisos de back-office; compra, sigue pedidos, gestiona su perfil. |
| Cajero | `cashier` | `orders.view/manage`, `catalog.view`, `inventory.view`, `customers.view`, `payments.view`. |
| Preparador | `picker` | `orders.view/manage`, **`orders.adjust_weight`**, `catalog.view`, `inventory.view`. |
| Domiciliario | `driver` | Solo `delivery.view_own` (únicamente sus pedidos). |
| Contador | `accountant` | Solo lectura: `orders/catalog/inventory/customers/payments/reports/commission/settings/audit → *.view`. |
| Administrador | `admin` | Operación completa: pedidos (incl. cancelar y ajustar peso), catálogo, precios, inventario, compras, proveedores, clientes, campañas, cupones, delivery, reembolsos, reportes, comisión (ver), settings, reglas de restringidos, usuarios, auditoría, sincronización POS. |
| Admin técnico / agencia | `tech_admin` | Todo lo técnico/operativo **sin dinero**: catálogo, campañas, cupones, reportes, `commission.view`, settings, `integrations.manage`, auditoría, `pos.sync`. Sin reembolsos, sin pagos, sin payouts. |
| Propietario | `owner` | Todos los permisos, incluidos los exclusivos: `bank_accounts.manage`, `payouts.manage`, `commission.approve`. |

## 3. Experiencia del cliente (pantallas)

| Pantalla | Descripción | Estado |
|---|---|---|
| Inicio | Categorías con icono, ofertas destacadas (`compareAtCop`), buscador, estado abierto/cerrado según `hours.*`. | MVP (backend listo: `listCategories`, `listFeatured`) |
| Categorías | Grilla de productos por categoría, orden alfabético. | MVP |
| Búsqueda | Tolerante a errores: sinónimos configurables (`settings "search.synonyms"`), normalización de acentos y **pg_trgm** (similarity > 0.25) — "zanaoria" encuentra zanahoria. Sinónimos nuevos requieren aprobación del negocio. | MVP |
| Detalle de producto | Variantes (unidad/pack/kg/g/l/ml), precio por kg, peso estimado para venta por unidad de peso variable, nota por línea ("aguacates maduros"), sello de restringido. | MVP |
| Ofertas | Productos con precio tachado (`compareAtCop`). | MVP |
| Carrito | Líneas con nota, subtotal estimado si hay peso variable, aviso "el total puede variar al pesar". | MVP |
| Checkout invitado | Sin registro obligatorio: nombre + teléfono (+ dirección/barrio/zona si es domicilio). Preferencia de sustitución, franja de entrega, consentimiento de datos (obligatorio) y marketing (opcional), método de pago, verificación de restringidos si aplica. Idempotente por `idempotencyKey`. | MVP (`placeOrder`) |
| Seguimiento de pedido | Línea de tiempo con los estados y notificaciones WhatsApp simuladas (proveedor "console"). Código de confirmación de entrega. | MVP |
| Historial de pedidos | Pedidos del cliente autenticado con repetición rápida. | Fase 2 |
| Favoritos | Lista de recompra habitual. | Fase 2 |
| Perfil | Datos, direcciones (`customer_addresses`), consentimientos. | Fase 2 |
| Puntos | Saldo de fidelización (`loyalty_accounts`; 1 punto por cada $1.000 netos, configurable). | Fase 2 (esquema listo) |
| Cupones | Redención de códigos (`coupons`, ej. `BIENVENIDO10`). | Fase 2 (esquema listo) |
| Soporte WhatsApp | Botón directo al WhatsApp del negocio (número PENDIENTE). | MVP (enlace), conversacional en Fase 2 |
| Política de sustituciones | Preferencia por pedido: no sustituir / producto similar / contáctame / hasta un tope de precio (`substitution_pref`). | MVP (captura), flujo conversacional Fase 2 |
| Verificación de restringidos | Bloque en checkout: fecha de nacimiento declarada + aceptación de condiciones; aviso de verificación de cédula en la puerta. | MVP |

## 4. Flujo de peso variable

Implementado en `src/modules/orders/weight.ts`:

1. **Estimado en checkout**: el cliente pide por gramos (`saleUnit kg/g`) o por unidad de peso variable (`estimatedWeightG`, ej. aguacate ~250 g). El pedido queda con `isEstimatedTotal = true`.
2. **Peso real**: el preparador registra `actualWeightG` por línea; se recalcula `finalLineTotalCop` y el total del pedido.
3. **Tolerancia configurable** (`orders.weightTolerancePctBps`, default 1500 = 15%): si la diferencia frente al estimado la supera, el pedido pasa a `weight_adjustment_pending`.
4. **Aprobación**: el cliente (vía WhatsApp) o el admin aprueba el nuevo total; el pedido vuelve a `preparing` o pasa a `ready`. Todo queda auditado (`order.weight_recorded`) y se notifica (`weight_adjusted`).

## 5. Motor de productos restringidos

`src/modules/restricted/engine.ts` + reglas en `settings "restricted.rules"` (una por clase: `liquor`, `cigarettes`, …). **Configurable, nunca hardcodeado, y ninguna verificación técnica sustituye la validación legal.**

Cada regla define: horario de venta propio por día (separado del horario de tienda/domicilios), declaración de edad requerida, verificación de cédula en la entrega, modalidades permitidas (delivery/pickup), zonas excluidas y edad mínima (18). Comportamientos clave:

- Regla inexistente para una clase presente en el carrito → **venta bloqueada por precaución**.
- El checkout falla con la lista de violaciones (fuera de horario, menor de edad, sin aceptación de términos, zona excluida).
- Si la regla exige verificación de identidad, `markDelivered` **rechaza la entrega** si el domiciliario no marcó `idChecked`; se registra `idCheckedAt`.
- Las promociones excluyen restringidos por defecto (`excludesRestricted = true`).

## 6. Estados de pedido (máquina de estados, `src/modules/orders/state.ts`)

14 estados; `transitionOrder` es la **única puerta** de cambio: valida la transición, registra `order_status_events` (actor, motivo) y ejecuta efectos de inventario (cancelado/fallido → libera reservas; entregado → consume reservas y descuenta ledger).

| Desde | Hacia |
|---|---|
| `new` | `pending_payment`, `confirmed`, `cancelled` |
| `pending_payment` | `paid`, `failed`, `cancelled` |
| `paid` | `confirmed`, `cancelled`, `refunded` |
| `confirmed` | `preparing`, `cancelled` |
| `preparing` | `awaiting_substitution`, `weight_adjustment_pending`, `ready`, `cancelled` |
| `awaiting_substitution` | `preparing`, `cancelled` |
| `weight_adjustment_pending` | `preparing`, `ready`, `cancelled` |
| `ready` | `assigned`, `delivered` (recogida en tienda), `cancelled` |
| `assigned` | `out_for_delivery`, `ready`, `cancelled` |
| `out_for_delivery` | `delivered`, `ready` (devuelto al local), `cancelled` |
| `delivered` | `refunded` |
| `failed` | `pending_payment` (reintento), `cancelled` |
| `cancelled` / `refunded` | — (terminales) |

## 7. Delivery por zonas

`delivery_zones` por sucursal: lista de barrios (MVP sin polígonos de mapa), tarifa, pedido mínimo, envío gratis por zona o global (`delivery.freeFromCop`), ETA min–max y capacidad por franja. `quoteDelivery` valida cobertura y mínimo, y aplica envío gratis. Entregas con **código de confirmación** como prueba, foto opcional, método de pago recibido en puerta e incidencias registradas. Zonas y tarifas del seed son **demo** (reales PENDIENTES).

## 8. Promociones, cupones y fidelización

- `promotions`: tipos percent / fixed / two_for_one / combo / category_percent / free_delivery; mínimo de compra, tope de usos, presupuesto, ventana horaria, apilables opt-in, exclusión de restringidos por defecto.
- `coupons`: código único ligado a promoción, personal o de campaña, expiración.
- `loyalty_accounts` + `loyalty_transactions`: puntos por compra (`loyalty.pointsPer1000Cop`), redención con trazabilidad.
- Estado: esquema y seed en MVP (`BIENVENIDO10`); aplicación en checkout y panel de campañas en Fase 2.

## 9. CRM y segmentos

`customers` (invitado o registrado, teléfono como identificador), direcciones, `segments` (jsonb: frecuentes, inactivos, alto ticket), **consentimientos auditables** (`consents`: datos, edad, marketing WhatsApp). Nunca se envían campañas sin consentimiento de marketing registrado. Segmentación automática y campañas: Fase 2–3.

## 10. Panel administrativo (módulos)

| Módulo | Contenido | Estado |
|---|---|---|
| Dashboard | Pedidos del día por estado, alertas (stock bajo, vencimientos FEFO, ajustes de peso pendientes). | MVP básico |
| Pedidos | Lista + detalle: transiciones válidas, registro de peso real, sustituciones, asignación de domiciliario. | MVP |
| Preparación | Vista agrupada por `prepArea` (produce, grocery, refrigerated, beverages, liquor, cleaning) para recorrer la tienda una sola vez. | MVP |
| Catálogo y precios | Productos, variantes, historial de precios (`prices`), sinónimos de búsqueda. | MVP básico |
| Inventario | Ledger, reservas, lotes/vencimientos (FEFO), ajustes y mermas con motivo. | MVP básico (servicios listos) |
| Compras y proveedores | Órdenes de compra, recepciones (el stock solo sube al recibir), cuentas por pagar. | Fase 2 (esquema listo) |
| Clientes / CRM | Fichas, consentimientos, segmentos. | Fase 2 |
| Promos y cupones | CRUD de campañas y códigos. | Fase 2 |
| Mensajes | Bandeja de notificaciones WhatsApp (simuladas en demo, status `simulated`). | MVP |
| Caja y gastos | `cash_sessions`, `expenses`. | Fase 2 |
| Configuración | Editor tipado de `settings`: horarios por ámbito, reglas de restringidos, tolerancia de peso, envío gratis, comisión, sinónimos, unidad libra. Con auditoría. | MVP |
| Integraciones | Treinta (CSV import/export), Wompi/Mercado Pago, WhatsApp Cloud, Rappi/DiDi. Credenciales cifradas (AES-GCM). | MVP: POS CSV; resto Fase 2–3 |
| Auditoría | `audit_events` filtrable por entidad/acción. | MVP |
| Comisión | Ver §11. | MVP |

## 11. Atribución y comisión de agencia (transparente)

`src/modules/commission/service.ts`:

- Base **100% configurable** en `settings "commission.base"`: tasa (default 1000 bps = 10%), canales atribuibles (`web_pwa, whatsapp, rappi, didi, social` — nunca `pos_physical`), y qué se suma/deduce (envío, propina, impuestos, comisiones de pasarela y marketplace, descuentos, reembolsos).
- Solo cuentan pedidos **`delivered`** de canales atribuibles; cancelados/reembolsados se reportan aparte.
- `computeCommission` devuelve el **desglose completo** (ventas brutas, deducciones, neto, por canal) — el cálculo nunca se oculta.
- Cierre de periodo: snapshot **inmutable** en `commission_periods`, estado `pending_approval` → **aprobación exclusiva del owner** (`commission.approve`) → `approved/closed`. Ajustes manuales trazables en `commission_adjustments`. Todo auditado.

## 12. Alcance por fases

**MVP (vertical slice implementado en `src/`)**: esquema completo de BD (Drizzle + PostgreSQL), configuración tipada con defaults, catálogo con búsqueda tolerante, checkout transaccional invitado (horarios, zonas, restringidos, reservas de stock), máquina de 14 estados, peso variable con tolerancia y aprobación, motor de restringidos, delivery por zonas con código de confirmación y verificación de cédula, pagos **sandbox** + offline (contraentrega/datáfono/transferencia), WhatsApp simulado ("console"), permisos por rol, auditoría, comisión con desglose y aprobación, seed demo idempotente, adaptador CSV de Treinta.

**Fase 2**: UI completa de cliente y panel (Next.js), cuentas de cliente (historial, favoritos, direcciones, puntos, cupones en checkout), flujo conversacional de sustituciones, WhatsApp Cloud API real, Wompi/Mercado Pago/Nequi/Daviplata con webhooks, compras/recepciones, caja y gastos.

**Fase 3**: Rappi/DiDi (mapeo `external_product_mappings`), segmentación y campañas automáticas, reportes avanzados para contador, congelados y comida preparada (categorías futuras), múltiples sucursales si el negocio crece.
