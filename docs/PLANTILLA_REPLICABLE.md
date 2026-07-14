# Plantilla replicable — montar un cliente nuevo en < 1 hora

> El sistema es una plantilla: cada cliente corre su PROPIA instancia
> (base de datos aislada + deploy propio + marca propia). Aislamiento total:
> nada de un negocio toca a otro. El SaaS multi-tenant real queda para
> cuando haya ~10+ clientes (ver AUDITORIA_2026-07.md §4).

## Qué es configurable sin tocar código

| Capa | Dónde | Cómo |
|---|---|---|
| Marca (nombre, eslogan, paleta completa) | setting `branding` | Variables CSS en runtime — re-marcar = editar la llave |
| Tipo de negocio (categorías, reglas restringidos, libras) | preset del seed | `BUSINESS_PRESET=minimarket\|fruver\|farmacia\|ferreteria\|licoreria\|salsamentaria` |
| Operación (horarios, zonas, comisiones, crédito, premium) | settings | Igual que Market Castilla |
| Contacto/ubicación | settings `business.contact` / `business.location` | — |
| Bot de WhatsApp/voz | mismos env vars por instancia | El prompt usa la marca/tipo del negocio automáticamente |
| Storefront público (on/off) | env var de deploy | `STOREFRONT_ENABLED=false` — clientes admin-only (sin venta en línea) sirven solo `/admin`, `/api` y `/repartidor`; el código de `(store)` no se borra, solo se deja de servir (ver `src/middleware.ts`) |

**Assets por instancia** (se reemplazan en el repo/deploy de cada cliente):
`public/icons/logo.svg`, `icon-192.png`, `icon-512.png`, `public/manifest.webmanifest`
(nombre/colores del manifest — es estático).

## Checklist de aprovisionamiento

### 1. Base de datos (Supabase u otro Postgres) — ~10 min
En un proyecto Postgres (puede ser compartido entre instancias usando un
ESQUEMA aislado por cliente, como hace Market Castilla):

```sql
-- Reemplaza <cliente> y <contraseña-generada>
CREATE SCHEMA IF NOT EXISTS <cliente>;
CREATE ROLE <cliente> LOGIN PASSWORD '<contraseña-generada>';
GRANT USAGE, CREATE ON SCHEMA <cliente> TO <cliente>;
ALTER ROLE <cliente> SET search_path = <cliente>, extensions, public;
-- Extensiones (una vez por proyecto): pg_trgm y unaccent en schema extensions
```

### 2. Repositorio — ~5 min
- Crear repo del cliente desde esta plantilla (fork/duplicado).
- Reemplazar los 4 assets de marca (logo/íconos/manifest).

### 3. Esquema y datos — ~10 min
```bash
DATABASE_URL=postgres://<cliente>:...@.../postgres npm run db:push
# db:seed es un RESET DEMO DESTRUCTIVO (borra todas las tablas). Solo dev/CI/demo;
# requiere DEMO_MODE=true y NUNCA corre en producción. Para el owner real: owner:create.
DEMO_MODE=true DATABASE_URL=... BUSINESS_PRESET=<preset> npm run db:seed
```
El seed deja: categorías del preset, reglas de restringidos del rubro,
settings completos (branding con el tipo de negocio), usuarios demo,
zona de ejemplo (EDITAR con la cobertura real) y cuenta POS CSV.
Presets ≠ minimarket no traen productos demo: el catálogo real entra por
**CSV** (importador) o con el **asistente de foto/voz**.

### 4. Deploy (Vercel) — ~10 min
- Nuevo proyecto Vercel apuntando al repo del cliente.
- Env vars mínimas: `DATABASE_URL` (forma pooler :5432 — el código usa 6543
  en serverless), `DB_SEARCH_PATH=<cliente>,extensions,public`,
  `SESSION_SECRET` (nuevo por cliente), `PAYMENT_PROVIDER=sandbox`,
  `PAYMENT_WEBHOOK_SECRET` (nuevo), `MESSAGING_PROVIDER=console`.
- Opcionales al activar: `ANTHROPIC_API_KEY` (bot/asistente), `WHATSAPP_*`
  (número del cliente — cada instancia tiene SU número), `TWILIO_AUTH_TOKEN`.
- Cliente admin-only (sin venta pública, todo por pedido interno):
  `STOREFRONT_ENABLED=false`.

### 5. Configuración del negocio — ~15 min
1. `branding`: nombre, eslogan y paleta del cliente (el tema cambia al
   instante, sin build).
2. `business.contact` y `business.location` (datos reales del cliente).
3. Zonas de cobertura reales (tabla delivery_zones).
4. Horarios (`hours.*`) y, si aplica, reglas de restringidos del rubro.
5. Cambiar contraseñas de los usuarios demo / crear usuarios reales.
6. Importar catálogo (CSV del POS o asistente de foto).

### 6. Verificación (no negociable)
- Con storefront: compra de punta a punta (invitado y con cuenta), flujo de
  peso si aplica, panel de pedidos, `/privacidad` y `/terminos` visibles.
- Admin-only (`STOREFRONT_ENABLED=false`): pedido interno desde
  `/admin/pedidos/nuevo` de punta a punta (reserva → pago/link → si aplica
  domicilio, asignación → entrega con código), y confirmar que `/`,
  `/producto/...`, `/checkout` etc. redirigen a `/login`.
- `npm test` verde en el repo del cliente.

## Reglas de la plantilla (para no romperla)

- **Nunca** incrustar en código nombre/colores/reglas de UN negocio: todo
  nuevo desarrollo debe leer de `settings`/presets (como el bot, que toma
  nombre y tipo de negocio de `branding`).
- Cambios de plantilla se hacen aquí (repo madre) y se propagan a los repos
  de clientes vía merge — mantener los repos de clientes SIN cambios de
  código propios (solo assets y configuración).
- Secretos: NUNCA compartidos entre instancias; generar nuevos por cliente.
- Los presets nuevos (p. ej. panadería, papelería) se agregan en
  `src/db/presets.ts` — datos, no código.

## Nota sobre el preset farmacia

El motor de restringidos exige "verificación en la entrega": en farmacia esa
verificación es la **fórmula médica** (no la edad). La validez legal de la
venta de formulados la respalda el regente/químico farmacéutico del negocio
— la plataforma registra y exige el chequeo, no reemplaza la regulación.
