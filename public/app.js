// Alertas de suministros: carga, lista y avisos. Todo lo que se muestra se arma
// con textContent (nada de innerHTML con datos cargados por los usuarios).
(function () {
  "use strict";

  var DIA = 86400000;
  var $ = function (id) { return document.getElementById(id); };
  var alertas = [];
  var editandoId = null;

  // ------------------------------------------------------------------ fechas

  function hoy() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function aFecha(iso) {
    var p = iso.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function aIso(d) {
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + dd;
  }
  function formato(iso) {
    var p = iso.split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }
  function diasHasta(iso) {
    return Math.round((aFecha(iso) - hoy()) / DIA);
  }

  function estado(a) {
    if (a.completado) return "completado";
    var dias = diasHasta(a.vence);
    if (dias < 0) return "vencido";
    if (dias <= a.aviso_dias) return "por-vencer";
    return "vigente";
  }

  function textoDias(dias) {
    if (dias < -1) return "Venció hace " + -dias + " días";
    if (dias === -1) return "Venció ayer";
    if (dias === 0) return "Vence hoy";
    if (dias === 1) return "Vence mañana";
    return "Vence en " + dias + " días";
  }

  // ------------------------------------------------------------------ API

  function pedir(metodo, url, cuerpo) {
    var opciones = { method: metodo, headers: {} };
    if (cuerpo !== undefined) {
      opciones.headers["content-type"] = "application/json";
      opciones.body = JSON.stringify(cuerpo);
    }
    return fetch(url, opciones).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "Respuesta inesperada del servidor." }; });
    }).then(function (d) {
      if (!d.ok) throw new Error(d.error || "No se pudo completar la operación.");
      return d;
    });
  }

  function mostrarMensaje(texto, tipo) {
    var el = $("mensaje");
    if (!texto) { el.hidden = true; return; }
    el.className = "alert alert-" + (tipo || "error");
    el.textContent = texto;
    el.hidden = false;
    if (tipo === "success") setTimeout(function () { if (el.textContent === texto) el.hidden = true; }, 4000);
  }

  function cargar() {
    return pedir("GET", "/api/alertas").then(function (d) {
      alertas = d.alertas;
      dibujar();
      avisarNavegador();
    }).catch(function (e) { mostrarMensaje(e.message); });
  }

  // ------------------------------------------------------------------ dibujo

  function el(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }

  function dibujarStats() {
    var c = { vencido: 0, "por-vencer": 0, vigente: 0, completado: 0 };
    alertas.forEach(function (a) { c[estado(a)]++; });
    var tarjetas = [
      ["vencido", c.vencido, "Vencidas"],
      ["por-vencer", c["por-vencer"], "Por vencer"],
      ["vigente", c.vigente, "Vigentes"],
      ["completado", c.completado, "Completadas"],
    ];
    var cont = $("stats");
    cont.replaceChildren();
    tarjetas.forEach(function (t) {
      var s = el("div", "stat stat-" + t[0]);
      s.appendChild(el("strong", "", String(t[1])));
      s.appendChild(el("span", "", t[2]));
      cont.appendChild(s);
    });
  }

  function dibujarAtencion() {
    var activas = alertas.filter(function (a) {
      var e = estado(a);
      return e === "vencido" || e === "por-vencer";
    }).sort(function (a, b) { return a.vence < b.vence ? -1 : 1; });
    var cont = $("atencion");
    cont.replaceChildren();
    cont.hidden = activas.length === 0;
    if (!activas.length) return;
    cont.appendChild(el("h2", "", activas.length === 1 ? "Atención: 1 suministro requiere acción" : "Atención: " + activas.length + " suministros requieren acción"));
    var ul = el("ul");
    activas.forEach(function (a) {
      var li = el("li", diasHasta(a.vence) === 0 ? "atencion-hoy" : "");
      li.appendChild(el("strong", "", "N° " + a.numero + " · " + a.etiqueta));
      li.appendChild(document.createTextNode(" — " + textoDias(diasHasta(a.vence)).toLowerCase() + " (" + formato(a.vence) + ")"));
      ul.appendChild(li);
    });
    cont.appendChild(ul);
  }

  function boton(texto, clase, accion) {
    var b = el("button", "btn btn-sm " + clase, texto);
    b.type = "button";
    b.addEventListener("click", accion);
    return b;
  }

  function filaAlerta(a) {
    var e = estado(a);
    var dias = diasHasta(a.vence);
    var fila = el("article", "alerta alerta-" + e);

    var info = el("div", "alerta-info");
    info.appendChild(el("span", "alerta-etiqueta", a.etiqueta));
    info.appendChild(el("strong", "alerta-numero", "N° " + a.numero));
    var avisar = new Date(aFecha(a.vence).getTime() - a.aviso_dias * DIA);
    info.appendChild(el("span", "alerta-detalle", "Vence el " + formato(a.vence) + " · avisa desde el " + formato(aIso(avisar)) + " (" + a.aviso_dias + (a.aviso_dias === 1 ? " día" : " días") + " antes)"));
    fila.appendChild(info);

    fila.appendChild(el("span", "alerta-chip", e === "completado" ? "Completado" : textoDias(dias)));

    var acciones = el("div", "alerta-acciones");
    acciones.appendChild(boton(a.completado ? "Reabrir" : "Completar", "btn-secondary", function () { cambiar(a.id, { completado: !a.completado }); }));
    acciones.appendChild(boton("Editar", "btn-secondary", function () { editar(a); }));
    acciones.appendChild(boton("Eliminar", "btn-secondary btn-peligro", function () { eliminar(a); }));
    fila.appendChild(acciones);
    return fila;
  }

  function dibujarLista() {
    var q = $("buscar").value.trim().toLowerCase();
    var visibles = alertas.filter(function (a) {
      return !q || a.numero.toLowerCase().indexOf(q) !== -1 || a.etiqueta.toLowerCase().indexOf(q) !== -1;
    });
    var cont = $("lista");
    cont.replaceChildren();
    if (!visibles.length) {
      cont.appendChild(el("div", "empty-state", alertas.length ? "Ninguna alerta coincide con la búsqueda." : "Todavía no hay alertas. Cargá la primera con el formulario de arriba."));
      return;
    }
    visibles.forEach(function (a) { cont.appendChild(filaAlerta(a)); });
  }

  function dibujarEtiquetas() {
    var dl = $("etiquetas");
    dl.replaceChildren();
    var vistas = {};
    alertas.forEach(function (a) {
      var k = a.etiqueta.toLowerCase();
      if (vistas[k]) return;
      vistas[k] = true;
      var o = document.createElement("option");
      o.value = a.etiqueta;
      dl.appendChild(o);
    });
  }

  function dibujar() {
    dibujarStats();
    dibujarAtencion();
    dibujarLista();
    dibujarEtiquetas();
    dibujarCalendario();
  }

  // ------------------------------------------------------------------ calendario

  var hoyIso = aIso(hoy());
  var mesVisto = { y: hoy().getFullYear(), m: hoy().getMonth() };
  var diaElegido = hoyIso;
  var fmtMes = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" });
  var fmtDia = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  var DIAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];

  function mayuscula(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

  function inicioAviso(a) {
    return aIso(new Date(aFecha(a.vence).getTime() - a.aviso_dias * DIA));
  }

  function dibujarCalendario() {
    hoyIso = aIso(hoy());
    var grid = $("calGrid");
    grid.replaceChildren();
    $("calTitulo").textContent = mayuscula(fmtMes.format(new Date(mesVisto.y, mesVisto.m, 1)));

    DIAS_SEMANA.forEach(function (d) { grid.appendChild(el("div", "cal-dow", d)); });

    var primero = new Date(mesVisto.y, mesVisto.m, 1);
    var hueco = (primero.getDay() + 6) % 7; // semana desde el lunes
    for (var i = 0; i < hueco; i++) grid.appendChild(el("div", "cal-vacio"));

    var total = new Date(mesVisto.y, mesVisto.m + 1, 0).getDate();
    for (var dia = 1; dia <= total; dia++) {
      var iso = aIso(new Date(mesVisto.y, mesVisto.m, dia));
      var vencen = alertas.filter(function (a) { return a.vence === iso; });
      var avisan = alertas.filter(function (a) { return !a.completado && a.aviso_dias > 0 && inicioAviso(a) === iso; });

      var celda = el("button", "cal-dia");
      celda.type = "button";
      if (iso === hoyIso) celda.classList.add("cal-hoy");
      if (iso === diaElegido) celda.classList.add("cal-elegido");
      celda.appendChild(el("span", "cal-num", String(dia)));

      vencen.slice(0, 3).forEach(function (a) {
        celda.appendChild(el("span", "cal-chip cal-chip-" + estado(a), a.numero + " · " + a.etiqueta));
      });
      if (vencen.length > 3) celda.appendChild(el("span", "cal-mas", "+" + (vencen.length - 3) + " más"));
      if (avisan.length) celda.appendChild(el("i", "cal-aviso", ""));

      var resumen = formato(iso) + (vencen.length ? ": " + vencen.length + (vencen.length === 1 ? " vencimiento" : " vencimientos") : ": sin vencimientos");
      celda.setAttribute("aria-label", resumen);
      (function (isoDia) {
        celda.addEventListener("click", function () { diaElegido = isoDia; dibujarCalendario(); });
      })(iso);
      grid.appendChild(celda);
    }
    dibujarDia();
  }

  function dibujarDia() {
    var esHoy = diaElegido === hoyIso;
    var fecha = fmtDia.format(aFecha(diaElegido));
    $("diaTitulo").textContent = (esHoy ? "Hoy · " : "") + mayuscula(fecha);
    var vencen = alertas.filter(function (a) { return a.vence === diaElegido; });
    var avisan = alertas.filter(function (a) { return !a.completado && a.aviso_dias > 0 && a.vence !== diaElegido && inicioAviso(a) === diaElegido; });
    var pendientes = vencen.filter(function (a) { return !a.completado; }).length;
    $("diaIntro").textContent = vencen.length
      ? (esHoy && pendientes ? "Hoy vencen " + pendientes + (pendientes === 1 ? " suministro." : " suministros.") : "Suministros que vencen este día.")
      : "No vence ningún suministro este día.";

    var cont = $("diaLista");
    cont.replaceChildren();
    vencen.forEach(function (a) { cont.appendChild(filaAlerta(a)); });
    if (avisan.length) {
      var t = el("p", "cal-nota", "Este día empieza a avisar:");
      cont.appendChild(t);
      avisan.forEach(function (a) { cont.appendChild(filaAlerta(a)); });
    }
  }

  function moverMes(delta) {
    var d = new Date(mesVisto.y, mesVisto.m + delta, 1);
    mesVisto = { y: d.getFullYear(), m: d.getMonth() };
    dibujarCalendario();
  }

  $("calAnterior").addEventListener("click", function () { moverMes(-1); });
  $("calSiguiente").addEventListener("click", function () { moverMes(1); });
  $("calHoy").addEventListener("click", function () {
    mesVisto = { y: hoy().getFullYear(), m: hoy().getMonth() };
    diaElegido = aIso(hoy());
    dibujarCalendario();
  });

  // ------------------------------------------------------------------ pestañas

  function mostrarTab(nombre) {
    if (nombre !== "calendario") nombre = "alertas";
    ["alertas", "calendario"].forEach(function (t) {
      $("panel-" + t).hidden = t !== nombre;
      $("tab-" + t).setAttribute("aria-selected", t === nombre ? "true" : "false");
    });
    try { history.replaceState(null, "", nombre === "calendario" ? "#calendario" : location.pathname); } catch (e) { /* sin historial */ }
  }
  document.querySelectorAll(".tab").forEach(function (b) {
    b.addEventListener("click", function () { mostrarTab(b.getAttribute("data-tab")); });
  });
  mostrarTab(location.hash === "#calendario" ? "calendario" : "alertas");

  // ------------------------------------------------------------------ acciones

  function cambiar(id, datos) {
    return pedir("PATCH", "/api/alertas/" + id, datos).then(cargar).catch(function (e) { mostrarMensaje(e.message); });
  }

  function eliminar(a) {
    if (!window.confirm("¿Eliminar la alerta del suministro N° " + a.numero + " (" + a.etiqueta + ")?")) return;
    pedir("DELETE", "/api/alertas/" + a.id).then(function () {
      if (editandoId === a.id) salirDeEdicion();
      return cargar();
    }).catch(function (e) { mostrarMensaje(e.message); });
  }

  function editar(a) {
    editandoId = a.id;
    $("numero").value = a.numero;
    $("etiqueta").value = a.etiqueta;
    $("vence").value = a.vence;
    $("aviso").value = a.aviso_dias;
    $("formTitulo").textContent = "Editar alerta";
    $("guardar").textContent = "Guardar cambios";
    $("cancelar").hidden = false;
    $("form").scrollIntoView({ behavior: "smooth", block: "center" });
    $("numero").focus();
  }

  function salirDeEdicion() {
    editandoId = null;
    $("form").reset();
    $("aviso").value = 5;
    $("formTitulo").textContent = "Nueva alerta";
    $("guardar").textContent = "Agregar alerta";
    $("cancelar").hidden = true;
  }

  $("cancelar").addEventListener("click", salirDeEdicion);
  $("buscar").addEventListener("input", dibujarLista);

  $("form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var datos = {
      numero: $("numero").value.trim(),
      etiqueta: $("etiqueta").value.trim(),
      vence: $("vence").value,
      aviso_dias: $("aviso").value === "" ? 5 : Number($("aviso").value),
    };
    if (!datos.numero || !datos.etiqueta || !datos.vence) {
      mostrarMensaje("Completá el número, la etiqueta y la fecha de vencimiento.");
      return;
    }
    var boton = $("guardar");
    boton.disabled = true;
    var pedido = editandoId === null ? pedir("POST", "/api/alertas", datos) : pedir("PATCH", "/api/alertas/" + editandoId, datos);
    pedido.then(function () {
      mostrarMensaje(editandoId === null ? "Alerta agregada." : "Alerta actualizada.", "success");
      salirDeEdicion();
      return cargar();
    }).catch(function (e) { mostrarMensaje(e.message); })
      .then(function () { boton.disabled = false; });
  });

  // ------------------------------------------------------------------ avisos del navegador
  // Sólo funcionan con la página abierta. Se avisa una vez por día y por alerta.

  function soportaAvisos() { return "Notification" in window; }

  function guardado(clave) {
    try { return window.localStorage.getItem(clave); } catch (e) { return null; }
  }
  function guardar(clave, valor) {
    try { window.localStorage.setItem(clave, valor); } catch (e) { /* sin almacenamiento: avisa de nuevo la próxima vez */ }
  }

  function avisarNavegador() {
    if (!soportaAvisos()) return;
    $("activarAvisos").hidden = Notification.permission !== "default";
    if (Notification.permission !== "granted") return;
    var dia = aIso(hoy());
    alertas.forEach(function (a) {
      var e = estado(a);
      if (e !== "vencido" && e !== "por-vencer") return;
      var clave = "avisado:" + a.id + ":" + dia;
      if (guardado(clave)) return;
      guardar(clave, "1");
      new Notification("Suministro N° " + a.numero + " · " + a.etiqueta, {
        body: textoDias(diasHasta(a.vence)) + " (" + formato(a.vence) + ")",
        tag: "alerta-" + a.id,
      });
    });
  }

  $("activarAvisos").addEventListener("click", function () {
    Notification.requestPermission().then(avisarNavegador);
  });

  // ------------------------------------------------------------------ inicio

  cargar();
  // Con la página abierta: refresca cada 30 minutos (cambia el día, llegan nuevas alertas).
  setInterval(cargar, 30 * 60 * 1000);
})();
