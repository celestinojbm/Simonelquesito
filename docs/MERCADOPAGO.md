# Mercado Pago — pagos en línea con split 90/10 en la fuente

Estado: **código listo y probado; falta crear las cuentas y pegar 4 variables.**
Mientras tanto la app sigue en `PAYMENT_PROVIDER=sandbox` y nada cambia para los clientes.

## Qué hace

- Cobros en línea reales: **tarjetas y PSE** (los usuarios de Nequi pagan
  eligiendo Nequi dentro de PSE — Mercado Pago Colombia no tiene botón Nequi
  directo; contra entrega no se afecta).
- **Split automático en cada venta** (modelo marketplace 1:1): el dinero entra
  a la cuenta de Mercado Pago **del negocio** (Diana) y la comisión de la
  agencia (`commission.base.ratePctBps`, hoy 10%, editable por el owner en
  Configuración) va **automáticamente** a la cuenta de la agencia.
- La comisión digital del panel marca lo ya cobrado por split como
  **"liquidada en la fuente"**: solo lo contra entrega queda para liquidación
  manual. Todo queda auditado.

## Los 3 pasos del propietario / la agencia

### 1. Cuentas

- **Negocio (Diana):** cuenta de Mercado Pago Colombia a nombre del negocio
  (con RUT) en [mercadopago.com.co](https://www.mercadopago.com.co). A esta
  cuenta entra el dinero de las ventas.
- **Agencia:** cuenta de Mercado Pago de la agencia + entrar a
  [Panel de desarrolladores](https://www.mercadopago.com.co/developers/panel) y
  **crear una aplicación** con:
  - Producto: *Checkout Pro* · Modelo: *Marketplace*.
  - **Redirect URI**: `https://marketcastilla.vercel.app/api/integrations/mercadopago/callback`
  - **Webhook** (notificaciones → pagos): `https://marketcastilla.vercel.app/api/webhooks/payments/mercadopago`
    — al guardarlo, MP muestra la **clave secreta** del webhook: cópiala.

### 2. Variables en Vercel (Settings → Environment Variables)

| Variable | Valor |
| --- | --- |
| `MERCADOPAGO_CLIENT_ID` | De la aplicación creada (agencia) |
| `MERCADOPAGO_CLIENT_SECRET` | De la aplicación creada (agencia) |
| `MERCADOPAGO_WEBHOOK_SECRET` | Clave secreta del webhook (paso 1) |
| `INTEGRATION_CREDENTIALS_KEY` | `openssl rand -hex 32` (cifra los tokens en BD) |

Redesplegar después de guardarlas.

### 3. Conectar y activar

1. Entrar como **owner** (o tech_admin) a **Admin → Integraciones** y pulsar
   **"Conectar cuenta Mercado Pago del negocio"**. Iniciar sesión con la
   cuenta **del negocio** (solo Diana debe hacerlo: a esa cuenta entra el
   dinero). La página muestra el checklist de requisitos en vivo.
2. Probar primero con **credenciales de prueba**: en la aplicación de MP hay
   un par CLIENT_ID/SECRET de *test*; con ellas el flujo completo funciona
   end-to-end **sin dinero real** (tarjetas de prueba de MP).
3. Cuando la prueba esté bien: cambiar a credenciales productivas y poner
   `PAYMENT_PROVIDER=mercado_pago` en Vercel. Desde ese momento el checkout
   muestra "Pago en línea: tarjeta o PSE".

Para desconectar la cuenta (o reconectarla): mismo panel, botón Desconectar.

## Cómo fluye el dinero (referencia técnica)

1. Checkout → `MercadoPagoProvider.createIntent` crea una **preferencia** de
   Checkout Pro con el token OAuth del negocio, `external_reference` = nuestra
   referencia interna y `marketplace_fee` = % de `commission.base.ratePctBps`
   sobre el total. El cliente paga en la página de MP (tarjeta o PSE).
2. MP notifica el webhook (firmado con `x-signature`; se verifica SIEMPRE).
   La notificación solo trae el id: el estado real, la referencia y las
   comisiones (`fee_details`) se **consultan a la API**.
3. Pago aprobado → el pedido pasa a `paid` por la misma máquina de estados de
   siempre (dedupe de eventos incluido) y las comisiones quedan registradas en
   el intento del pago para la conciliación.
4. MP descuenta primero su propia comisión; el `marketplace_fee` de la agencia
   sale del remanente y el resto queda en la cuenta del negocio. La página de
   Comisión digital muestra "liquidada en la fuente" vs "por liquidar manual".

## Seguridad

- Tokens OAuth del negocio **cifrados AES-256-GCM** en `integration_accounts`
  (nunca en texto plano); se refrescan solos antes de vencer.
- Webhook sin firma válida → 401. Sin secreto configurado → 503 (apagado).
- La vinculación OAuth usa un `state` firmado con vencimiento (anti-CSRF) y
  exige sesión con permiso `integrations.manage`.
- Conexión y desconexión quedan en la auditoría.

## Matices conocidos

- **Nequi**: sin botón directo en MP Colombia; los clientes Nequi pagan vía
  PSE. Si el botón Nequi nativo se vuelve crítico, el plan B documentado es
  Wompi (pero sin split en la fuente: liquidación posterior).
- `two_for_one`/`combo` de promociones y el cobro automático de cuotas del
  Fiado (suscripciones de MP) son fases siguientes; la base ya queda lista.
