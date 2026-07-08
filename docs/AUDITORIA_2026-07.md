# Auditoría del sistema y comparación con el mercado — julio 2026

> Auditoría solicitada por el propietario/agencia con miras a: (1) elevar el
> sistema al nivel de los mejores del mercado, (2) convertirlo en **plantilla
> replicable** para múltiples tipos de negocio.

## 1. Estado general (veredicto)

La arquitectura es **sólida y fue diseñada con las abstracciones correctas**
para replicarse: configuración operativa 100% en datos (`settings`),
proveedores intercambiables (pagos, mensajería, POS), motor de restringidos
genérico, dinero entero en COP, ledgers inmutables (inventario y crédito),
auditoría transversal. Los diferenciales construidos (bot IA de WhatsApp,
Fiado Digital, seguimiento en mapa sin costos de API, venta por libras,
split de comisión) **no los trae junta ninguna plataforma genérica**.

Las deudas reales están en: operación de seguridad (rotación de secretos,
monitoreo), pruebas E2E, edición visual de configuración, y capa de marca
para la replicabilidad.

## 2. Hallazgos por severidad

### Críticos (bloquean o arriesgan la operación real)
| # | Hallazgo | Estado |
|---|---|---|
| C1 | Páginas legales inexistentes (privacidad/términos). Meta exige URL de política de privacidad para aprobar la app de WhatsApp; Ley 1581 exige la política para tratar datos. | ✅ CORREGIDO en esta auditoría (`/privacidad`, `/terminos`, enlazadas en el footer). PENDIENTE: revisión de abogado. |
| C2 | Secretos de BD/sesión pasaron por el chat durante la configuración. | ⚠️ **APLAZADO por decisión del propietario (2026-07-03)** — riesgo aceptado temporalmente. Debe rotarse ANTES de: volumen real de clientes, o cualquier tercero con acceso al chat/repositorio. |
| C3 | Límite anti-abuso de códigos de ingreso vivía solo en memoria (se reinicia por instancia serverless → burlable). | ✅ CORREGIDO: límite durable contra BD (3 códigos/número/10 min) además del de memoria. |

### Altos (antes de escalar)
| # | Hallazgo | Recomendación |
|---|---|---|
| A1 | Sin monitoreo de errores ni alertas (los fallos se ven solo si alguien mira logs de Vercel). | Integrar Sentry (gratis en este volumen) + alerta simple a WhatsApp del admin. |
| A2 | Sin pruebas E2E automatizadas (hay 29 unitarias; los flujos completos se prueban a mano). | Suite Playwright: compra completa, flujo de peso, fiado, bot simulador. |
| A3 | Configuración del panel es de solo lectura (cambios via SQL/agencia). | Editor visual con validación Zod por llave + auditoría (ya existe el backend `setSetting`). |
| A4 | Backups: Supabase free tier tiene retención limitada. | Redundancia: respaldo lógico programado (pg_dump semanal a almacenamiento propio). |
| A5 | Tokens de sesión sin expiración corta ni 2FA para roles de dinero (owner). | Expiración + segundo factor para owner/admin cuando el crédito tenga volumen. |

### Medios (mejoras de producto)
- Sin recuperación de **carritos abandonados** (con el bot de WhatsApp sería el canal perfecto y barato). ALTA prioridad de producto.
- Motor de cupones/promociones: tablas existen, sin UI ni aplicación en checkout.
- Dashboard de analítica básico (ventas por canal/día existe; faltan: top productos, horas pico, recompra, margen).
- Búsqueda no cubre errores fonéticos extremos; los sinónimos son pocos (ampliar con el uso real del bot).
- PWA: sin modo offline del catálogo (deseable en barrios con datos intermitentes).
- Accesibilidad: base decente (labels/roles); falta auditoría con lector de pantalla.

## 3. Comparación con los mejores del mercado

| Capacidad | Rappi/instaleap (grocery) | Shopify | Treinta/Loyverse (POS) | Addi/Sistecrédito | **Market Castilla** |
|---|---|---|---|---|---|
| Pedidos en línea con peso variable | ✅ | ⚠️ apps | ❌ | — | ✅ estimado→real→tolerancia |
| Seguimiento en vivo del domicilio | ✅ (costoso) | ❌ | ❌ | — | ✅ sin fees de mapas |
| Bot de pedidos con IA en WhatsApp | ⚠️ atención, no pedidos | ❌ | ❌ | — | ✅ pedidos reales + humano |
| Crédito/fiado integrado | ❌ | ⚠️ apps de terceros | ⚠️ anotación simple | ✅ (con intereses/costos) | ✅ sin intereses, ledger, cuotas |
| Split de comisión por venta | — | ✅ (marketplaces) | ❌ | — | 🔜 fase 2 (MP verificado) |
| Suscripciones de clientes | ⚠️ | ✅ apps | ❌ | — | ✅ estructura lista |
| Carrito abandonado | ✅ | ✅ | ❌ | — | ❌ **brecha #1 de producto** |
| Promos/cupones con UI | ✅ | ✅ | ⚠️ | — | ❌ brecha #2 |
| Analítica rica | ✅ | ✅ | ⚠️ | — | ⚠️ básica — brecha #3 |
| Balanza conectada | ⚠️ hardware propio | ❌ | ✅ (modelos con puerto) | — | ✅ Web Serial (RS-232) |
| Multi-negocio/white-label | — | ✅ | — | — | 🔜 plantilla (aprobada) |

**Lectura honesta**: en el nicho "tienda de barrio con domicilios + fiado +
WhatsApp", este sistema ya supera lo que una tienda podría armar con
plataformas genéricas. Las tres brechas de producto a cerrar: carrito
abandonado (vía bot), promociones con UI, analítica.

## 4. Replicabilidad (plantilla) — aprobada, plan

1. **Capa de marca**: colores/logo/nombre/eslogan desde `settings`
   ("branding") aplicados como variables CSS en runtime + assets por
   instancia. Hoy están en tokens de Tailwind (build).
2. **Presets por tipo de negocio**: semillas de categorías/reglas/unidades
   para minimarket, fruver, farmacia (restringidos = medicamentos con
   fórmula), ferretería, licorería. El motor ya es genérico.
3. **Aprovisionamiento**: script que crea esquema de BD aislado + rol +
   seed con preset + proyecto Vercel con sus env vars. Objetivo: cliente
   nuevo operando en < 1 hora.
4. **SaaS multi-tenant real**: solo a partir de ~10 clientes (refactor de
   aislamiento por tenant; alto riesgo si se hace antes de tiempo).

## 5. Integración de balanzas (BBG Market-30 y similares)

- Market-30 verificada con el fabricante: RS-232 de fábrica (cable incluido).
- Implementado en esta auditoría: **lector Web Serial** en el panel
  (Chrome/Edge escritorio + adaptador USB-Serial) con parser genérico de
  liquidadoras y **modo diagnóstico** que muestra las tramas crudas — permite
  ajustar el protocolo con el equipo en mano, sin manual.
- El peso leído alimenta el flujo existente de peso real por línea de pedido
  (y el futuro modo POS de mostrador).
- Regla honesta: la balanza certificada (OIML/SIMEL) manda legalmente en el
  precio; el sistema registra, no reemplaza la metrología.

## 6. Agente de alta de productos (foto/voz/chat) — implementado

- El personal fotografía el producto físico, lo dicta (reconocimiento de voz
  del navegador, es-CO) o lo escribe; visión de IA propone la ficha completa.
- **Foto presentable para publicar**: búsqueda en **Open Food Facts** (base
  abierta, por código de barras o nombre) — sin scraping de sitios de
  terceros ni riesgo de licencias. Si no hay foto: la del tendero o el ícono
  de categoría.
- El personal SIEMPRE revisa y confirma antes de crear (la IA no publica sola).

## 7. Roadmap priorizado post-auditoría

1. Carrito abandonado por WhatsApp (cuando Meta apruebe) — mayor retorno.
2. Editor visual de configuración (A3) + monitoreo (A1).
3. Plantilla replicable fases 1-3 (branding → presets → aprovisionamiento).
4. Suite E2E (A2) y respaldo lógico (A4).
5. Promociones con UI y analítica ampliada.
6. Rotación de secretos (C2) — en cuanto el propietario lo autorice.
