# Market Castilla — Wireframes (ASCII)

Wireframes de referencia para la UI (mobile-first). Decisiones transversales de UX:

- **Nav inferior fija en móvil** (Inicio / Categorías / Buscar / Pedidos / Perfil) — el pulgar manda.
- **Botón de carrito persistente** ("Ver carrito · $XX.XXX") visible mientras haya items.
- **Touch targets ≥ 44×44 px** en botones, steppers y filas tocables.
- **WCAG AA**: texto `#17231D` sobre blanco cálido `#FFFDF7`; verde `#16A765` solo en elementos grandes/CTA con texto blanco verificado; verde oscuro `#12613F` para texto sobre verde suave `#E8F6EE`. Naranja `#F05A3C` reservado a promos/CTA. Estados nunca solo por color (icono + etiqueta).
- Precios estimados por peso siempre marcados con `~` y leyenda explícita.
- Productos restringidos con sello "+18" visible desde la tarjeta.

---

## 1. Inicio (móvil)

```
┌─────────────────────────────────┐
│ ☰  🍏C Market Castilla    [👤]  │
│ ● Abierto · Domicilios hasta 8pm│
├─────────────────────────────────┤
│ 🔍 [ Busca "arroz", "pola"… ]   │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ 🟠 OFERTAS DE HOY           │ │
│ │ Zanahoria kg $3.400  ~~$4.000~~│
│ │            [ Ver todas → ]  │ │
│ └─────────────────────────────┘ │
│ Categorías                      │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐    │
│ │ 🥑 │ │ 🌾 │ │ 🥖 │ │ 🧀 │    │
│ │Fru.│ │Aba.│ │Pan │ │Refr│    │
│ └────┘ └────┘ └────┘ └────┘    │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐    │
│ │ 🥤 │ │ 🍿 │ │🍺+18│ │ 🧼 │   │
│ │Beb.│ │Snak│ │Cerv│ │Aseo│    │
│ └────┘ └────┘ └────┘ └────┘    │
│ Vuelve a pedir                  │
│ [Leche Alquería] [Pan aliñado]  │
├─────────────────────────────────┤
│ 🛒 Ver carrito · $23.500      ▲ │  ← persistente
├─────────────────────────────────┤
│  🏠     ▦      🔍     ⏱     👤 │  ← nav inferior 44px
│ Inicio Categ. Buscar Pedidos Yo │
└─────────────────────────────────┘
```

UX: estado abierto/cerrado calculado de `hours.*`; el buscador es protagonista (misión principal: encontrar rápido); "Vuelve a pedir" reduce fricción del cliente habitual.

## 2. Categoría

```
┌─────────────────────────────────┐
│ ←  Frutas y verduras       [🔍] │
├─────────────────────────────────┤
│ Filtros: [En oferta] [A-Z ▾]    │
├─────────────────────────────────┤
│ ┌──────────────┐ ┌──────────────┐
│ │   [imagen]   │ │   [imagen]   │
│ │ Banano       │ │ Aguacate Hass│
│ │ criollo      │ │ Unidad ~250g │
│ │ $3.800 /kg   │ │ ~$3.500 c/u  │
│ │ ⚖ por peso   │ │ ⚖ por peso   │
│ │ [  Agregar  ]│ │ [  Agregar  ]│
│ └──────────────┘ └──────────────┘
│ ┌──────────────┐ ┌──────────────┐
│ │ Zanahoria    │ │ Papa pastusa │
│ │ 🟠-15% $3.400│ │ $3.200 /kg   │
│ │ ~~$4.000~~/kg│ │ ⚖ por peso   │
│ │ [  Agregar  ]│ │ [  Agregar  ]│
│ └──────────────┘ └──────────────┘
├─────────────────────────────────┤
│ 🛒 Ver carrito · $23.500        │
└─────────────────────────────────┘
```

UX: precio por kg y sello `⚖ por peso` desde la tarjeta — sin sorpresas; tarjeta completa tocable, botón Agregar ≥44px.

## 3. Detalle de producto (variante por peso)

```
┌─────────────────────────────────┐
│ ←                        [🛒 2] │
│        [ imagen grande ]        │
├─────────────────────────────────┤
│ Banano criollo                  │
│ Frutas y verduras · ⚖ Por peso  │
│                                 │
│ Presentación:                   │
│ (•) Por kilo — $3.800/kg        │
│                                 │
│ Cantidad:                       │
│ [−]   750 g   [+]  (pasos 250g) │
│                                 │
│ Total estimado:  ~$2.850        │
│ ⓘ El precio final se ajusta con │
│   el peso real en tienda. Si    │
│   varía más de 15%, te pedimos  │
│   aprobación antes de enviar.   │
│                                 │
│ Nota para el tendero:           │
│ [ "verdes para el sancocho"  ]  │
│                                 │
│ [——— Agregar · ~$2.850 ———]     │
└─────────────────────────────────┘
```

UX: stepper por gramos con pasos amigables; tolerancia (configurable) explicada en lenguaje simple; campo de nota = trato de tienda de barrio. En restringidos, franja `🔞 Venta solo a mayores de 18 años` bajo el título.

## 4. Carrito

```
┌─────────────────────────────────┐
│ ←  Tu carrito (4)               │
├─────────────────────────────────┤
│ Banano criollo        ~$2.850   │
│ 750 g · "verdes"    [−] 750g [+]│
│ ─────────────────────────────── │
│ Arroz Diana 1 kg       $4.900   │
│                     [−]  1  [+] │
│ ─────────────────────────────── │
│ Queso campesino ⚖     ~$14.000  │
│ 250 g               [−] 250g [+]│
│ ─────────────────────────────── │
│ Cerveza Águila six 🔞  $18.000  │
│                     [−]  1  [+] │
├─────────────────────────────────┤
│ Cupón: [BIENVENIDO10 ] [Aplicar]│
├─────────────────────────────────┤
│ Subtotal (estimado)   ~$39.750  │
│ Envío (Castilla)        $3.000  │
│ ⓘ Envío gratis desde $80.000    │
│ Total estimado        ~$42.750  │
│ ⚖ Incluye 2 productos por peso: │
│   el total se confirma al pesar │
│                                 │
│ [———— Ir a pagar ————]          │
└─────────────────────────────────┘
```

UX: swipe para eliminar con deshacer; incentivo de envío gratis visible; el `~` acompaña todo total estimado.

## 5. Checkout (con verificación de edad)

```
┌─────────────────────────────────┐
│ ←  Finalizar pedido             │
├─────────────────────────────────┤
│ 1. Entrega                      │
│ (•) Domicilio  ( ) Recoger      │
│ Barrio: [Castilla ▾]  → Zona ok │
│ Dirección: [Cra __ # __-__   ]  │
│ Referencias: [portón verde…  ]  │
│ Franja: (•) Lo antes posible    │
│         ( ) 18:00–19:00         │
│ ⏱ Llega en 25–45 min · $3.000   │
├─────────────────────────────────┤
│ 2. Tus datos (sin registro)     │
│ Nombre:   [____________]        │
│ Celular:  [3__ ___ ____]        │
├─────────────────────────────────┤
│ 3. Sustituciones                │
│ Si algo falta: [Similar ▾]      │
├─────────────────────────────────┤
│ ┌─ 🔞 Verificación de edad ────┐│
│ │ Tu pedido incluye cerveza.   ││
│ │ Venta permitida 10:00–20:00. ││
│ │ Fecha nacimiento [DD/MM/AAAA]││
│ │ [✓] Declaro ser mayor de 18  ││
│ │     y acepto las condiciones ││
│ │ ⓘ El domiciliario verificará ││
│ │   tu cédula en la entrega.   ││
│ └──────────────────────────────┘│
├─────────────────────────────────┤
│ 4. Pago                         │
│ (•) Efectivo contra entrega     │
│ ( ) Datáfono en la puerta       │
│ ( ) Nequi / Daviplata           │
│ ( ) Pago en línea (sandbox)     │
├─────────────────────────────────┤
│ [✓] Acepto tratamiento de datos*│
│ [ ] Quiero ofertas por WhatsApp │
│                                 │
│ [—— Confirmar pedido ~$42.750 ——]│
└─────────────────────────────────┘
```

UX: un solo scroll (sin wizard multipágina); el bloque +18 aparece solo si hay restringidos y explica horario y verificación en puerta; errores del motor de restringidos se muestran junto al bloque; consentimiento de datos obligatorio, marketing opt-in separado.

## 6. Confirmación / Seguimiento de pedido

```
┌─────────────────────────────────┐
│ ✅ ¡Pedido recibido!            │
│ Pedido MC-1024 · ~$42.750       │
├─────────────────────────────────┤
│ Código de entrega:  ┌──────┐    │
│ díselo al domiciliario │ 7K2F │ │
│                     └──────┘    │
├─────────────────────────────────┤
│ ● Confirmado          17:02     │
│ ● En preparación      17:05     │
│ ◐ Ajuste de peso      17:12     │
│   ⚖ Queso pesó 310 g (+24%)     │
│   Nuevo total: $44.910          │
│   [ Aprobar ]  [ Contactar 💬 ] │
│ ○ Listo                         │
│ ○ En camino                     │
│ ○ Entregado                     │
├─────────────────────────────────┤
│ 🛵 Llega entre 25 y 45 min      │
│ [ 💬 Soporte por WhatsApp ]     │
└─────────────────────────────────┘
```

UX: línea de tiempo = estados reales de la máquina; la aprobación de ajuste de peso se resuelve aquí o por WhatsApp; código de confirmación grande y copiable.

## 7. Panel admin — Dashboard

```
┌──────────────────────────────────────────────────────────┐
│ 🍏C Market Castilla — Admin        [Config] [Admin Demo ▾]│
├──────────┬───────────────────────────────────────────────┤
│ Pedidos  │ HOY · martes 2 jul                            │
│ Preparac.│ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐ │
│ Catálogo │ │ Nuevos │ │Prepar. │ │En camino│ │Entregados│ │
│ Inventar.│ │   4    │ │   3    │ │   2    │ │    12    │ │
│ Clientes │ └────────┘ └────────┘ └────────┘ └──────────┘ │
│ Promos   │ ⚠ Atención                                    │
│ Mensajes │ · 1 pedido con ajuste de peso pendiente       │
│ Comisión │ · 2 productos con stock bajo                  │
│ Auditoría│ · 1 lote vence en 3 días (FEFO)               │
│ Config   │ Últimos pedidos                               │
│          │ ┌──────────────────────────────────────────┐  │
│          │ │MC-1024 Camila  ~$44.910 ⚖🔞 Ajuste peso │  │
│          │ │MC-1023 Pedro    $23.500    En camino 🛵  │  │
│          │ │MC-1022 Rosa     $67.800    Preparando    │  │
│          │ └──────────────────────────────────────────┘  │
└──────────┴───────────────────────────────────────────────┘
```

UX: contadores por estado tocables (filtran la lista); alertas accionables arriba; iconos ⚖ (peso) y 🔞 (restringido) en cada fila.

## 8. Panel admin — Detalle de pedido

```
┌──────────────────────────────────────────────────────────┐
│ ← Pedido MC-1024 · [En preparación]                      │
│ Camila · 3__ ___ ____ · Castilla, Cra __ #__ · "portón…" │
│ 🔞 Verificar cédula en entrega · Sustitución: similar     │
├──────────────────────────────────────────────────────────┤
│ ITEMS                                    Est.  →  Real   │
│ Banano criollo 750 g            ~$2.850  [ 780 ]g $2.964 │
│ Queso campesino 250 g          ~$14.000  [ 310 ]g $17.360│
│   ⚠ +24% > tolerancia 15% → requiere aprobación          │
│ Arroz Diana 1 kg                 $4.900   —              │
│ Cerveza Águila six 🔞           $18.000   —              │
│                       [ Guardar pesos ]                  │
├──────────────────────────────────────────────────────────┤
│ Total estimado ~$42.750 → Total real $46.224             │
├──────────────────────────────────────────────────────────┤
│ TRANSICIONES VÁLIDAS (desde "En preparación")            │
│ [→ Esperando sustitución] [→ Ajuste de peso] [→ Listo]   │
│ [✕ Cancelar…] (pide motivo)                              │
├──────────────────────────────────────────────────────────┤
│ DOMICILIARIO (al pasar a Listo)                          │
│ Asignar: [ Domiciliario Demo (moto) ▾ ]  [ Asignar ]     │
│ Código de entrega: 7K2F · Pago en puerta: efectivo       │
├──────────────────────────────────────────────────────────┤
│ HISTORIAL                                                │
│ 17:12 preparing → weight_adjustment_pending (picker)     │
│ 17:05 confirmed → preparing (admin)                      │
│ 17:02 paid → confirmed (system: pago offline)            │
└──────────────────────────────────────────────────────────┘
```

UX: solo se muestran las transiciones válidas de `ORDER_TRANSITIONS` (imposible romper la máquina); captura de peso inline con recálculo inmediato; cancelar siempre exige motivo (queda en auditoría).

## 9. Vista de preparación (agrupada por áreas)

```
┌─────────────────────────────────┐
│ Preparar MC-1024 (4 items)      │
│ Recorrido sugerido por zona:    │
├─────────────────────────────────┤
│ 🥑 FRUVER                       │
│ [ ] Banano criollo — 750 g      │
│     nota: "verdes" · ⚖ pesar    │
├─────────────────────────────────┤
│ 🧀 REFRIGERADOS                 │
│ [ ] Queso campesino — 250 g ⚖   │
├─────────────────────────────────┤
│ 🌾 ABARROTES (Pasillo 2, est. B)│
│ [✓] Arroz Diana — Bolsa 1 kg    │
├─────────────────────────────────┤
│ 🍺 LICORES 🔞                   │
│ [ ] Cerveza Águila — Six pack   │
├─────────────────────────────────┤
│ ⚖ Pesar: [780]g ✓  [310]g ⚠+24% │
│ Faltante → [Proponer sustituto] │
│ [——— Marcar LISTO (4/4) ———]    │
└─────────────────────────────────┘
```

UX: agrupado por `prepArea` para recorrer la tienda una sola vez; checkboxes grandes (uso con una mano); pesar y sustituir sin salir de la vista; "Listo" se habilita al completar todo.

## 10. App domiciliario

```
┌─────────────────────────────────┐
│ 🛵 Mis entregas    ● Disponible │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ MC-1024 · Castilla          │ │
│ │ Cra __ # __-__ "portón…"    │ │
│ │ Camila · [📞] [💬]          │ │
│ │ 💵 Cobrar: $46.224 efectivo │ │
│ │ 🔞 VERIFICAR CÉDULA (+18)   │ │
│ │ [——— Recogí el pedido ———]  │ │
│ └─────────────────────────────┘ │
│ ── En camino ──────────────────│
│ Al llegar:                      │
│ 1. [✓] Cédula verificada 🔞     │
│ 2. Código del cliente: [____]   │
│ 3. Pago recibido: [Efectivo ▾]  │
│ [—— Confirmar ENTREGA ——]       │
│ [ ⚠ Reportar problema ]         │
│   (ausente / dirección errada)  │
└─────────────────────────────────┘
```

UX: una tarjeta = una entrega (sin distracciones); el botón de entrega queda **bloqueado** hasta marcar la cédula en pedidos +18 y digitar el código correcto; monto a cobrar en puerta destacado; incidencias a un toque.
