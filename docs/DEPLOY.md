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

## 2. Esquema y seed

```bash
DATABASE_URL=postgres://salsamentaria:...@.../postgres npm run db:push
DATABASE_URL=... BUSINESS_PRESET=salsamentaria npm run db:seed
```

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
