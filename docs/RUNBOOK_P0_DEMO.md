# Runbook P0 — Bootstrap del propietario real y desactivación demo en producción

> Procedimiento **preparado, no ejecutado**. Cierra el hallazgo P0 sin bloquear
> al propietario. Ejecutar en el orden indicado. Ningún paso destructivo se ha
> corrido contra producción desde esta rama.

**Contexto verificado (BD de prod, schema `salsamentaria`):** existen 8 cuentas
`@marketcastilla.demo` activas; el único `owner` es `owner@marketcastilla.demo`
(demo); hay ≥1 sesión demo activa. El bloqueo del código es por dominio EXACTO
`@marketcastilla.demo`, así que un propietario con correo real **nunca** queda
bloqueado.

> ⚠️ **`npm run db:seed` es un RESET DEMO DESTRUCTIVO** (borra todas las tablas)
> y está bloqueado en producción por diseño. **No es** el mecanismo para
> inicializar producción. El propietario real se crea con el **bootstrap del
> primer propietario real** (`npm run owner:create`).

## Qué es (y qué NO es) `owner:create`
Es un **bootstrap conservador**, no un upsert ni un reset de contraseña:
- **Correo no existe** y no hay otro owner real activo → crea el owner.
- **Correo ya existe como owner activo** → no-op seguro (no cambia nada).
- **Correo con otro rol** → aborta, sin tocar la cuenta.
- **Owner inactivo** → aborta (la reactivación es un procedimiento aparte).
- **Ya hay otro owner real activo** (correo distinto) → aborta.
Las cuentas `@marketcastilla.demo` **no** cuentan como propietarios reales.

## Defensa en profundidad (ya en el código de esta rama)
- **Login backend** (`loginAction`) y **validación central de sesión**
  (`resolveSession`/`getSessionUser`) rechazan cuentas demo en producción — una
  cookie de sesión ya emitida **tampoco** autentica.
- La pantalla de login **no** muestra credenciales demo en producción.

## Secuencia operacional (evita lockout)

### 1) Ejecutar el bootstrap contra producción (entorno administrativo controlado)

> **Conexión administrativa (obligatorio).** Ejecuta el bootstrap desde un
> entorno administrativo controlado, usando **conexión directa a PostgreSQL** o
> el **pooler en modo sesión** (usa transacciones y advisory lock). **NO** lo
> ejecutes:
> - desde un **Preview Deployment**;
> - desde una **función serverless**;
> - a través del **pooler transaccional** si hay disponible una conexión directa
>   o de sesión;
> - con las variables (`OWNER_*`) volcadas a un **archivo persistente sin
>   protección**.
> Usa `DATABASE_URL` de administración solo en esta sesión de shell y límpiala al
> terminar (ver `unset` abajo).

La contraseña se carga por **entrada oculta** del shell y se limpia al terminar;
**no** la pongas delante del comando ni la guardes en archivos:

```bash
read -rsp "Contraseña del propietario: " OWNER_PASSWORD
echo
export OWNER_PASSWORD
export OWNER_EMAIL="dueno@sudominio.co"
export OWNER_FULL_NAME="Nombre real del propietario"
npm run owner:create
unset OWNER_PASSWORD OWNER_EMAIL OWNER_FULL_NAME
```

Regla de contraseña: ≥12 caracteres con minúscula, mayúscula, dígito y símbolo;
distinta de una credencial demo; que no contenga el correo ni sea igual al nombre.

> **PowerShell (Windows):** **pendiente** — no se documenta una conversión de
> `SecureString` a variable de entorno porque puede filtrar la contraseña en
> texto plano. Ejecutar el bootstrap desde un shell Linux/macOS, o dejar este
> paso pendiente de un procedimiento seguro específico para PowerShell.

### 2) Confirmar que el comando reportó creación exitosa
Debe imprimir `✔ Propietario real creado: <correo> (rol: owner, activo).`
(Si imprime `= El propietario real ya existe … No se modificó nada.`, la cuenta
ya existía como owner activo; correcto e idempotente. Si **aborta**, revisar el
mensaje — rol incompatible / owner inactivo / ya hay otro owner real.)

### 3) Iniciar sesión en la aplicación con la nueva cuenta
En el sitio actual (el login demo aún funciona aquí: sin riesgo de lockout).

### 4) Confirmar acceso y permisos de owner
Verificar que entra a `/admin` con permisos de propietario.

### 5) Revocar las sesiones demo activas
Opción A — script idempotente (con `DATABASE_URL` de prod):
```bash
npm run demo:revoke-sessions
```
Opción B — SQL equivalente:
```sql
update salsamentaria.sessions s
   set revoked_at = now()
  from salsamentaria.users u
 where s.user_id = u.id
   and u.email like '%@marketcastilla.demo'
   and s.revoked_at is null;
```

### 6) Desactivar las cuentas demo en la BD de prod
Reversible y suficiente (además del bloqueo por código):
```sql
update salsamentaria.users set is_active = false where email like '%@marketcastilla.demo';
```
Eliminar es opcional y más agresivo (revisar dependencias/FKs antes):
```sql
-- (Opcional) delete from salsamentaria.users where email like '%@marketcastilla.demo';
```

### 7) Desplegar el bloqueo de login y sesión
Mergear esta rama y desplegar. En producción el modo demo queda apagado por
diseño (login + sesión + UI). El owner real sigue entrando normal.

### 8) Verificar acceso real y rechazo demo
```sql
-- No deben quedar sesiones demo activas:
select count(*) from salsamentaria.sessions s
  join salsamentaria.users u on u.id = s.user_id
 where u.email like '%@marketcastilla.demo' and s.revoked_at is null and s.expires_at > now();
-- Debe devolver 0.
```
Además: iniciar sesión con `owner@marketcastilla.demo` / `demo1234` debe fallar
con "Correo o contraseña incorrectos.", el HTML de `/login` no debe listar
credenciales demo, y el propietario real debe entrar con permisos de owner.

## Rollback
- **Código:** no mergear (o `git revert` del commit / borrar la rama). Producción
  sigue en su commit actual.
- **Datos:** el paso 6 con `is_active=false` se revierte con
  `update ... set is_active=true`. El paso 5 (sesiones revocadas) no se revierte,
  pero solo obliga a re-loguear; no destruye datos.
- El propietario real creado en el paso 1 permanece (deseable).

## ⚠️ Limitación de la guardia: túneles / port-forward
La guardia de BD local valida el **hostname visible** en la `DATABASE_URL`; **no
puede** saber si un puerto loopback es en realidad un **túnel** hacia una base
remota. Por eso:
- **No** ejecutes `db:seed` (reset demo destructivo) mientras exista un **túnel
  SSH**, un **proxy local** o un **port-forward** apuntando a producción.
- **No** reutilices un puerto local que **redirija** a Supabase o a otra base
  gestionada.
- La guardia bloquea destinos remotos **directos**, pero un operador puede
  **derrotarla mediante un túnel local**; por eso `db:seed` solo debe correr
  contra un **clúster PostgreSQL local, efímero y desechable** (ver §Suite de
  pruebas). No se intenta detectar túneles por heurística.

## Notas de seguridad
- No se rota `SESSION_SECRET` ni claves de cifrado: no hay evidencia de que se
  hayan expuesto. `demo1234` es una credencial de demostración, no un secreto de
  infraestructura; se neutraliza con el bloqueo por código + desactivar cuentas.
- `DEMO_MODE` **no** debe definirse en producción; aunque se definiera, el código
  lo ignora en runtime de producción (fail-closed).
- `owner:create` **no** restablece contraseñas de cuentas existentes; un reset de
  contraseña debe diseñarse aparte como operación explícita y auditada.
