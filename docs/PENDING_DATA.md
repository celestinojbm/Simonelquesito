# Salsamentaria — Datos pendientes de completar

Datos reales que el sistema necesita y que **no se inventaron**. Cada fila
indica dónde se configura y quién debe proporcionarlo. Nada de esto bloquea
correr la app en local con datos demo — sí bloquea operar con clientes
reales.

| # | Dato | Dónde se configura | Quién lo proporciona |
|---|------|---------------------|----------------------|
| 1a | ~~Nombre comercial~~ **Resuelto**: "Simón El Quesito" | `src/db/presets.ts` (`brandingDefaults.name`) | — |
| 1b | ~~Paleta de colores~~ **Resuelto** (leída del logo real: verde azulado #2F5350, rojo #DE3730, naranja #F3A93A, amarillo pálido #FFF8E7) | `src/db/presets.ts` (`brandingDefaults.colors`) | — |
| 1c | Logo/ícono: hoy es una **recreación en SVG** (aprobada por el propietario), no el archivo original — si más adelante aparece el archivo real (vector o PNG con fondo transparente), reemplazarlo aquí | `public/icons/logo.svg`, `icon-192.svg`, `icon-512.svg`, `public/manifest.webmanifest` | Propietario (opcional, mejora la fidelidad) |
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
