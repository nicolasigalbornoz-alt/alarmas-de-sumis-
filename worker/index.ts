// Worker `alarmas-de-sumis`: página de carga de alertas de vencimiento de
// suministros para la Secretaría de Salud. No valida contra ningún otro
// sistema: cada alerta es un número de suministro libre, una etiqueta libre y
// la fecha de vencimiento. Los datos viven en la tabla `alertas_salud` de D1,
// que el propio Worker crea la primera vez que se usa.

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

interface Alerta {
  id: number;
  numero: string;
  etiqueta: string;
  vence: string;
  aviso_dias: number;
  completado: number;
  creado_en: string;
}

interface Entrada {
  numero?: unknown;
  etiqueta?: unknown;
  vence?: unknown;
  aviso_dias?: unknown;
  completado?: unknown;
}

const AVISO_POR_DEFECTO = 5;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const error = (status: number, mensaje: string) => json({ ok: false, error: mensaje }, status);

let tablaLista = false;
async function asegurarTabla(db: D1Database): Promise<void> {
  if (tablaLista) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS alertas_salud (
         id          INTEGER PRIMARY KEY AUTOINCREMENT,
         numero      TEXT NOT NULL,
         etiqueta    TEXT NOT NULL,
         vence       TEXT NOT NULL,
         aviso_dias  INTEGER NOT NULL DEFAULT ${AVISO_POR_DEFECTO},
         completado  INTEGER NOT NULL DEFAULT 0,
         creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    )
    .run();
  tablaLista = true;
}

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
    "SELECT id, numero, etiqueta, vence, aviso_dias, completado, creado_en FROM alertas_salud ORDER BY completado, vence, id",
  ).all<Alerta>();
  return json({ ok: true, alertas: results });
}

async function agregar(env: Env, request: Request): Promise<Response> {
  const d = await leerJson(request);
  if (!d) return error(400, "Datos inválidos.");
  const numero = texto(d.numero, 40);
  const etiqueta = texto(d.etiqueta, 60);
  const aviso = d.aviso_dias === undefined || d.aviso_dias === "" ? AVISO_POR_DEFECTO : avisoValido(d.aviso_dias);
  if (!numero) return error(400, "Ingresá el número de suministro (hasta 40 caracteres).");
  if (!etiqueta) return error(400, "Ingresá una etiqueta (hasta 60 caracteres).");
  if (!fechaValida(d.vence)) return error(400, "Ingresá una fecha de vencimiento válida.");
  if (aviso === null) return error(400, "Los días de aviso deben ser un número entre 0 y 365.");

  const r = await env.DB.prepare("INSERT INTO alertas_salud (numero, etiqueta, vence, aviso_dias) VALUES (?, ?, ?, ?)")
    .bind(numero, etiqueta, d.vence, aviso)
    .run();
  return json({ ok: true, id: r.meta.last_row_id }, 201);
}

async function actualizar(env: Env, id: number, request: Request): Promise<Response> {
  const d = await leerJson(request);
  if (!d) return error(400, "Datos inválidos.");
  const campos: string[] = [];
  const valores: (string | number)[] = [];

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
  const r = await env.DB.prepare("DELETE FROM alertas_salud WHERE id = ?").bind(id).run();
  if (!r.meta.changes) return error(404, "La alerta no existe.");
  return json({ ok: true });
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const metodo = request.method;
  if (metodo !== "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return error(403, "Origen no permitido.");
    if (metodo !== "DELETE" && !(request.headers.get("content-type") ?? "").includes("application/json")) {
      return error(415, "Se espera JSON.");
    }
  }
  await asegurarTabla(env.DB);

  if (url.pathname === "/api/alertas") {
    if (metodo === "GET") return listar(env);
    if (metodo === "POST") return agregar(env, request);
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
