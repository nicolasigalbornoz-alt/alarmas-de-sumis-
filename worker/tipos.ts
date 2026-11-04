export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Dirección pública del sitio, para el enlace del mail. */
  SITIO_URL?: string;
  /** Secrets del envío de mails (ver README). Sin ellos no se manda nada. Si hay APPS_SCRIPT_URL se usa el script de Google; si no, Resend. */
  RESEND_API_KEY?: string;
  /** Direcciones destino separadas por coma. */
  MAIL_DESTINOS?: string;
  /** Remitente; si falta se usa el de prueba de Resend, que sólo entrega al dueño de la cuenta. */
  MAIL_FROM?: string;
  /** Opcional: habilita POST /api/mail/ejecutar con este token, para probar el envío. */
  CRON_TOKEN?: string;
  /** Opcional: otra URL de la API de Resend (pruebas locales). */
  RESEND_URL?: string;
  /** Alternativa a Resend: dirección /exec del script de Google (docs/apps-script.gs) que manda desde un Gmail. */
  APPS_SCRIPT_URL?: string;
  /** Clave compartida con ese script. */
  APPS_SCRIPT_TOKEN?: string;
}

export interface Alerta {
  id: number;
  numero: string;
  etiqueta: string;
  vence: string;
  aviso_dias: number;
  completado: number;
  creado_en: string;
}

export const AVISO_POR_DEFECTO = 5;

let tablasListas = false;
/** Crea las tablas la primera vez que se usa el Worker (idempotente). */
export async function asegurarTablas(db: D1Database): Promise<void> {
  if (tablasListas) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS alertas_salud (
         id          INTEGER PRIMARY KEY AUTOINCREMENT,
         numero      TEXT NOT NULL,
         etiqueta    TEXT NOT NULL,
         vence       TEXT NOT NULL,
         aviso_dias  INTEGER NOT NULL DEFAULT ${AVISO_POR_DEFECTO},
         completado  INTEGER NOT NULL DEFAULT 0,
         creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    ),
    // Qué mails ya se mandaron. Incluye `vence`: si se cambia la fecha de una
    // alerta, vuelve a avisar.
    db.prepare(
      `CREATE TABLE IF NOT EXISTS alertas_envios (
         alerta_id   INTEGER NOT NULL,
         tipo        TEXT NOT NULL,
         vence       TEXT NOT NULL,
         enviado_en  TEXT NOT NULL DEFAULT (datetime('now')),
         PRIMARY KEY (alerta_id, tipo, vence)
       )`,
    ),
  ]);
  tablasListas = true;
}
