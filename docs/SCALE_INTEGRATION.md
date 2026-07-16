# Integración física de la balanza (BBG Marker-30)

Estado: **la lectura automática real de la BBG Marker-30 NO está certificada.** La
estación de balanza del panel (`/admin`) está completa en su **modo manual** y en
su **arquitectura de dispositivos**; la lectura física definitiva se validará en
un PR posterior, tras una prueba única con la balanza conectada a la computadora
real (Windows) por USB.

Este documento describe las rutas de integración preparadas y el contrato del
bridge local. No define un instalador ni despliega ningún servicio en este PR.

## Contexto del hardware

- Computadora **Windows** del negocio.
- Balanza **BBG Marker-30**, conexión física **USB** confirmada por el propietario.
- Escáner de códigos de barras **USB** (funciona como teclado — resuelto en la
  estación con un campo enfocado que resuelve al `Enter`).
- Protocolo de la balanza **aún no identificado**: puede exponerse como USB
  Serial/COM, USB HID, teclado, o con un protocolo propio. No se asume baud rate,
  delimitador ni formato de trama.

## Arquitectura de software

La abstracción vive en `src/modules/devices/scale/`, separando capas:

- **UI** (`src/app/admin/weigh-station/weigh-station.tsx`) — captura y confirma.
- **Parser / helpers puros** (`weight.ts`, `src/modules/inventory/quantity.ts`) —
  peso/cantidad → unidad mínima entera (gramos / unidades / ml).
- **Transporte / fuente** (`ScaleAdapter` en `types.ts`; `manual-adapter.ts`,
  `simulated-adapter.ts`) — de dónde viene el peso.
- **Registro de inventario** (`src/modules/inventory/weigh-station.ts`) — escribe
  el ledger de forma idempotente, sin depender de qué fuente produjo el gramaje.

`ScaleSource`: `manual` · `simulated` · `web_serial` · `web_usb` · `local_bridge`.

## Rutas de integración física (en orden de preferencia)

### 1. Web Serial API (Chrome/Edge de escritorio)

- La balanza aparece como puerto serie (directo RS-232→USB o adaptador USB-Serial).
- El navegador pide permiso **con un clic explícito** (`navigator.serial.requestPort()`);
  nunca se abre un puerto al cargar la página.
- Ya existe un lector genérico reutilizable (`src/components/scale/scale-panel.tsx`)
  con **modo diagnóstico** (muestra tramas crudas hex+ASCII) para identificar el
  formato real de la Marker-30 sin el manual. El parser genérico extrae el último
  número de la trama (con decimales → kg; entero → g). **No es un parser específico
  de la Marker-30**; se ajustará tras ver la trama real en la prueba física.

### 2. WebUSB API

- Alternativa si la balanza expone una interfaz USB no-serial.
- Requiere `navigator.usb.requestDevice()` con filtros de `vendorId`/`productId`,
  también **por clic explícito**. Los IDs se descubrirán en la prueba física
  (aparecerán en el diagnóstico, sanitizados).

### 3. USB HID

- Si el dispositivo se presenta como HID (algunas balanzas/escáneres), se leerá vía
  WebHID (`navigator.hid`) con permiso explícito. Contrato equivalente al de WebUSB.

### 4. Bridge local de Windows (fallback)

Si el navegador no puede leer la balanza (driver propietario, COM heredado), un
pequeño **bridge local** en la computadora Windows lee el puerto y expone el peso a
la estación por HTTP local.

#### Contrato del mensaje del bridge (peso)

```json
{
  "type": "weight",
  "grams": 1250,
  "stable": true,
  "unit": "g",
  "capturedAt": "ISO-8601",
  "device": { "manufacturer": "BBG", "model": "Marker-30" }
}
```

- `grams`: entero (unidad mínima del sistema). `stable`: si la lectura está estable.
- La estación lo consumiría como fuente `local_bridge`.

#### Requisitos de seguridad del bridge (futuros — no implementados aquí)

- Escuchar **solo en `localhost`** (127.0.0.1); **nunca** en `0.0.0.0`.
- Validar el **origen permitido** (el dominio productivo del panel).
- **No** aceptar comandos arbitrarios ni ejecutar shell.
- **No** guardar credenciales, tokens ni connection strings.
- Reconexión segura ante desconexión del dispositivo.
- Instalación **explícita** por el operador (no silenciosa, no autoarranque oculto).

No se incluye un instalador ni un bridge incompleto en este PR.

## Diagnóstico

La estación incluye un área "Diagnóstico de balanza USB" que, **solo por acción del
operador**, reporta de forma **sanitizada**: navegador, SO aproximado, soporte Web
Serial/WebUSB, contexto seguro (HTTPS), estado del adaptador y disponibilidad del
modo manual. No sube datos del dispositivo al servidor automáticamente, no almacena
seriales físicos innecesarios y permite copiar el reporte. El reporte deja explícito
que "Datos recibidos: pendiente de prueba física".

## Prueba física pendiente (PR posterior)

1. Conectar la Marker-30 por USB a la computadora Windows.
2. Abrir `/admin` en Chrome/Edge, activar "Balanza USB" y conectar por clic.
3. Con el modo diagnóstico, observar la trama real y ajustar el parser si hace falta.
4. Registrar los `vendorId`/`productId` (sanitizados) para el filtro de WebUSB/HID.
5. Certificar la lectura estable end-to-end y solo entonces afirmar soporte real.
