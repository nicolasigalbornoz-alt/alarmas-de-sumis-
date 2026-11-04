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
- **Datos** en D1, tabla `alertas_salud`: el Worker la crea sola la primera vez que se usa.

## Puesta en Cloudflare

Workers & Pages → el repositorio conectado despliega con `npx wrangler deploy`
(sin comando de build). La base es la de `wrangler.toml` (`database_id`); no hay
secrets ni variables.

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
