# Evaluación: asistente que toma pedidos por WhatsApp

> Respuesta a la pregunta del propietario: *"¿es posible un asistente que tome
> los pedidos, responda por WhatsApp y actualice el sistema?"*

## Resumen

**Sí, es totalmente posible y la arquitectura ya está preparada para ello**
(la capa `MessagingProvider` y las tablas `notifications`, `orders`,
`customers` existen desde el MVP). No es un cambio pequeño: depende de dos
habilitaciones externas que **solo el propietario puede tramitar** y tiene un
costo mensual. Abajo el detalle sin adornos.

## Qué se necesita (y quién lo tramita)

| Requisito | Quién | Estado | Nota |
|---|---|---|---|
| Cuenta **WhatsApp Business Platform** (Cloud API de Meta) | Propietario | PENDIENTE | Requiere verificar el negocio en Meta Business Manager |
| El **número del bot** (ver sección "Usar el mismo número") | Propietario | PENDIENTE | Decisión clave: migrar el 311 500 9070 o usar otro número |
| **Plantillas de mensaje** aprobadas por Meta | Agencia + Meta | PENDIENTE | Para mensajes que inicia el negocio (confirmaciones, etc.) |
| Proveedor de mensajería (Meta directo, o Twilio/360dialog/Gupshup) | Propietario | PENDIENTE | Define el costo por conversación |
| Motor de IA (Claude API) para entender los pedidos | Agencia | **CONSTRUIDO** | Bot + simulador ya integrados; falta la API key |

## ⚠️ Usar el MISMO número (311 500 9070) — lo que hay que saber

El número hoy vive en la **app WhatsApp Business** (la del teléfono). La
Cloud API de Meta y la app **no pueden atender el mismo número a la vez** de
forma estándar. Las opciones reales:

1. **Migrar el número a la Cloud API** (camino oficial y estándar):
   - El número deja de funcionar en la app del teléfono: primero se
     **elimina la cuenta de WhatsApp** en la app (Ajustes → Cuenta → Eliminar)
     y luego se registra el número en la Cloud API.
   - **El historial de chats NO se migra.** Haz copia/exporta lo importante antes.
   - Desde ese momento todo se atiende por el sistema: el bot responde y el
     equipo contesta desde el panel/las herramientas conectadas, no desde la app.
2. **"Coexistencia" (beta de Meta vía algunos proveedores/BSP)**: permite que
   la app y la API compartan número con limitaciones. **Disponibilidad no
   garantizada** en Colombia/todos los BSP — hay que verificarla con el
   proveedor elegido antes de contar con ella. No la prometemos.
3. **Número nuevo solo para el bot** (plan B): el 311 500 9070 sigue en la app
   como siempre y el bot atiende un número distinto (se anuncia en la web).

**Recomendación**: decidir entre 1 y 3 según cuánto dependes de la app del
teléfono. Si el panel + bot cubren la operación diaria, migrar (opción 1) es
lo más limpio; si prefieres conservar la app un tiempo, arranca con número
nuevo (opción 3) y migra después.

## Estado actual: TODO el software del bot ya está construido

Lo que ya funciona sin esperar a Meta:

- **Simulador en el panel** (`/admin/whatsapp`): chatea con el bot real; los
  pedidos que confirmes se crean de verdad (inventario, panel, comisión).
- **Cerebro con IA** (Claude, modelo `claude-opus-4-8`) con herramientas:
  `buscar_productos`, `listar_zonas`, `crear_pedido`, `consultar_pedido`,
  `pasar_a_humano`. Reglas: nunca inventa precios, confirma antes de crear,
  restringidos exigen fecha de nacimiento + verificación en la entrega.
- **Webhook** `/api/webhooks/whatsapp` con verificación de Meta (GET) y firma
  HMAC del cuerpo (POST) — listo para pegar en la consola de Meta.
- **Envío real** vía `MESSAGING_PROVIDER=whatsapp_cloud` (Graph API), que
  también activa las notificaciones transaccionales de pedidos (Fase 2a).
- **Conversaciones con modo bot/persona**: cualquier chat se puede pasar a
  atención humana desde el panel o cuando el propio bot lo decide.

### Migración decidida: mismo número (311 500 9070) → Cloud API

Decisión del propietario (2026-07): **se migra el número a la Cloud API**.
La atención humana queda cubierta desde el panel: cada conversación en
`/admin/whatsapp` se puede abrir, leer completa y **responder escribiendo
desde el sistema** (modo «Persona»), así que no se depende de la app del
celular después de migrar.

**Qué se puede dejar listo SIN el número a la mano** (no requiere el SIM ni
el celular):

1. Cuenta en Meta Business Manager y **verificación del negocio** (puede
   tardar horas o días — por eso conviene iniciarla ya).
2. Crear la **app** en developers.facebook.com con el producto WhatsApp.
3. Copiar el **App Secret** y definir el **verify token** del webhook.
4. Crear la **API key de Anthropic** (console.anthropic.com).
5. Cargar todas las variables en Vercel (aunque falte el Phone Number ID).

**Qué SÍ requiere el número físico a la mano** (el día de la migración):

1. Exportar/respaldar los chats importantes de la app (no se migran).
2. En la app WhatsApp Business: Ajustes → Cuenta → **Eliminar cuenta**
   (libera el número para la API; los contactos NO pierden tu número).
3. En Meta → WhatsApp → API Setup: **agregar el número** y verificarlo con
   el **código que llega por SMS o llamada a ese número** — este es el único
   paso que exige tener el teléfono/SIM disponible.
4. Copiar el **Phone Number ID** a Vercel, poner
   `MESSAGING_PROVIDER=whatsapp_cloud` y hacer redeploy.
5. Configurar el webhook (URL + verify token) y suscribirse a **messages**.
6. Probar escribiendo desde otro celular.

> Entre el paso 2 y el 4 el número queda sin WhatsApp (minutos si todo está
> preparado). Hacerlo en horario de poca demanda.

### Checklist del propietario para encender el bot real

1. Verificar el negocio en **Meta Business Manager** (business.facebook.com).
2. Crear una **app** en developers.facebook.com con el producto WhatsApp.
3. Decidir el número (migrar el 311 500 9070 **o** número nuevo) y registrarlo
   en WhatsApp → API Setup. Copiar el **Phone Number ID**.
4. Generar un **token permanente** (usuario del sistema con permiso
   `whatsapp_business_messaging`).
5. En la app de Meta → WhatsApp → Configuration → Webhook:
   - URL: `https://marketcastilla.vercel.app/api/webhooks/whatsapp`
   - Verify token: el mismo valor que pongas en `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
   - Suscribirse al campo **messages**.
6. Copiar el **App Secret** (Settings → Basic) para `WHATSAPP_APP_SECRET`.
7. Crear una API key en **console.anthropic.com** para `ANTHROPIC_API_KEY`.
8. Cargar en Vercel (Settings → Environment Variables) y **redeploy**:
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`,
   `ANTHROPIC_API_KEY`, `MESSAGING_PROVIDER=whatsapp_cloud`.
9. Probar: escribir al número desde otro celular; revisar `/admin/whatsapp`.

## Costo aproximado (referencia, no factura)

- **Conversaciones de WhatsApp**: Meta cobra por "conversación de 24 h". Las
  iniciadas por el cliente (servicio) suelen ser gratuitas hasta cierto
  volumen; las iniciadas por el negocio (marketing/utilidad) tienen tarifa.
  Es un costo variable según pedidos — **PENDIENTE de estimar** con tu volumen real.
- **IA (Claude)**: centavos de dólar por conversación típica.
- **Proveedor** (si usas Twilio/360dialog): una cuota mensual + margen por mensaje.

## Cómo funcionaría (arquitectura)

```
Cliente escribe por WhatsApp
        │
        ▼
Webhook de WhatsApp  ──►  /api/webhooks/whatsapp   (firmado y verificado)
        │
        ▼
Asistente IA (Claude) con "herramientas":
  • buscar productos en el catálogo   → searchProducts()
  • agregar al carrito / armar pedido  → placeOrder()
  • consultar estado de un pedido      → lectura de orders
  • pasar a un humano                  → marca la conversación y avisa al local
        │
        ▼
Se crea el pedido en el MISMO sistema (reserva de inventario, panel, comisión)
        │
        ▼
Responde al cliente por WhatsApp y notifica al panel
```

Puntos clave de diseño (para que sea seguro y no un "bot que atrapa"):

1. **Reutiliza el núcleo existente**: el asistente NO es un sistema aparte;
   llama a las mismas funciones que la tienda web (`placeOrder`, catálogo,
   inventario), así que un pedido por WhatsApp entra al panel, reserva stock
   y cuenta para la comisión igual que uno de la web.
2. **Siempre con salida a humano**: en cualquier momento el cliente puede
   pedir "hablar con una persona" y la conversación se transfiere (no queda
   atrapado en un flujo cerrado).
3. **Productos restringidos**: el asistente aplica las mismas reglas (edad,
   horario de licores) y marca el pedido para verificación en la entrega.
4. **Confirmación humana opcional**: al principio conviene que el asistente
   **arme** el pedido pero un encargado lo **confirme** desde el panel antes
   de cobrar, hasta ganar confianza en la IA.

## Plan por fases sugerido

- **Fase 2a — Transaccional (lo más rentable primero)**: WhatsApp Business
  real enviando las notificaciones que hoy se simulan (pago confirmado, pedido
  en camino, etc.). Sin IA todavía. Es el primer valor tangible y valida la
  cuenta de Meta.
- **Fase 2b — Asistente de pedidos (IA)**: el bot entiende lenguaje natural
  ("mándame 2 libras de tomate y una gaseosa"), arma el carrito, pide dirección
  y forma de pago, y crea el pedido. Con confirmación humana al inicio.
- **Fase 3 — Autónomo con salvaguardas**: el asistente cierra pedidos sencillos
  solo; los complejos o con licor pasan a revisión. Campañas segmentadas con
  consentimiento.

## Recomendación

Hacerlo **por fases** y empezar por la **Fase 2a** (notificaciones reales),
que da valor inmediato y es barata, mientras se tramita la cuenta de Meta.
El asistente con IA (2b) es muy viable y encaja en la arquitectura actual,
pero conviene lanzarlo con **confirmación humana** hasta comprobar que toma
bien los pedidos, sobre todo los de peso variable y los restringidos.

**Siguiente paso concreto que depende de ti**: decidir si quieres que iniciemos
el registro del negocio en WhatsApp Business Platform (Meta) y con qué número
dedicado. Con eso habilitado, la agencia conecta el proveedor y activa primero
las notificaciones y luego el asistente.

> Mientras tanto, el **botón de pedido directo por WhatsApp** ya está activo:
> lleva al cliente a tu chat (311 500 9070) con el pedido escrito, atendido por
> una persona. Es el puente perfecto antes de automatizar.

---

# Evaluación: asistente que CONTESTA LLAMADAS y toma pedidos por voz

> Respuesta a: *"además del bot de WhatsApp, uno que conteste las llamadas y
> tome los pedidos."*

## Resumen

**Sí es posible y la tecnología ya existe** (agentes de voz con IA en tiempo
real). Reutiliza el mismo "cerebro" del asistente de WhatsApp — las mismas
funciones de catálogo, pedido e inventario — cambiando solo el canal: en vez de
texto, entra y sale **voz por teléfono**. Es más complejo y algo más caro que
el de WhatsApp, y conviene hacerlo **después** de tener el de chat funcionando.

## Cómo funcionaría

```
Cliente llama al número del negocio
        │
        ▼
Telefonía en la nube (Twilio / Vonage / número SIP colombiano)
        │  audio en streaming
        ▼
Voz → Texto (reconocimiento) ─► Asistente IA (Claude, mismas herramientas
        │                        que el bot de WhatsApp: buscar, pedir, estado)
        ▼
Texto → Voz (voz natural en español) ─► responde al cliente en la llamada
        │
        ▼
El pedido se crea en el MISMO sistema (panel, inventario, comisión)
```

## Qué se necesita (y quién)

| Requisito | Quién | Nota |
|---|---|---|
| Número telefónico en la nube (Twilio, etc.) con soporte de voz | Propietario | Puede ser un número nuevo o portar uno |
| Reconocimiento de voz + voz sintética en **español de Colombia** | Agencia | Deepgram/Google + ElevenLabs/OpenAI o similar |
| Motor de IA (Claude) — el mismo del bot de chat | Agencia | Se reutiliza |
| Orquestador de llamada en tiempo real | Agencia | Maneja latencia, interrupciones, "cuelga" |

## Costo aproximado (referencia, no factura)

- **Minutos de telefonía**: tarifa por minuto entrante (Twilio Colombia).
- **Voz (STT + TTS)**: por minuto de audio procesado.
- **IA**: centavos por llamada.
- En conjunto, una llamada de pedido típica cuesta **más que un chat**, porque
  el audio en tiempo real es más pesado. **PENDIENTE de estimar** con tu volumen.

## Realidad y límites (para decidir bien)

- ✅ **Lo que funciona muy bien hoy**: contestar siempre (24/7), dar horarios,
  precios, tomar pedidos sencillos, confirmar dirección, y **transferir a una
  persona** cuando la llamada se complica.
- ⚠️ **Lo delicado**: ruido de fondo, acentos, cambios de opinión a mitad de
  frase y pedidos por **peso variable** ("mándame como una libra larga de
  tomate") son más difíciles por voz que por texto. Al inicio conviene que el
  bot **confirme el pedido leyéndolo** y, si hay duda, pase a un humano.
- 🔒 **Licores por teléfono**: igual que en la web, el pedido queda marcado
  para **verificación de edad en la entrega**; la voz no sustituye esa
  comprobación legal.

## Recomendación y orden sugerido

1. **Primero** el WhatsApp transaccional (Fase 2a) — barato, valida Meta.
2. **Después** el asistente de pedidos por WhatsApp (Fase 2b) — construye el
   "cerebro" con herramientas que también usará la voz.
3. **Luego** el **bot de voz** (Fase 3+), reutilizando ese cerebro. Empezar
   como "recepcionista": contesta, informa y toma pedidos simples; lo demás lo
   pasa a una persona. Ampliar cobertura a medida que se compruebe la calidad.

**Por qué en ese orden**: el bot de chat y el de voz comparten el mismo motor;
construirlo una vez (en texto, que es más fácil de afinar y depurar) y luego
"ponerle voz" es más rápido y barato que arrancar por la llamada.

**Lo que depende de ti para el bot de voz**: decidir el número telefónico que
contestará el bot (nuevo o portado) y con qué proveedor de telefonía. El resto
lo integra la agencia sobre la base que ya existe.

## Estado: INFRAESTRUCTURA CONSTRUIDA (2026-07)

El webhook de voz ya existe: `/api/webhooks/voice` (Twilio Programmable
Voice). Reutiliza el MISMO cerebro del bot de WhatsApp en "modo voz" (sin
emojis, frases cortas, precios hablados, no lee enlaces — el enlace del mapa
se anuncia como "te llega por WhatsApp"). Flujo:

1. La llamada entra al número del bot → Twilio la convierte a texto
   (reconocimiento en español colombiano, `<Gather input="speech">`).
2. El cerebro procesa (buscar productos, armar pedido, estado) y la
   respuesta se locuta con voz natural en español (`Polly.Lupe-Neural`).
3. Si el cliente pide una persona, hay un reclamo o el bot falla, la llamada
   se **transfiere** con `<Dial>` al teléfono del negocio (VOICE_FORWARD_PHONE
   o el de configuración). Nunca queda atrapado.
4. La conversación queda registrada en el MISMO hilo que WhatsApp (por
   teléfono), visible en /admin/whatsapp.

### Checklist del propietario para encenderlo

1. Crear cuenta en **twilio.com** (o el proveedor de voz que se elija).
2. Comprar/activar un **número con voz**. Nota honesta: números colombianos
   en Twilio requieren papeleo regulatorio (bundle) y disponibilidad —
   **PENDIENTE verificar**; una alternativa práctica es un número
   estadounidense (+1) usado solo como "línea interna del bot".
3. **Mantener el mismo número público (311 500 9070)**: en tu operador móvil
   activa el **desvío de llamadas** (cuando no contestas / ocupado / apagado)
   hacia el número del bot. Así el cliente sigue marcando tu número de
   siempre: contestas tú si puedes, y si no, contesta el bot. El desvío tiene
   costo del operador — verificar tarifa.
4. En la consola de Twilio → el número → Voice → "A call comes in" →
   Webhook: `https://marketcastilla.vercel.app/api/webhooks/voice` (POST).
5. Copiar el **Auth Token** de Twilio a Vercel como `TWILIO_AUTH_TOKEN`
   (y opcional `VOICE_FORWARD_PHONE`) → redeploy.
6. Probar: llamar al número del bot; pedir "quiero hablar con una persona"
   debe transferir la llamada al celular del negocio.

> Costo por llamada: minutos de Twilio (entrante + transferencia) + IA.
> El reconocimiento de voz de Twilio se cobra por uso. PENDIENTE estimar
> con volumen real; para empezar, el pago por uso es suficiente.
