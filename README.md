# Alertas de renovación de suministros

Sitio aparte del **Sistema de Suministros** del Municipio de Morón: cada legajo elige
qué suministros aprobados seguir, con cuántos días de aviso y una etiqueta libre, y el
sitio muestra cuáles están vencidos, por vencer o vigentes según su cobertura
(Mes de inicio + Meses de consumo), con un calendario del ejercicio.

- **Cloudflare Worker** (`worker/`) + assets estáticos (`public/`).
- **Misma base D1 que Suministros** (`suministros_db`): mismos usuarios y contraseñas,
  mismos suministros. Lo único propio es la tabla `alertas_seguimiento`.
- **Sesión propia** (cookie `alertas_sesion`), con el mismo legajo y contraseña de
  Suministros. El botón "Alertas" de Suministros entra directo, sin volver a pedir la
  clave: le pasa un pase firmado con `SSO_SECRET` que vence a los 60 segundos.
- Un usuario de área ve sólo los suministros de su Secretaría (lo fuerza el servidor);
  los perfiles centrales ven todos.

## Estructura

```
wrangler.toml          configuración del Worker (nombre, D1, variables)
worker/index.ts        rutas: ingreso, pase desde Suministros, API, páginas con sesión
worker/auth.ts         sesión HMAC, contraseñas PBKDF2, bloqueo por intentos fallidos
worker/seguimiento.ts  API del seguimiento (listar, agregar, editar, quitar)
public/alertas.html    la página (calendario + lista en seguimiento)
public/alertas.js      cobertura, estados y render
public/alertas.css     piezas propias (contadores, selector múltiple, calendario, lista)
public/global.css      estética institucional (sde_v2 / formulario-17), sin modificar
public/fonts/          Neo Sans (regular, bold, ultra)
public/img/            foto de la plaza (panel del ingreso)
sql/0002_alertas.sql   tabla alertas_seguimiento
```

## Puesta en Cloudflare

**1. Base de datos.** El sitio necesita la base `suministros_db` del Worker
`suministros` ya creada y con datos (usuarios y suministros). Copiar su ID
(Cloudflare → Storage & Databases → D1 → `suministros_db`) en `wrangler.toml`,
en lugar de `00000000-0000-0000-0000-000000000000`, y hacer commit.

La tabla de este sitio ya viene en las migraciones de Suministros. Si la base se creó
antes de esa migración, crearla una vez (es `CREATE TABLE IF NOT EXISTS`, no pisa nada):

```bash
npx wrangler d1 execute suministros_db --remote --file sql/0002_alertas.sql
```

**2. Worker.** Workers & Pages → Create → *Import a repository* → este repo.
Comando de deploy: `npx wrangler deploy` (sin comando de build). El nombre del
Worker sale de `wrangler.toml`: `alertas-suministros`.

**3. Secrets** (Worker → Settings → Variables and Secrets, tipo *Secret*):

| Nombre           | Valor                                                                 |
|------------------|-----------------------------------------------------------------------|
| `SESSION_SECRET` | cadena larga al azar, propia de este sitio                            |
| `SSO_SECRET`     | **la misma** que tiene el Worker `suministros` (si no, el botón "Alertas" de Suministros manda a la pantalla de ingreso) |

**4. Direcciones cruzadas.** Si las URLs finales cambian:
- acá, `SUMINISTROS_URL` en `wrangler.toml`;
- en Suministros, `ALERTAS_URL` (hoy `https://alertas-suministros.moron-presupuesto.workers.dev`).

**5. Probar.** Entrar a `https://<worker>/` → pide legajo y contraseña → muestra
las alertas. Desde Suministros, el botón "Alertas" tiene que entrar sin pedir clave.

## Desarrollo local

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Para probar con datos, `wrangler dev` tiene que usar la misma base local que el
Worker `suministros` (`--persist-to` apuntando a su carpeta `.wrangler/state`).
`npm run check` revisa los tipos del Worker.

## Estética

Misma base que sde_v2 y formulario-17: `public/global.css` se copia tal cual de
formulario-17 (`src/styles/global.css`) para que los dos sitios no se separen; lo propio
de Alertas va en `public/alertas.css`. Las fuentes son Neo Sans (licencia comercial):
confirmar que la licencia del Municipio cubre su uso web antes de dejar el repo público.
