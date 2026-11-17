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

export interface Rubro {
  id: number;
  nombre: string;
  /** Cuántas alertas lo usan (sólo en los listados). */
  alertas: number;
}

export interface Alerta {
  id: number;
  /** Nombre de un rubro de la tabla `rubros` (se administran en la pestaña Rubros); null = sin rubro. */
  rubro: string | null;
  numero: string;
  /** Descripción específica, texto libre. */
  etiqueta: string;
  vence: string;
  /** Desde cuándo cubre el suministro (AAAA-MM-DD); sin dato, la fecha de carga. */
  desde: string;
  aviso_dias: number;
  completado: number;
  creado_en: string;
}

export const AVISO_POR_DEFECTO = 5;

let tablasListas = false;
/** Crea las tablas la primera vez que se usa el Worker (idempotente). */
export async function asegurarTablas(db: D1Database): Promise<void> {
  if (tablasListas) return;
  const habiaRubros = await db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'rubros'").first();
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS alertas_salud (
         id          INTEGER PRIMARY KEY AUTOINCREMENT,
         rubro       TEXT,
         numero      TEXT NOT NULL,
         etiqueta    TEXT NOT NULL,
         vence       TEXT NOT NULL,
         desde       TEXT,
         aviso_dias  INTEGER NOT NULL DEFAULT ${AVISO_POR_DEFECTO},
         completado  INTEGER NOT NULL DEFAULT 0,
         creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    ),
    // Rubros que administran los usuarios (empieza vacía).
    db.prepare(
      `CREATE TABLE IF NOT EXISTS rubros (
         id         INTEGER PRIMARY KEY AUTOINCREMENT,
         nombre     TEXT NOT NULL,
         creado_en  TEXT NOT NULL DEFAULT (datetime('now'))
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
  // Bases creadas antes de que existiera "desde": se agrega la columna una vez.
  const { results } = await db.prepare("PRAGMA table_info(alertas_salud)").all<{ name: string }>();
  if (!results.some((c) => c.name === "desde")) await db.prepare("ALTER TABLE alertas_salud ADD COLUMN desde TEXT").run();
  if (!results.some((c) => c.name === "rubro")) await db.prepare("ALTER TABLE alertas_salud ADD COLUMN rubro TEXT").run();
  if (!habiaRubros) {
    // Primera vez con la tabla de rubros: los que ya usaban las alertas pasan a la lista, sin repetir
    // mayúsculas ("Ropa" y "ropa" son uno solo), y las alertas se unifican con la grafía elegida.
    const { results: usados } = await db.prepare("SELECT DISTINCT rubro FROM alertas_salud WHERE rubro IS NOT NULL AND rubro <> '' ORDER BY rubro").all<{ rubro: string }>();
    const canonico = new Map<string, string>();
    for (const { rubro } of usados) if (!canonico.has(rubro.toLowerCase())) canonico.set(rubro.toLowerCase(), rubro);
    const sentencias = [...canonico.values()].map((n) => db.prepare("INSERT INTO rubros (nombre) VALUES (?)").bind(n));
    for (const { rubro } of usados) {
      const c = canonico.get(rubro.toLowerCase())!;
      if (c !== rubro) sentencias.push(db.prepare("UPDATE alertas_salud SET rubro = ? WHERE rubro = ?").bind(c, rubro));
    }
    if (sentencias.length) await db.batch(sentencias);
  }
  tablasListas = true;
}
