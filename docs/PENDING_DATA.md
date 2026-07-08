# Salsamentaria — Datos pendientes de completar

Datos reales que el sistema necesita y que **no se inventaron**. Cada fila
indica dónde se configura y quién debe proporcionarlo. Nada de esto bloquea
correr la app en local con datos demo — sí bloquea operar con clientes
reales.

| # | Dato | Dónde se configura | Quién lo proporciona |
|---|------|---------------------|----------------------|
| 1a | ~~Nombre comercial~~ **Resuelto**: "Simón El Quesito" | `src/db/presets.ts` (`brandingDefaults.name`) | — |
| 1b | ~~Paleta de colores~~ **Aproximada** (leída a ojo del letrero: azul #1E6FBF, rojo #D62828, amarillo #F2C230 — confirmar o ajustar) | `src/db/presets.ts` (`brandingDefaults.colors`) | Propietario (confirmar exactitud) |
| 1c | Logo/ícono en archivo limpio (vector o PNG con fondo transparente — la foto del letrero físico no sirve para íconos de la app) | `public/icons/logo.svg`, `icon-192.svg`, `icon-512.svg`, `public/manifest.webmanifest` | Propietario |
| 2 | Razón social y NIT | Tabla `businesses` (`name`, `legal_name`, `tax_id`) | Propietario |
| 3 | Dirección exacta del local | Tabla `branches.address_line` + setting `business.contact.address` | Propietario |
| 4 | Teléfono y WhatsApp del negocio | Setting `business.contact` (`phone`, `whatsapp`) | Propietario |
| 5 | Horario real de atención y de domicilios | Settings `hours.store`, `hours.delivery`, `hours.pickup` (Panel → Configuración) | Propietario |
| 6 | ¿Vende cerveza/licor? Si sí: agregar categoría restringida | `src/db/presets.ts` (dato, no código) + setting `restricted.rules` | Propietario |
| 7 | Zonas reales de cobertura, tarifas de domicilio, pedido mínimo y envío gratis | Tabla `delivery_zones` (Panel → Delivery → Zonas) + setting `delivery.freeFromCop` | Propietario |
| 8 | Domiciliarios reales (si hace domicilios) | Tabla `drivers` + usuarios rol `driver` (Panel → Usuarios) | Propietario |
| 9 | Catálogo real (productos, precios, costos, stock inicial, variantes por peso) | Importación CSV (Admin → Importar POS) o alta manual (Admin → Productos) | Propietario |
| 10 | Fotos reales de productos y logo definitivo | Tabla `product_images` / assets de marca | Propietario |
| 11 | Proveedores reales (para compras y lotes) | Tabla `suppliers` (Panel → Compras → Proveedores, cuando se use) | Propietario |
| 12 | Clasificación tributaria por producto (IVA/impoconsumo) | Tabla `product_variants.tax_rate_bps` | Propietario / contador |
| 13 | Cuenta(s) bancaria(s) para conciliación | Panel → Finanzas (`bank_accounts.manage`, solo owner) | Propietario |
| 14 | Usuarios reales y contraseñas (reemplazar las demo `*.demo` / `demo1234`) | Panel → Usuarios | Propietario |
| 15 | Proyecto Postgres/Supabase: ¿nuevo o esquema aislado en uno existente? | `DATABASE_URL` + `DB_SEARCH_PATH` (Vercel → Environment Variables) | Propietario / quien administre la infraestructura |
| 16 | Proyecto Vercel y dominio | Deploy (ver `docs/PLANTILLA_REPLICABLE.md` checklist) | Propietario / agencia |
| 17 | Credenciales de pago reales (si se conecta Wompi/Mercado Pago más adelante) | `.env` (secretos) + tabla `integration_accounts` (cifradas AES-GCM) | Propietario |
| 18 | Cuenta WhatsApp Business API verificada (si se activa mensajería real; hoy `MESSAGING_PROVIDER=console`) | `.env` + tabla `integration_accounts` kind `whatsapp` | Propietario |
