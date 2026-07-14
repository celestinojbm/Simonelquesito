# Desplegar esta instancia (salsamentaria)

Checklist de aprovisionamiento — sigue el genérico de la plantilla en
[`PLANTILLA_REPLICABLE.md`](./PLANTILLA_REPLICABLE.md); esto es la versión
con las decisiones ya tomadas para este cliente.

## 1. Base de datos

Postgres 16 con esquema aislado (compartido con otras instancias vía schema,
o proyecto propio — ver `PENDING_DATA.md` #15):

```sql
CREATE SCHEMA IF NOT EXISTS salsamentaria;
CREATE ROLE salsamentaria LOGIN PASSWORD '<contraseña-generada>';
GRANT USAGE, CREATE ON SCHEMA salsamentaria TO salsamentaria;
ALTER ROLE salsamentaria SET search_path = salsamentaria, extensions, public;
-- Extensiones (una vez por proyecto Postgres): pg_trgm y unaccent en schema extensions
```

## 2. Esquema y propietario

Aplica el esquema:

```bash
DATABASE_URL=postgres://salsamentaria:...@.../postgres npm run db:push
```

> ⚠️ **NUNCA corras `npm run db:seed` contra producción.** `db:seed` es un
> **RESET DEMO DESTRUCTIVO**: borra TODAS las tablas y recrea cuentas demo
> (`*.demo` / `demo1234`). Está bloqueado en producción por diseño (falla antes
> del primer `DELETE`; requiere `DEMO_MODE=true` y no-producción). Además, **solo
> acepta bases LOOPBACK** (localhost/127.0.0.1/::1): una `DATABASE_URL` remota se
> rechaza y **no puede inicializar una instalación remota** (`src/db/assert-local-db.ts`,
> sin bypass). Es **exclusivamente para desarrollo, CI o entornos demo descartables.**
> Las credenciales de producción viven en Vercel o en un gestor de secretos; los
> scripts administrativos (p. ej. `owner:create`) reciben la `DATABASE_URL` de
> producción de forma temporal desde un entorno controlado, nunca desde `.env.local`.

Ejecuta el **bootstrap del primer propietario real** (no es upsert ni reset de
contraseña: crea el primer owner o confirma que ya existe sin modificarlo, y
aborta ante cualquier otro caso). La contraseña se carga por **entrada oculta**
del shell; no la pongas delante del comando ni en archivos:

```bash
read -rsp "Contraseña del propietario: " OWNER_PASSWORD; echo
export OWNER_PASSWORD
export OWNER_EMAIL="dueno@sudominio.co"
export OWNER_FULL_NAME="Nombre real del propietario"
npm run owner:create
unset OWNER_PASSWORD OWNER_EMAIL OWNER_FULL_NAME
```

Para desactivar las cuentas demo y revocar sus sesiones, sigue
[`RUNBOOK_P0_DEMO.md`](./RUNBOOK_P0_DEMO.md).

> **Pendiente (no improvisar en el P0):** todavía NO existe un procedimiento
> **no destructivo** para inicializar una instalación de producción desde cero
> (negocio, sucursal, settings, categorías del preset). En esta instancia esos
> datos ya están en la BD de producción; una instalación futura necesitará un
> inicializador idempotente separado, distinto de `db:seed`.

Sin catálogo demo (el preset `salsamentaria` no trae productos) — el
catálogo real entra por CSV o alta manual (ver README).

## 3. Deploy (Vercel)

Proyecto nuevo apuntando a este repo, rama por defecto. Env vars:

| Clave | Valor |
|---|---|
| `DATABASE_URL` | forma pooler :5432 (el código usa 6543 en serverless) |
| `DB_SEARCH_PATH` | `salsamentaria,extensions,public` |
| `SESSION_SECRET` | nuevo, propio de esta instancia |
| `STOREFRONT_ENABLED` | `false` (admin-only — ya es el default en `.env.example`) |
| `PAYMENT_PROVIDER` | `sandbox` (hasta conectar una pasarela real) |
| `PAYMENT_WEBHOOK_SECRET` | nuevo |
| `MESSAGING_PROVIDER` | `console` (hasta conectar WhatsApp real) |

## 4. Configuración del negocio

Ver el checklist completo en `PENDING_DATA.md`: branding, contacto/ubicación,
horarios, zonas (si hace domicilios), usuarios reales, catálogo.

## 5. Verificación

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` verdes.
- Pedido interno de punta a punta desde `/admin/pedidos/nuevo` (mostrador y,
  si aplica, domicilio con asignación de repartidor).
- `/`, `/checkout`, `/producto/...` redirigen a `/login` (storefront apagado);
  `/admin`, `/repartidor`, `/login` funcionan normal.
