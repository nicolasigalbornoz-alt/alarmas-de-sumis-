// Envío diario de avisos por mail (Cron Trigger de Cloudflare + Resend).
// Un solo mail resumen por corrida, a la lista fija MAIL_DESTINOS:
//  - "aviso": la alerta entró en su período de aviso (vencimiento - días de aviso);
//  - "vence": hoy es el día del vencimiento.
// Cada combinación alerta/tipo/vencimiento se manda una sola vez. Las alertas
// completadas no avisan. Si una alerta se carga ya dentro del período de aviso,
// avisa en la próxima corrida.

import { asegurarTablas, type Alerta, type Env } from "./tipos";

const ZONA = "America/Argentina/Buenos_Aires";
const DIA = 86_400_000;

type Tipo = "aviso" | "vence";

interface Pendiente {
  alerta: Alerta;
  tipo: Tipo;
}

export interface Resultado {
  ok: boolean;
  enviados: number;
  detalle: string;
}

/** Fecha de hoy (YYYY-MM-DD) en hora argentina. */
export function hoyAR(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

const aMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const sumarDias = (iso: string, n: number) => new Date(aMs(iso) + n * DIA).toISOString().slice(0, 10);
const formato = (iso: string) => iso.split("-").reverse().join("/");
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function destinos(env: Env): string[] {
  return (env.MAIL_DESTINOS ?? "")
    .split(/[,;\s]+/)
    .map((m) => m.trim())
    .filter((m) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m));
}

async function pendientes(env: Env, hoy: string): Promise<Pendiente[]> {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.numero, a.etiqueta, a.vence, a.aviso_dias, a.completado, a.creado_en,
            (SELECT group_concat(e.tipo) FROM alertas_envios e WHERE e.alerta_id = a.id AND e.vence = a.vence) AS enviados
       FROM alertas_salud a
      WHERE a.completado = 0 AND a.vence >= ?
      ORDER BY a.vence, a.id`,
  )
    .bind(hoy)
    .all<Alerta & { enviados: string | null }>();

  const salida: Pendiente[] = [];
  for (const fila of results) {
    const ya = (fila.enviados ?? "").split(",");
    if (fila.vence === hoy) {
      if (!ya.includes("vence")) salida.push({ alerta: fila, tipo: "vence" });
    } else if (fila.aviso_dias > 0 && hoy >= sumarDias(fila.vence, -fila.aviso_dias) && !ya.includes("aviso")) {
      salida.push({ alerta: fila, tipo: "aviso" });
    }
  }
  return salida;
}

function cuando(a: Alerta, hoy: string, tipo: Tipo): string {
  if (tipo === "vence") return "Vence hoy";
  const dias = Math.round((aMs(a.vence) - aMs(hoy)) / DIA);
  return dias === 1 ? "Vence mañana" : `Vence en ${dias} días`;
}

function armarMail(env: Env, hoy: string, lista: Pendiente[]) {
  const hoyLista = lista.filter((p) => p.tipo === "vence");
  const avisos = lista.filter((p) => p.tipo === "aviso");

  const partes: string[] = [];
  if (hoyLista.length) partes.push(hoyLista.length === 1 ? "1 vence hoy" : `${hoyLista.length} vencen hoy`);
  if (avisos.length) partes.push(avisos.length === 1 ? "1 por vencer" : `${avisos.length} por vencer`);
  const asunto = `Alertas de suministros: ${partes.join(" y ")}`;

  const bloque = (titulo: string, items: Pendiente[]) =>
    items.length === 0
      ? ""
      : `<h3 style="margin:20px 0 8px;font-size:15px">${titulo}</h3>
<table style="border-collapse:collapse;width:100%;font-size:14px">
${items
  .map(
    (p) => `<tr>
  <td style="padding:8px;border-bottom:1px solid #ddd"><strong>N° ${esc(p.alerta.numero)}</strong><br><span style="color:#666">${esc(p.alerta.etiqueta)}</span></td>
  <td style="padding:8px;border-bottom:1px solid #ddd">${formato(p.alerta.vence)}</td>
  <td style="padding:8px;border-bottom:1px solid #ddd"><strong>${cuando(p.alerta, hoy, p.tipo)}</strong></td>
</tr>`,
  )
  .join("\n")}
</table>`;

  const enlace = env.SITIO_URL ? `<p style="margin-top:24px"><a href="${esc(env.SITIO_URL)}">Abrir las alertas</a></p>` : "";
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#222">
<h2 style="color:#c8102e;margin-bottom:4px">Alertas de suministros</h2>
<p style="margin-top:0;color:#666">Secretaría de Salud · ${formato(hoy)}</p>
${bloque("Vencen hoy", hoyLista)}
${bloque("Por vencer", avisos)}
${enlace}
<p style="margin-top:24px;font-size:12px;color:#888">Aviso automático. Las alertas completadas no se avisan.</p>
</div>`;

  const linea = (p: Pendiente) => `- N° ${p.alerta.numero} · ${p.alerta.etiqueta} — ${formato(p.alerta.vence)} (${cuando(p.alerta, hoy, p.tipo)})`;
  const texto = [
    `Alertas de suministros — ${formato(hoy)}`,
    hoyLista.length ? `\nVencen hoy:\n${hoyLista.map(linea).join("\n")}` : "",
    avisos.length ? `\nPor vencer:\n${avisos.map(linea).join("\n")}` : "",
    env.SITIO_URL ? `\n${env.SITIO_URL}` : "",
  ].join("\n");

  return { asunto, html, texto };
}

/** Manda el mail resumen del día. `hoy` sólo se pasa en pruebas. */
export async function enviarAvisos(env: Env, hoy: string = hoyAR()): Promise<Resultado> {
  if (!env.RESEND_API_KEY) return { ok: false, enviados: 0, detalle: "Falta el secret RESEND_API_KEY." };
  const para = destinos(env);
  if (para.length === 0) return { ok: false, enviados: 0, detalle: "Falta el secret MAIL_DESTINOS (o no tiene mails válidos)." };

  await asegurarTablas(env.DB);
  const lista = await pendientes(env, hoy);
  if (lista.length === 0) return { ok: true, enviados: 0, detalle: "No hay avisos para mandar hoy." };

  const { asunto, html, texto } = armarMail(env, hoy, lista);
  const resp = await fetch(env.RESEND_URL || "https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.MAIL_FROM || "Alertas de suministros <onboarding@resend.dev>",
      to: para,
      subject: asunto,
      html,
      text: texto,
    }),
  });
  if (!resp.ok) {
    const cuerpo = (await resp.text()).slice(0, 300);
    return { ok: false, enviados: 0, detalle: `Resend respondió ${resp.status}: ${cuerpo}` };
  }

  // Recién con el mail aceptado se marca como enviado: si falla, reintenta mañana.
  await env.DB.batch(
    lista.map((p) =>
      env.DB.prepare("INSERT OR IGNORE INTO alertas_envios (alerta_id, tipo, vence) VALUES (?, ?, ?)").bind(p.alerta.id, p.tipo, p.alerta.vence),
    ),
  );
  return { ok: true, enviados: lista.length, detalle: `Mail enviado a ${para.length} destinatario(s) con ${lista.length} aviso(s).` };
}
