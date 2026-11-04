# Alertas de suministros — Secretaría de Salud

Página de carga de alertas de vencimiento de suministros. Cada alerta tiene:

- **N° de suministro**: texto libre, lo escribe el usuario (no se valida contra ningún sistema).
- **Etiqueta**: qué es (ropa, medicamentos, lo que sea), también libre.
- **Fecha de vencimiento** y **días de aviso** (por defecto 5): la alerta se activa
  "fecha de vencimiento − días de aviso".

Cuando una alerta entra en su período de aviso (o ya venció) la página muestra un
recuadro de atención arriba de todo y, si el usuario activó los avisos del navegador,
una notificación una vez por día. Esos avisos funcionan con la página abierta.
Las alertas se pueden marcar como completadas, editar o eliminar.

- **Cloudflare Worker** (`worker/index.ts`): API `/api/alertas` y entrega de la página.
- **Página** (`public/index.html`, `app.js`, `app.css`) con la estética institucional
  (`global.css`, fuentes Neo Sans, logo).
- **Datos** en D1, tablas `alertas_salud` y `alertas_envios` (mails ya mandados): el Worker las crea solo la primera vez que se usa.
- **Mail diario** (`worker/mail.ts`): Cron Trigger + Resend.

## Avisos por mail

Todos los días a las 8:00 (hora argentina) un Cron Trigger del Worker manda **un solo mail
resumen** a la lista fija de la secretaría, con:

- las alertas que **entraron en su período de aviso** (vencimiento − días de aviso), y
- las que **vencen hoy**.

Cada alerta avisa una vez por tipo y por fecha de vencimiento (si se cambia la fecha, vuelve a
avisar). Las completadas no avisan. Si una alerta se carga ya dentro del período de aviso,
avisa en la próxima corrida. Si Resend falla, no se marca como enviado y reintenta al día
siguiente. El envío es con [Resend](https://resend.com).

Secrets (Worker → Settings → Variables and Secrets, o `npx wrangler secret put <NOMBRE>`):

| Nombre           | Valor                                                                                   |
|------------------|-----------------------------------------------------------------------------------------|
| `RESEND_API_KEY` | API key de Resend                                                                       |
| `MAIL_DESTINOS`  | mails de la secretaría separados por coma                                               |
| `MAIL_FROM`      | remitente, ej. `Alertas de suministros <alertas@tudominio.gob.ar>` (dominio verificado en Resend). Si falta se usa `onboarding@resend.dev`, que sólo entrega al mail dueño de la cuenta de Resend (sirve para probar) |
| `CRON_TOKEN`     | opcional: habilita la prueba manual de abajo                                            |

Prueba manual (sólo existe si se cargó `CRON_TOKEN`; manda el mail de hoy si hay algo pendiente):

```bash
curl -X POST https://<worker>/api/mail/ejecutar -H "authorization: Bearer <CRON_TOKEN>"
```

Sin `RESEND_API_KEY` o `MAIL_DESTINOS` el Worker no manda nada y lo deja anotado en los logs.

## Puesta en Cloudflare

Workers & Pages → el repositorio conectado despliega con `npx wrangler deploy`
(sin comando de build). La base es la de `wrangler.toml` (`database_id`). Los secrets
son sólo los del mail (ver arriba) y son opcionales.

> La página **no tiene ingreso con usuario**: quien tenga la dirección puede cargar,
> editar y borrar alertas. Para restringirla, activar Cloudflare Access sobre el Worker
> (Zero Trust → Access → Applications) sin cambiar el código.

## Desarrollo local

```bash
npm install
npm run dev
npm run check   # tipos del Worker
```

## Estética

`public/global.css` es la hoja institucional de sde_v2 / formulario-17, sin modificar.
Las fuentes son Neo Sans (licencia comercial): confirmar que la licencia del Municipio
cubre su uso web antes de dejar el repo público.
