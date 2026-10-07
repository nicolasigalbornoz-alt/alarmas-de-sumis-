export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET?: string;
  /** Compartido con el Worker `suministros`: firma el pase directo desde su botón "Alertas". */
  SSO_SECRET?: string;
  EJERCICIO?: string;
  /** Dirección de Suministros, para el enlace "Volver a Suministros". */
  SUMINISTROS_URL?: string;
}

export function ejercicio(env: Env): number {
  const n = Number(env.EJERCICIO);
  return Number.isInteger(n) && n > 2000 ? n : new Date().getFullYear();
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export const error = (status: number, mensaje: string) => json({ ok: false, error: mensaje }, status);

export async function leerJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
