// Worker `alertas-suministros`: el sitio de Alertas de renovación, aparte del
// de Suministros pero sobre la misma base D1 (mismos suministros, mismos
// usuarios y contraseñas). Exige sesión antes de entregar cualquier página.

import { cookieSesion, ingresar, ingresarPorSso, usuarioDeSesion } from "./auth";
import * as seg from "./seguimiento";
import { ejercicio, error, json, type Env } from "./tipos";

const PUBLICAS = [/^\/ingresar\.html$/, /^\/global\.css$/, /^\/fonts\//, /^\/brand\//, /^\/img\//, /^\/favicon\.png$/];

const redirigir = (destino: string, extra: Record<string, string> = {}) =>
  new Response(null, { status: 303, headers: { location: destino, ...extra } });

function rutaSegura(volver: string | null): string {
  if (!volver || !volver.startsWith("/") || volver.startsWith("//") || volver.startsWith("/\\")) return "/alertas.html";
  return volver;
}

function conSeguridad(resp: Response): Response {
  const r = new Response(resp.body, resp);
  r.headers.set("x-content-type-options", "nosniff");
  r.headers.set("referrer-policy", "same-origin");
  r.headers.set("x-frame-options", "DENY");
  return r;
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const metodo = request.method;

  if (path === "/api/auth/ingresar" && metodo === "POST") {
    const form = await request.formData();
    const volver = rutaSegura(String(form.get("volver") ?? ""));
    const r = await ingresar(env, String(form.get("legajo") ?? ""), String(form.get("clave") ?? ""));
    if (!r.ok) return redirigir(`/ingresar.html?error=${r.motivo}&volver=${encodeURIComponent(volver)}`);
    return redirigir(volver, { "set-cookie": cookieSesion(r.cookie) });
  }
  // Pase directo desde el botón "Alertas" de Suministros (ver ingresarPorSso).
  if (path === "/api/auth/sso" && metodo === "GET") {
    const r = await ingresarPorSso(env, url.searchParams.get("t") ?? "");
    if (!r.ok) return redirigir("/ingresar.html?error=sso");
    return redirigir(rutaSegura(url.searchParams.get("volver")), { "set-cookie": cookieSesion(r.cookie) });
  }
  if (path === "/api/auth/salir" && metodo === "POST") {
    return redirigir("/ingresar.html", { "set-cookie": cookieSesion("", true) });
  }

  const u = await usuarioDeSesion(env, request);
  if (!u) return error(401, "Sesión vencida. Vuelva a ingresar.");
  if (metodo !== "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return error(403, "Origen no permitido.");
    if (!(request.headers.get("content-type") ?? "").includes("application/json")) return error(415, "Se espera JSON.");
  }

  if (path === "/api/sesion") {
    return json({
      ok: true,
      usuario: { usuario: u.legajo, area: u.area, rol: u.rol },
      anio: ejercicio(env),
      suministrosUrl: env.SUMINISTROS_URL || null,
    });
  }
  if (path === "/api/suministros" && metodo === "GET") return seg.suministros(env, u);
  if (path === "/api/seguimiento" && metodo === "GET") return seg.listar(env, u);
  if (path === "/api/seguimiento" && metodo === "POST") return seg.agregar(env, u, request);

  const m = path.match(/^\/api\/seguimiento\/(\d+)$/);
  if (m) {
    if (metodo === "PATCH") return seg.actualizar(env, u, Number(m[1]), request);
    if (metodo === "DELETE") return seg.quitar(env, u, Number(m[1]));
  }
  return error(404, "Ruta inexistente.");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/api/")) return conSeguridad(await api(request, env, url));
    if (PUBLICAS.some((re) => re.test(path))) return conSeguridad(await env.ASSETS.fetch(request));

    const u = await usuarioDeSesion(env, request);
    if (!u) {
      if (path === "/" || path.endsWith(".html")) {
        const volver = path === "/" || path === "/index.html" ? "/alertas.html" : path + url.search;
        return redirigir(`/ingresar.html?volver=${encodeURIComponent(volver)}`);
      }
      return new Response("Sesión requerida", { status: 401 });
    }
    if (path === "/" || path === "/index.html") return redirigir("/alertas.html");

    const resp = await env.ASSETS.fetch(request);
    const r = new Response(resp.body, resp);
    if (path.endsWith(".html")) r.headers.set("cache-control", "no-store");
    return conSeguridad(r);
  },
};
