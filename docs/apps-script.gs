/**
 * Envío de los avisos desde un Gmail, sin dominio ni DNS.
 *
 * Instalación (se hace una sola vez, con la cuenta de Gmail que va a figurar como remitente):
 *  1. Entrar a https://script.google.com → "Nuevo proyecto" y pegar todo este archivo.
 *  2. Engranaje "Configuración del proyecto" → "Propiedades de la secuencia de comandos"
 *     → agregar la propiedad  TOKEN  con una clave larga al azar (la misma que se carga
 *     en Cloudflare como APPS_SCRIPT_TOKEN).
 *  3. "Implementar" → "Nueva implementación" → tipo "Aplicación web":
 *       - Ejecutar como: Yo
 *       - Quién tiene acceso: Cualquier persona
 *     Autorizar los permisos que pide (enviar correo) y copiar la URL que termina en /exec
 *     (se carga en Cloudflare como APPS_SCRIPT_URL).
 *  Si se cambia este código después, hay que "Administrar implementaciones" → editar → nueva versión.
 */
function doPost(e) {
  var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  var d;
  try {
    d = JSON.parse(e.postData.contents);
  } catch (err) {
    return salida({ ok: false, error: 'JSON inválido' });
  }
  if (!token || d.token !== token) return salida({ ok: false, error: 'Token incorrecto' });
  if (!d.to || !d.to.length || !d.subject) return salida({ ok: false, error: 'Faltan datos' });
  try {
    MailApp.sendEmail({
      to: d.to.join(','),
      subject: d.subject,
      body: d.text || '',
      htmlBody: d.html || undefined,
      name: 'Alertas de suministros'
    });
  } catch (err) {
    return salida({ ok: false, error: String(err) });
  }
  return salida({ ok: true });
}

function salida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
