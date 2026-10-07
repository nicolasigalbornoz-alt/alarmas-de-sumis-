// Seguimiento de renovación por legajo, sobre la base de Suministros. Misma
// lógica que tenía la página Alertas del sitio de Suministros (antes en el
// localStorage del navegador): el cálculo de cobertura y vencimiento se hace
// en el navegador (public/alertas.js), acá solo se guarda qué sigue cada uno.

import { secretariaVisible, type Usuario } from "./auth";
import { ejercicio, error, json, leerJson, type Env } from "./tipos";

const AVISO_DEFECTO = 30;

// Suministros que el usuario puede seguir: los aprobados de su Secretaría
// (cuenta de área) o todos (perfiles centrales) -- mismo alcance que la
// página Alertas de siempre.
export async function suministros(env: Env, u: Usuario): Promise<Response> {
  const anio = ejercicio(env);
  const sec = secretariaVisible(u);
  const base = `SELECT numero, secretaria, dependencia, observaciones, etiqueta, mes_inicio, meses_consumo, oficina
                FROM suministros WHERE anio = ? AND estado = 'aprobado'`;
  const stmt = sec
    ? env.DB.prepare(`${base} AND secretaria = ? ORDER BY numero`).bind(anio, sec)
    : env.DB.prepare(`${base} ORDER BY numero`).bind(anio);
  return json({
    ok: true,
    anio,
    cols: ["numero", "secretaria", "dependencia", "observaciones", "etiqueta", "mes_inicio", "meses_consumo", "oficina"],
    rows: await stmt.raw(),
  });
}

export async function listar(env: Env, u: Usuario): Promise<Response> {
  const r = await env.DB.prepare(
    "SELECT numero, aviso_dias, etiqueta, completado FROM alertas_seguimiento WHERE legajo = ? AND anio = ? ORDER BY numero",
  )
    .bind(u.legajo, ejercicio(env))
    .all<{ numero: number; aviso_dias: number; etiqueta: string | null; completado: number }>();
  return json({ ok: true, seguimiento: r.results ?? [] });
}

function avisoValido(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 365 ? n : AVISO_DEFECTO;
}

/** Agrega varios de una vez (selector múltiple), todos con el mismo aviso y etiqueta. */
export async function agregar(env: Env, u: Usuario, request: Request): Promise<Response> {
  const b = await leerJson<{ numeros?: unknown[]; avisoDias?: unknown; etiqueta?: unknown }>(request);
  const numeros = [...new Set((b?.numeros ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
  if (numeros.length === 0) return error(400, "Elija al menos un suministro para agregar al seguimiento.");
  const anio = ejercicio(env);
  const sec = secretariaVisible(u);
  const etiqueta = String(b?.etiqueta ?? "").trim().slice(0, 40) || null;

  // Solo suministros aprobados y visibles para este usuario (un área no
  // puede seguir los de otra Secretaría aunque mande el número a mano).
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO alertas_seguimiento (legajo, anio, numero, aviso_dias, etiqueta)
     SELECT ?1, s.anio, s.numero, ?2, ?3 FROM suministros s
     WHERE s.anio = ?4 AND s.estado = 'aprobado' AND s.numero IN (SELECT value FROM json_each(?5))
       AND (?6 IS NULL OR s.secretaria = ?6)`,
  )
    .bind(u.legajo, avisoValido(b?.avisoDias), etiqueta, anio, JSON.stringify(numeros), sec)
    .run();
  return json({ ok: true, agregados: r.meta.changes ?? 0 });
}

export async function actualizar(env: Env, u: Usuario, numero: number, request: Request): Promise<Response> {
  const b = await leerJson<{ avisoDias?: unknown; etiqueta?: unknown; completado?: unknown }>(request);
  if (!b) return error(400, "Cuerpo inválido.");
  const sets: string[] = [];
  const binds: unknown[] = [];
  if ("avisoDias" in b) {
    sets.push("aviso_dias = ?");
    binds.push(avisoValido(b.avisoDias));
  }
  if ("etiqueta" in b) {
    sets.push("etiqueta = ?");
    binds.push(String(b.etiqueta ?? "").trim().slice(0, 40) || null);
  }
  if ("completado" in b) {
    sets.push("completado = ?");
    binds.push(b.completado ? 1 : 0);
  }
  if (sets.length === 0) return error(400, "No hay nada para cambiar.");
  const r = await env.DB.prepare(
    `UPDATE alertas_seguimiento SET ${sets.join(", ")}, actualizado_en = datetime('now') WHERE legajo = ? AND anio = ? AND numero = ?`,
  )
    .bind(...binds, u.legajo, ejercicio(env), numero)
    .run();
  if (!r.meta.changes) return error(404, `El N° ${numero} no está en su seguimiento.`);
  return json({ ok: true });
}

export async function quitar(env: Env, u: Usuario, numero: number): Promise<Response> {
  await env.DB.prepare("DELETE FROM alertas_seguimiento WHERE legajo = ? AND anio = ? AND numero = ?")
    .bind(u.legajo, ejercicio(env), numero)
    .run();
  return json({ ok: true });
}
