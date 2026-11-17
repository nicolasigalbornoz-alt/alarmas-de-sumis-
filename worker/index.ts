// Worker `alarmas-de-sumis`: página de carga de alertas de vencimiento de
// suministros para la Secretaría de Salud. No valida contra ningún otro
// sistema: cada alerta es un número de suministro libre, una etiqueta libre y
// la fecha de vencimiento. Los datos viven en la tabla `alertas_salud` de D1,
// que el propio Worker crea la primera vez que se usa.

import { enviarAvisos } from "./mail";
import { asegurarTablas, AVISO_POR_DEFECTO, type Alerta, type Env, type Rubro } from "./tipos";

interface Entrada {
  rubro?: unknown;
  nombre?: unknown;
  numero?: unknown;
  etiqueta?: unknown;
  vence?: unknown;
  desde?: unknown;
  aviso_dias?: unknown;
  completado?: unknown;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const error = (status: number, mensaje: string) => json({ ok: false, error: mensaje }, status);

function fechaValida(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
}

/** Rubros administrados en la pestaña Rubros, por orden alfabético, con cuántas alertas usa cada uno. */
async function listaRubros(env: Env): Promise<Rubro[]> {
  const { results } = await env.DB.prepare(
    "SELECT r.id, r.nombre, (SELECT COUNT(*) FROM alertas_salud a WHERE a.rubro = r.nombre) AS alertas FROM rubros r",
  ).all<Rubro>();
  return results.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Nombre de rubro limpio (espacios colapsados, hasta 40 caracteres) o null si no sirve. */
function nombreRubro(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const limpio = v.replace(/\s+/g, " ").trim();
  return limpio && limpio.length <= 40 ? limpio : null;
}

/** El rubro de una alerta: si no existe todavía ("Escribir otro rubro") se crea; si existe con otras mayúsculas, se usa esa grafía. */
async function asegurarRubro(env: Env, v: unknown): Promise<string | null> {
  const limpio = nombreRubro(v);
  if (!limpio) return null;
  const existente = (await listaRubros(env)).find((r) => r.nombre.toLowerCase() === limpio.toLowerCase());
  if (existente) return existente.nombre;
  await env.DB.prepare("INSERT INTO rubros (nombre) VALUES (?)").bind(limpio).run();
  return limpio;
}

async function agregarRubro(env: Env, request: Request): Promise<Response> {
  const d = await leerJson(request);
  const nombre = nombreRubro(d?.nombre);
  if (!nombre) return error(400, "Escribí el nombre del rubro (hasta 40 caracteres).");
  if ((await listaRubros(env)).some((r) => r.nombre.toLowerCase() === nombre.toLowerCase())) return error(409, "Ya existe ese rubro.");
  const r = await env.DB.prepare("INSERT INTO rubros (nombre) VALUES (?)").bind(nombre).run();
  return json({ ok: true, id: r.meta.last_row_id }, 201);
}

async function renombrarRubro(env: Env, id: number, request: Request): Promise<Response> {
  const d = await leerJson(request);
  const nombre = nombreRubro(d?.nombre);
  if (!nombre) return error(400, "Escribí el nombre del rubro (hasta 40 caracteres).");
  const todos = await listaRubros(env);
  const actual = todos.find((r) => r.id === id);
  if (!actual) return error(404, "El rubro no existe.");
  if (todos.some((r) => r.id !== id && r.nombre.toLowerCase() === nombre.toLowerCase())) return error(409, "Ya existe otro rubro con ese nombre.");
  // Las alertas que lo usan pasan al nombre nuevo.
  await env.DB.batch([
    env.DB.prepare("UPDATE rubros SET nombre = ? WHERE id = ?").bind(nombre, id),
    env.DB.prepare("UPDATE alertas_salud SET rubro = ? WHERE rubro = ?").bind(nombre, actual.nombre),
  ]);
  return json({ ok: true });
}

async function quitarRubro(env: Env, id: number): Promise<Response> {
  const actual = (await listaRubros(env)).find((r) => r.id === id);
  if (!actual) return error(404, "El rubro no existe.");
  if (actual.alertas > 0) {
    return error(409, `No se puede eliminar "${actual.nombre}": ${actual.alertas === 1 ? "lo usa 1 alerta" : `lo usan ${actual.alertas} alertas`}. Cambiales el rubro o eliminalas primero.`);
  }
  await env.DB.prepare("DELETE FROM rubros WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

function avisoValido(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : null;
}

async function leerJson(request: Request): Promise<Entrada | null> {
  try {
    const d = await request.json();
    return d && typeof d === "object" ? (d as Entrada) : null;
  } catch {
    return null;
  }
}

async function listar(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, rubro, numero, etiqueta, vence, COALESCE(desde, substr(creado_en, 1, 10)) AS desde, aviso_dias, completado, creado_en FROM alertas_salud ORDER BY completado, vence, id",
  ).all<Alerta>();
  return json({ ok: true, alertas: results, rubros: await listaRubros(env) });
}

async function agregar(env: Env, request: Request): Promise<Response> {
  const d = await leerJson(request);
  if (!d) return error(400, "Datos inválidos.");
  const rubro = await asegurarRubro(env, d.rubro);
  const numero = texto(d.numero, 40);
  const etiqueta = texto(d.etiqueta, 60);
  const aviso = d.aviso_dias === undefined || d.aviso_dias === "" ? AVISO_POR_DEFECTO : avisoValido(d.aviso_dias);
  if (!rubro) return error(400, "Elegí o escribí un rubro (hasta 40 caracteres).");
  if (!numero) return error(400, "Ingresá el número de suministro (hasta 40 caracteres).");
  if (!etiqueta) return error(400, "Ingresá una etiqueta (hasta 60 caracteres).");
  if (!fechaValida(d.vence)) return error(400, "Ingresá una fecha de vencimiento válida.");
  if (aviso === null) return error(400, "Los días de aviso deben ser un número entre 0 y 365.");
  const desde = d.desde === undefined || d.desde === "" ? null : d.desde;
  if (desde !== null && !fechaValida(desde)) return error(400, "La fecha \"Cubre desde\" no es válida.");
  if (desde !== null && desde > d.vence) return error(400, "\"Cubre desde\" no puede ser posterior al vencimiento.");

  const r = await env.DB.prepare("INSERT INTO alertas_salud (rubro, numero, etiqueta, vence, desde, aviso_dias) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(rubro, numero, etiqueta, d.vence, desde, aviso)
    .run();
  return json({ ok: true, id: r.meta.last_row_id }, 201);
}

async function actualizar(env: Env, id: number, request: Request): Promise<Response> {
  const d = await leerJson(request);
  if (!d) return error(400, "Datos inválidos.");
  const campos: string[] = [];
  const valores: (string | number)[] = [];

  if (d.rubro !== undefined) {
    const v = await asegurarRubro(env, d.rubro);
    if (!v) return error(400, "Rubro inválido (hasta 40 caracteres).");
    campos.push("rubro = ?");
    valores.push(v);
  }
  if (d.numero !== undefined) {
    const v = texto(d.numero, 40);
    if (!v) return error(400, "Número de suministro inválido.");
    campos.push("numero = ?");
    valores.push(v);
  }
  if (d.etiqueta !== undefined) {
    const v = texto(d.etiqueta, 60);
    if (!v) return error(400, "Etiqueta inválida.");
    campos.push("etiqueta = ?");
    valores.push(v);
  }
  if (d.vence !== undefined) {
    if (!fechaValida(d.vence)) return error(400, "Fecha de vencimiento inválida.");
    campos.push("vence = ?");
    valores.push(d.vence);
  }
  if (d.desde !== undefined) {
    if (!fechaValida(d.desde)) return error(400, "La fecha \"Cubre desde\" no es válida.");
    campos.push("desde = ?");
    valores.push(d.desde);
  }
  if (d.vence !== undefined || d.desde !== undefined) {
    // El período cubierto no puede quedar al revés: se compara con lo que ya estaba guardado.
    const actual = await env.DB.prepare("SELECT vence, COALESCE(desde, substr(creado_en, 1, 10)) AS desde FROM alertas_salud WHERE id = ?")
      .bind(id)
      .first<{ vence: string; desde: string }>();
    if (!actual) return error(404, "La alerta no existe.");
    const desde = (d.desde as string | undefined) ?? actual.desde;
    const vence = (d.vence as string | undefined) ?? actual.vence;
    if (desde > vence) return error(400, "\"Cubre desde\" no puede ser posterior al vencimiento.");
  }
  if (d.aviso_dias !== undefined) {
    const v = avisoValido(d.aviso_dias);
    if (v === null) return error(400, "Días de aviso inválidos.");
    campos.push("aviso_dias = ?");
    valores.push(v);
  }
  if (d.completado !== undefined) {
    campos.push("completado = ?");
    valores.push(d.completado ? 1 : 0);
  }
  if (campos.length === 0) return error(400, "No hay nada para actualizar.");

  const r = await env.DB.prepare(`UPDATE alertas_salud SET ${campos.join(", ")} WHERE id = ?`)
    .bind(...valores, id)
    .run();
  if (!r.meta.changes) return error(404, "La alerta no existe.");
  return json({ ok: true });
}

async function quitar(env: Env, id: number): Promise<Response> {
  const [r] = await env.DB.batch([
    env.DB.prepare("DELETE FROM alertas_salud WHERE id = ?").bind(id),
    env.DB.prepare("DELETE FROM alertas_envios WHERE alerta_id = ?").bind(id),
  ]);
  if (!r.meta.changes) return error(404, "La alerta no existe.");
  return json({ ok: true });
}

// Prueba manual del envío; sólo existe si se cargó el secret CRON_TOKEN.
async function ejecutarMail(env: Env, request: Request): Promise<Response> {
  const token = env.CRON_TOKEN;
  if (!token) return error(404, "Ruta inexistente.");
  if (request.headers.get("authorization") !== `Bearer ${token}`) return error(401, "No autorizado.");
  const r = await enviarAvisos(env);
  return json(r, r.ok ? 200 : 500);
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const metodo = request.method;
  if (url.pathname === "/api/mail/ejecutar" && metodo === "POST") return ejecutarMail(env, request);
  if (metodo !== "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return error(403, "Origen no permitido.");
    if (metodo !== "DELETE" && !(request.headers.get("content-type") ?? "").includes("application/json")) {
      return error(415, "Se espera JSON.");
    }
  }
  await asegurarTablas(env.DB);

  if (url.pathname === "/api/alertas") {
    if (metodo === "GET") return listar(env);
    if (metodo === "POST") return agregar(env, request);
  }
  if (url.pathname === "/api/rubros") {
    if (metodo === "GET") return json({ ok: true, rubros: await listaRubros(env) });
    if (metodo === "POST") return agregarRubro(env, request);
  }
  const mr = url.pathname.match(/^\/api\/rubros\/(\d+)$/);
  if (mr) {
    if (metodo === "PATCH") return renombrarRubro(env, Number(mr[1]), request);
    if (metodo === "DELETE") return quitarRubro(env, Number(mr[1]));
  }
  const m = url.pathname.match(/^\/api\/alertas\/(\d+)$/);
  if (m) {
    if (metodo === "PATCH") return actualizar(env, Number(m[1]), request);
    if (metodo === "DELETE") return quitar(env, Number(m[1]));
  }
  return error(404, "Ruta inexistente.");
}

function conSeguridad(resp: Response): Response {
  const r = new Response(resp.body, resp);
  r.headers.set("x-content-type-options", "nosniff");
  r.headers.set("referrer-policy", "same-origin");
  r.headers.set("x-frame-options", "DENY");
  return r;
}

export default {
  // Cron Trigger diario (ver wrangler.toml).
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      enviarAvisos(env).then(
        (r) => console.log(r.ok ? "avisos:" : "avisos fallidos:", r.detalle),
        (e) => console.error("avisos: error", e),
      ),
    );
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return conSeguridad(await api(request, env, url));
      if (url.pathname === "/") {
        const resp = await env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
        const r = conSeguridad(resp);
        r.headers.set("cache-control", "no-store");
        return r;
      }
      return conSeguridad(await env.ASSETS.fetch(request));
    } catch (e) {
      console.error(e);
      return conSeguridad(error(500, "Error interno. Probá de nuevo en un momento."));
    }
  },
};
