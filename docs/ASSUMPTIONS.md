# Salsamentaria — Supuestos

Supuestos heredados de la plantilla (`marketcastilla`) más los propios de esta
instancia. Cada uno es reversible por configuración (tabla `settings`) o por
decisión del propietario; los marcados **PENDIENTE** requieren validación del
negocio antes de operar con datos reales — ver
[`PENDING_DATA.md`](./PENDING_DATA.md).

## Propios de esta instancia (salsamentaria, admin-only)

1. **Sin app de consumidores**: `STOREFRONT_ENABLED=false`. Todos los pedidos
   se toman por teléfono/WhatsApp y se registran en Admin → Pedidos → Nuevo
   (canal `manual`). El código del storefront público sigue en el repo pero
   desactivado (ver `src/middleware.ts`), por si más adelante se decide abrir
   venta en línea.
2. **Preset `salsamentaria`** (`src/db/presets.ts`): 9 categorías (embutidos y
   carnes frías, quesos, charcutería y encurtidos, lácteos y huevos,
   congelados, panadería, abarrotes, bebidas, aseo), venta por libra/kg
   habilitada, **sin reglas de restringidos por defecto**. Si el negocio
   vende cerveza, hay que agregar la categoría y reutilizar la regla
   `liquor` (ya existe en el motor) — PENDIENTE de confirmación.
3. **Lotes y vencimiento (FEFO) activos** para el control de merma de
   perecederos — la recepción de lote es manual desde Admin → Inventario
   (no hay órdenes de compra/recepción automatizadas; ese módulo sigue en
   Fase 2 según `PRODUCT_SPEC.md`).
4. **Prefijo de número de pedido heredado de la plantilla (`MC-####`)**: el
   checkout genera números `MC-1001`, `MC-1002`... — es un valor hardcodeado
   en `src/modules/orders/checkout.ts`/`src/modules/pos/sale.ts`, NO
   configurable todavía. Cosmético (no afecta la operación), pendiente de
   convertirse en un setting de plantilla si se quiere un prefijo propio.
5. **Nombre del negocio, marca y zona de cobertura son demo** (heredados del
   seed): hay que reemplazarlos vía `branding` y `delivery_zones` antes de
   operar — ver `PENDING_DATA.md`.

## Heredados de la plantilla (aplican igual en esta instancia)

6. **Tolerancia de peso 15%** (`orders.weightTolerancePctBps`): diferencias
   mayores entre peso estimado y real pasan el pedido a
   `weight_adjustment_pending` y requieren aprobación.
7. **Venta por libras activada** (`catalog.enablePoundUnit: true`): 1 libra =
   500 g. El sistema almacena gramos y precios por kilo; libras es solo la
   unidad que ve el staff.
8. **Pagos offline (efectivo, datáfono, transferencia) confirman el pedido
   automáticamente**; la conciliación del dinero ocurre al recibirlo. Con
   "link de pago" (sandbox), el pedido queda `pending_payment` hasta que el
   cliente paga.
9. **Pasarela sandbox sin comisión de pasarela** — un proveedor real (Wompi/
   Mercado Pago) la reportaría si se conecta más adelante.
10. **Una sola sucursal** por instancia; el esquema soporta multi-sucursal
    pero el checkout usa la primera sucursal activa.
11. **COP entero como unidad monetaria mínima** (nunca float); porcentajes en
    basis points.
12. **Pesos y volúmenes en gramos/mililitros enteros** como unidad mínima.
13. **Stock disponible = ledger − reservas activas**; reservas se liberan al
    cancelar/fallar y se consumen (por FEFO si hay lotes) al entregar.
    Ajustes y mermas siempre con motivo auditado.
14. **Checkout (interno) permite cliente sin cuenta**: nombre + celular
    bastan; el teléfono es el identificador principal.
15. **Cuentas demo con contraseña `demo1234`** solo para desarrollo; deben
    rotarse/eliminarse antes de operar con datos reales.
