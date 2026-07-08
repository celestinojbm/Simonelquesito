# Hoja de ruta — Market Castilla

Plan por fases. Cada fase lista entregables, criterios de salida y dependencias (datos y credenciales pendientes). Los detalles de cada integración están en [INTEGRATIONS.md](./INTEGRATIONS.md). Este roadmap se heredó de la plantilla (Market Castilla); algunas fases (p. ej. migración de un POS específico) pueden no aplicar a esta instancia — ver [PENDING_DATA.md](./PENDING_DATA.md) para lo específico de este negocio.

## Fase 0 — Descubrimiento (HECHA)

**Entregables:**

- Esta documentación (integraciones, roadmap, estrategia de migración de Treinta).
- Modelo de dominio (esquema en `src/db/schema.ts`: catálogo, inventario con ledger, pedidos, pagos, delivery, integraciones, auditoría, comisión).
- Mapa de integración con Treinta (sin API pública → contrato `POSProvider` + `CsvPosAdapter`; prohibiciones documentadas).
- Lista de datos pendientes del negocio (ver dependencias de las fases siguientes y los `PENDIENTE` de `.env.example`).

**Criterios de salida:** documentación aprobada por el propietario; decisiones de arquitectura (adapters intercambiables, sin scraping) aceptadas. ✔

**Dependencias:** ninguna.

## Fase 1 — MVP comercial (HECHO en el vertical slice)

**Entregables:**

- Catálogo con categorías y variantes; búsqueda tolerante a errores de escritura.
- Carrito y checkout como invitado (sin registro obligatorio).
- Pago sandbox (`SandboxPaymentProvider`: webhooks firmados HMAC, idempotencia) y pagos offline (efectivo/datáfono/transferencia) como `pending` con confirmación manual.
- Pedidos con máquina de estados y panel de pedidos para el personal.
- Inventario con ledger de movimientos y reservas (el stock nunca se pisa directo).
- Delivery por zonas de barrio (tarifas, mínimos, ETA, capacidad por franja).
- Notificaciones WhatsApp simuladas (proveedor `console`, inspeccionables en Admin → Mensajes).
- PWA instalable.
- Importación CSV desde Treinta (`CsvPosAdapter` con conciliación por ajustes y errores en `sync_jobs`) y exportación CSV de ventas digitales.
- Reporte de ventas digitales y comisión de plataforma 10% configurable (`commission_periods` / `commission_adjustments`).

**Criterios de salida:** un pedido digital completo de punta a punta (catálogo → carrito → checkout → pago sandbox → preparación → entrega) sin intervención de desarrollador; importación CSV real de Treinta sin errores bloqueantes; cuadre diario de ventas digitales contra Treinta vía CSV exportado.

**Dependencias:** exportes CSV reales de Treinta; datos del negocio (barrios y tarifas de zonas, horarios, `BUSINESS_WHATSAPP_NUMBER` — PENDIENTE).

## Fase 2 — Operación real del canal digital

**Entregables:**

- **Pago real**: `WompiProvider` / `MercadoPagoProvider` con el mismo contrato `PaymentProvider` (Nequi/Daviplata vía agregador).
- **WhatsApp Business real**: `WhatsAppCloudProvider` sobre la Cloud API de Meta, con plantillas aprobadas, opt-out y transferencia a humano.
- Cuentas de cliente completas (historial, direcciones guardadas, recompra).
- Cupones y fidelización activos en el checkout.
- Sustituciones interactivas (el cliente elige reemplazo desde el mensaje).
- Flujo completo de peso real con aprobación del cliente antes del cobro final.
- App de domiciliarios mejorada.
- Reportes avanzados.
- Lotes, vencimientos y FEFO operativos en inventario.

**Criterios de salida:** primer pago real aprobado vía webhook certificado; mensajes de WhatsApp entregados con plantillas aprobadas y tasa de error aceptable; cero cobros sin aprobación del cliente en pedidos con peso variable.

**Dependencias (PENDIENTE):** cuenta de comercio y llaves Wompi/Mercado Pago (`WOMPI_*`, `MERCADOPAGO_*`) + certificación de webhooks; verificación del negocio en Meta, número dedicado, plantillas aprobadas y token permanente (`WHATSAPP_*`); políticas de datos personales y consentimiento publicadas.

## Fase 3 — Expansión de canales y back-office

**Entregables:**

- Marketplaces Rappi/DiDi con **acceso oficial** (checklist de INTEGRATIONS.md: partners, credenciales, sandbox, certificación) reemplazando el `ManualMarketplaceAdapter`.
- Campañas segmentadas (solo a clientes con consentimiento registrado).
- Sugerencias de reposición de inventario.
- Módulo de compras/proveedores completo.
- Cuentas por pagar y por cobrar.
- Facturación electrónica DIAN.
- Migración gradual del POS (etapas B–C de la estrategia de Treinta).

**Criterios de salida:** pedidos de marketplace entrando automáticamente con dedupe y mapeo de SKUs sin intervención manual; facturas electrónicas aceptadas por la DIAN; compras y cuentas por pagar operadas en la plataforma.

**Dependencias (PENDIENTE):** acceso a programas de partners Rappi/DiDi y credenciales (`RAPPI_*`, `DIDI_*`); habilitación como facturador electrónico ante la DIAN (o proveedor tecnológico); base de clientes con consentimiento suficiente para campañas.

## Fase 4 — Escala

**Entregables (condicionados a que los datos lo justifiquen):**

- Apps móviles nativas (solo si las métricas de la PWA lo justifican).
- Operación extendida/24h por configuración.
- GPS en tiempo real para domicilios (activando `MAPS_PROVIDER`).
- Multi-sucursal (el modelo ya contempla `branches`).
- Plataforma reutilizable para otros comercios de barrio.

**Criterios de salida:** decisión basada en datos (retención, volumen, cobertura); operación de la primera sucursal adicional sin cambios de código, solo configuración.

**Dependencias:** fases 2–3 estables en producción; métricas de uso reales; proveedor de mapas y su API key si se activa GPS; caso de negocio para cada expansión.
