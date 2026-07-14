# Salsamentaria — sistema de gestión (admin, inventario, pedidos, reparto)

Instancia de la plantilla replicable **marketcastilla** para una salsamentaria
(embutidos, carnes frías, quesos) en Bogotá. **Sin app de consumidores**: esta
instancia corre en modo admin-only (`STOREFRONT_ENABLED=false`) — solo
`/admin` y `/repartidor`. Los pedidos se toman por teléfono/WhatsApp y se
registran desde **Admin → Pedidos → Nuevo** (canal `manual`), reutilizando el
mismo motor de checkout/inventario/entrega de la plantilla. El inventario
tiene seguimiento de **lotes y vencimiento (FEFO)**, clave para perecederos.

> ⚠️ Esta instancia tiene datos pendientes de completar por el propietario
> (nombre real, NIT, dirección, colores de marca, zonas de reparto, etc.) —
> ver [`docs/PENDING_DATA.md`](docs/PENDING_DATA.md). El código de storefront
> público sigue presente (heredado de la plantilla) pero **desactivado**; ver
> `src/middleware.ts`.

> 📚 Documentación completa en [`docs/`](docs/): producto, arquitectura, modelo
> de datos, integraciones, seguridad, roadmap, plantilla replicable, supuestos
> y datos pendientes.

## Ejecutar localmente

Requisitos: **Node 20+** y **PostgreSQL 16** (local, sin servicios pagos).

```bash
# 1. Base de datos (una vez)
createdb salsamentaria   # o usa un usuario/BD propios

# 2. Configuración
cp .env.example .env.local   # ajusta DATABASE_URL y SESSION_SECRET
#    (STOREFRONT_ENABLED=false ya viene por defecto en este repo)

# 3. Instalar, crear esquema, sembrar (SOLO local) y levantar
npm install
npm run db:push
# db:seed es un RESET DEMO destructivo (borra y recrea datos/cuentas demo).
# Requiere DEMO_MODE=true y NUNCA corre en producción.
DEMO_MODE=true BUSINESS_PRESET=salsamentaria npm run db:seed
npm run dev                  # http://localhost:3000 → redirige a /login
```

### Cuentas de demostración (contraseña: `demo1234`)

Solo funcionan en **modo demo** (`DEMO_MODE=true`) fuera de producción: en
producción no se pueden crear, no autentican (ni con sesión previa) y no
aparecen en la pantalla de login. El propietario real se crea con
`npm run owner:create` (ver `docs/DEPLOY.md` y `docs/RUNBOOK_P0_DEMO.md`).

| Rol | Correo | Entra a |
|---|---|---|
| Propietario | `owner@marketcastilla.demo` | `/admin` (todo) |
| Administrador | `admin@marketcastilla.demo` | `/admin` |
| Cajero | `cajero@marketcastilla.demo` | `/admin` (pedidos) |
| Preparador | `preparador@marketcastilla.demo` | `/admin` (pedidos + peso) |
| Domiciliario | `domiciliario@marketcastilla.demo` | `/repartidor` |
| Contador (solo lectura) | `contador@marketcastilla.demo` | `/admin` (reportes) |
| Agencia técnica | `agencia@marketcastilla.demo` | `/admin` (sin dinero) |

### Probar el flujo completo (admin-only)

1. Ingresa como `admin@` → **Pedidos → + Nuevo pedido**: agrega productos
   (incluye embutidos/quesos por peso), datos del cliente y, si es domicilio,
   zona/dirección. Elige pago offline o "link de pago" (sandbox).
2. El pedido queda como cualquier otro: confirma → preparación → registra el
   **peso real** si aplica → listo → asigna domiciliario.
3. Ingresa como `domiciliario@` en `/repartidor` → marca recogido → entrega con
   el **código de confirmación**.
4. En **Admin → Inventario**, recibe mercancía con lote/vencimiento y observa
   la alerta de "Lotes por vencer" (FEFO) en el Dashboard y en Inventario.

### Pruebas

> 🔒 **Seguridad de datos.** `db:seed` y las pruebas solo aceptan bases
> **loopback** (localhost/127.0.0.1/::1): una `DATABASE_URL` remota se rechaza
> por diseño (`src/db/assert-local-db.ts`, sin bypass). Usa un Postgres local;
> nunca la base de producción. Las credenciales de producción viven en Vercel /
> un gestor de secretos, no en `.env.local`.

```bash
# db:seed = RESET DEMO destructivo (solo local/CI/demo, NUNCA producción).
# SIN BUSINESS_PRESET: los tests usan el catálogo demo del preset minimarket.
DEMO_MODE=true npm run db:seed
npm test           # unitarias + integración (requiere BD sembrada así)
npm run typecheck
npm run lint
```

Los tests heredados de la plantilla validan el **motor compartido** (checkout,
FEFO, peso, entrega, comisión) contra el catálogo demo de `minimarket` — por
eso el seed de pruebas NO usa `BUSINESS_PRESET=salsamentaria` (ese preset no
trae catálogo demo a propósito). Para probar la app *como la va a usar el
negocio*, resiembra con `BUSINESS_PRESET=salsamentaria` (ver arriba).

### Importación de catálogo por CSV

Admin → **Importar POS** acepta CSV con cabecera
`sku,codigo_barras,nombre,categoria,precio,costo,stock`
(ejemplo en [`docs/ejemplos/importacion-pos.csv`](docs/ejemplos/importacion-pos.csv))
— sirve para el catálogo real (embutidos/quesos por peso y minimarket) venga
del POS que venga. El stock se concilia mediante movimientos de ajuste
auditados.

## Estructura

```
src/
  app/            # Next.js App Router: (store), admin/, repartidor/, api/
  components/     # UI compartida (carrito, tarjetas, navegación)
  modules/        # Dominios: config, catalog, inventory, orders, payments,
                  # delivery, restricted, commission, messaging, pos, marketplace
  db/             # Esquema Drizzle, cliente y seed
  lib/            # auth, dinero, auditoría, utilidades
docs/             # Primera entrega documental
tests/            # Vitest: unitarias + vertical slice de integración
```

## Principios no negociables

- **Dinero en enteros COP** — nunca float.
- **Stock por ledger** — nada se edita a mano; todo es un movimiento auditado.
- **Precios calculados en el servidor** — jamás se confía en el navegador.
- **Nada operativo hardcodeado** — horarios, tolerancias, base de comisión y
  reglas de restringidos viven en la tabla `settings`.
- **Sin integraciones falsas** — POS por CSV cuando no hay API pública,
  marketplaces con flujo manual hasta tener acceso oficial.
- **Datos sensibles del negocio** — marcados como *pendientes de completar*, no
  inventados (ver `docs/PENDING_DATA.md`).
