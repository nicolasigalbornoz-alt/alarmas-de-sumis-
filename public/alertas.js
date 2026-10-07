'use strict';

/* ======================================================================
   ALERTAS DE RENOVACIÓN
   Misma lógica que la página Alertas del sitio de Suministros (script.js:
   AlertasRenovacion + AlertasPage), ahora como sitio aparte: cada legajo
   elige qué suministros seguir, con cuántos días de aviso y una etiqueta
   libre; el sistema calcula la cobertura (Mes de inicio + Meses de consumo)
   y avisa cuando se acerca el fin. El seguimiento ya no vive en el
   navegador: se guarda en la base (/api/seguimiento), así se ve igual desde
   cualquier PC y Suministros lo puede resumir en su Inicio.
   ====================================================================== */

const MES_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const AVISO_DIAS_DEFECTO = 30;
const SIN_ETIQUETA = 'Sin etiqueta';
const PREFIJOS = ['cal', 'seg'];

const NIVEL_INFO = {
    vencido: { texto: 'Vencido', claseCard: 'nivel-vencido', clasePill: 'badge badge-danger' },
    por_vencer: { texto: 'Por vencer', claseCard: 'nivel-por-vencer', clasePill: 'badge badge-warning' },
    vigente: { texto: 'Vigente', claseCard: '', clasePill: 'badge badge-muted' },
    completado: { texto: 'Completado', claseCard: 'nivel-completado', clasePill: 'badge badge-success' }
};

const estado = {
    sesion: null,
    anio: new Date().getFullYear(),
    suministros: new Map(), // numero -> suministro
    seguimiento: [],        // [{ numero, avisoDias, etiqueta, completado }]
    etiquetasDesactivadas: new Set(),
    seleccion: { cal: new Set(), seg: new Set() }
};

/* ---------------------------------------------------------------- API */

async function api(method, path, body) {
    const resp = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (resp.status === 401) {
        window.location.href = `/ingresar.html?volver=${encodeURIComponent(location.pathname)}`;
        throw new Error('Sesión vencida.');
    }
    const datos = await resp.json().catch(() => ({}));
    if (!resp.ok || datos.ok === false) throw new Error(datos.error || `El servidor respondió ${resp.status}.`);
    return datos;
}

async function cargarSeguimiento() {
    const r = await api('GET', '/api/seguimiento');
    estado.seguimiento = r.seguimiento.map((s) => ({
        numero: s.numero, avisoDias: s.aviso_dias, etiqueta: s.etiqueta || '', completado: Boolean(s.completado)
    }));
}

/* ---------------------------------------------------------------- utilidades */

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mesLabelCorto(year, month) {
    return `${MESES_CORTO[month - 1]}-${String(year).slice(-2)}`;
}

// 'AAAA-MM' + meses de consumo -> hasta qué mes cubre (inclusive) y la fecha
// de cierre (último día de ese mes). null si le falta alguno de los dos datos.
function cobertura(mesInicio, mesesConsumo) {
    const m = /^(\d{4})-(\d{2})$/.exec(mesInicio || '');
    const meses = Number(mesesConsumo);
    if (!m || !Number.isFinite(meses) || meses < 1) return null;
    const indiceInicio = Number(m[1]) * 12 + (Number(m[2]) - 1);
    const indiceFin = indiceInicio + (meses - 1);
    const anioFin = Math.floor(indiceFin / 12);
    const mesFin = (indiceFin % 12) + 1;
    return {
        anioInicio: Number(m[1]), mesInicio: Number(m[2]), anioFin, mesFin,
        fechaFin: new Date(anioFin, mesFin, 0)
    };
}

// vigente: falta más que el aviso. por_vencer: dentro de la ventana de
// aviso, todavía no venció. vencido: la cobertura ya terminó.
function estadoDe(fechaFin, avisoDias) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const fin = new Date(fechaFin);
    fin.setHours(0, 0, 0, 0);
    const diasRestantes = Math.round((fin - hoy) / 86400000);
    let nivel = 'vigente';
    if (diasRestantes < 0) nivel = 'vencido';
    else if (diasRestantes <= avisoDias) nivel = 'por_vencer';
    return { diasRestantes, nivel };
}

function fechaAlertaDe(fechaFin, avisoDias) {
    const fecha = new Date(fechaFin);
    fecha.setDate(fecha.getDate() - avisoDias);
    return fecha;
}

// "completado" pisa el estado por fecha: es una decisión manual (ya se
// renovó). Los completados van al final; entre el resto, el que vence antes.
function getWatchList() {
    return estado.seguimiento
        .map((entrada) => {
            const suministro = estado.suministros.get(entrada.numero);
            if (!suministro) return null;
            const cob = cobertura(suministro.mes_inicio, suministro.meses_consumo);
            if (!cob) return null;
            const { diasRestantes, nivel } = estadoDe(cob.fechaFin, entrada.avisoDias);
            return {
                ...entrada,
                suministro,
                cobertura: cob,
                diasRestantes,
                nivel: entrada.completado ? 'completado' : nivel,
                fechaAlerta: fechaAlertaDe(cob.fechaFin, entrada.avisoDias)
            };
        })
        .filter(Boolean)
        .sort((a, b) => (a.completado === b.completado ? a.diasRestantes - b.diasRestantes : a.completado ? 1 : -1));
}

const esArea = () => estado.sesion?.rol === 'area';
const detalleDe = (s) => (esArea() ? '' : s.secretaria || 'Sin Secretaría');
const etiquetaDe = (item) => item.etiqueta || SIN_ETIQUETA;

function mostrarAviso(texto) {
    const el = document.getElementById('aviso');
    el.textContent = texto;
    el.hidden = !texto;
}

/* ---------------------------------------------------------------- selector múltiple */

function getDisponibles() {
    const seguidos = new Set(estado.seguimiento.map((e) => e.numero));
    return [...estado.suministros.values()]
        .filter((s) => cobertura(s.mes_inicio, s.meses_consumo) && !seguidos.has(s.numero))
        .sort((a, b) => a.numero - b.numero);
}

function cerrarPaneles() {
    PREFIJOS.forEach((p) => {
        document.getElementById(`${p}MultiSelectPanel`).hidden = true;
        document.getElementById(`${p}MultiSelectTrigger`).setAttribute('aria-expanded', 'false');
    });
}

function actualizarTrigger(p) {
    const n = estado.seleccion[p].size;
    const trigger = document.getElementById(`${p}MultiSelectTrigger`);
    trigger.textContent = n === 0 ? 'Elegir suministros ▾' : `${n} suministro${n === 1 ? '' : 's'} elegido${n === 1 ? '' : 's'} ▾`;
}

function poblarSelector(p) {
    const opciones = document.getElementById(`${p}MultiSelectOptions`);
    const trigger = document.getElementById(`${p}MultiSelectTrigger`);
    const disponibles = getDisponibles();
    const numeros = new Set(disponibles.map((s) => s.numero));
    [...estado.seleccion[p]].forEach((n) => { if (!numeros.has(n)) estado.seleccion[p].delete(n); });

    if (disponibles.length === 0) {
        opciones.innerHTML = '<div class="empty-state">No hay suministros disponibles para seguir.</div>';
        trigger.disabled = true;
        actualizarTrigger(p);
        return;
    }
    trigger.disabled = false;
    opciones.innerHTML = disponibles.map((s) => {
        const detalle = detalleDe(s);
        const texto = `N° ${s.numero} — ${s.observaciones || 'Sin observaciones'}${detalle ? ` (${detalle})` : ''}`;
        const buscar = `${s.numero} ${s.observaciones || ''} ${s.dependencia || ''}`.toLowerCase();
        return `<label class="multi-select-option" data-buscar="${esc(buscar)}">
            <input type="checkbox" value="${s.numero}" ${estado.seleccion[p].has(s.numero) ? 'checked' : ''} />
            <span>${esc(texto)}</span>
        </label>`;
    }).join('');
    actualizarTrigger(p);
}

function initSelector(p) {
    const trigger = document.getElementById(`${p}MultiSelectTrigger`);
    const panel = document.getElementById(`${p}MultiSelectPanel`);
    const buscador = document.getElementById(`${p}MultiSelectSearch`);
    const opciones = document.getElementById(`${p}MultiSelectOptions`);

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const abierto = !panel.hidden;
        cerrarPaneles();
        if (!abierto) {
            panel.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
            buscador.value = '';
            filtrar(p, '');
            buscador.focus();
        }
    });
    buscador.addEventListener('input', () => filtrar(p, buscador.value));
    opciones.addEventListener('change', (e) => {
        const caja = e.target.closest('input[type="checkbox"]');
        if (!caja) return;
        const n = Number(caja.value);
        if (caja.checked) estado.seleccion[p].add(n); else estado.seleccion[p].delete(n);
        actualizarTrigger(p);
    });
    document.getElementById(`${p}MultiSelect`).addEventListener('click', (e) => e.stopPropagation());

    document.getElementById(`${p}AddForm`).addEventListener('submit', async (e) => {
        e.preventDefault();
        const numeros = [...estado.seleccion[p]];
        const etiquetaInput = document.getElementById(`${p}Etiqueta`);
        if (numeros.length === 0) {
            mensaje(p, 'Elija al menos un suministro para agregar al seguimiento.', true);
            return;
        }
        try {
            const r = await api('POST', '/api/seguimiento', {
                numeros,
                avisoDias: document.getElementById(`${p}AvisoDias`).value || AVISO_DIAS_DEFECTO,
                etiqueta: etiquetaInput.value
            });
            mensaje(p, r.agregados > 0
                ? `${r.agregados} suministro${r.agregados === 1 ? '' : 's'} agregado${r.agregados === 1 ? '' : 's'} al seguimiento.`
                : 'Esos suministros ya estaban en seguimiento.', r.agregados === 0);
            estado.seleccion[p].clear();
            etiquetaInput.value = '';
            await refrescar();
        } catch (error) {
            mensaje(p, error.message, true);
        }
    });

    poblarSelector(p);
}

function filtrar(p, texto) {
    const q = texto.trim().toLowerCase();
    document.querySelectorAll(`#${p}MultiSelectOptions .multi-select-option`).forEach((l) => {
        l.hidden = Boolean(q) && !(l.dataset.buscar || '').includes(q);
    });
}

function mensaje(p, texto, esError) {
    const el = document.getElementById(`${p}AddMessage`);
    el.textContent = texto;
    el.className = `alert ${esError ? 'alert-error' : 'alert-success'}`;
    el.hidden = false;
}

/* ---------------------------------------------------------------- render */

function render() {
    const completa = getWatchList();
    const filtrada = completa.filter((i) => !estado.etiquetasDesactivadas.has(etiquetaDe(i)));
    renderStats(completa);
    renderFiltroEtiquetas(completa);
    renderSugerencias(completa);
    renderLista(filtrada, completa.length > 0);
    renderCalendario(filtrada, completa.length > 0);
}

async function refrescar() {
    await cargarSeguimiento();
    PREFIJOS.forEach(poblarSelector);
    render();
}

function renderStats(lista) {
    const cards = [
        { label: 'Vencidos', n: lista.filter((i) => i.nivel === 'vencido').length, cls: 'stat-vencido' },
        { label: 'Por vencer', n: lista.filter((i) => i.nivel === 'por_vencer').length, cls: 'stat-por-vencer' },
        { label: 'Vigentes', n: lista.filter((i) => i.nivel === 'vigente').length, cls: '' },
        { label: 'Completados', n: lista.filter((i) => i.nivel === 'completado').length, cls: 'stat-completado' },
        { label: 'Total en seguimiento', n: lista.length, cls: 'stat-total' }
    ];
    document.getElementById('alertasStats').innerHTML = cards.map((c) => `
        <div class="stat ${c.cls}"><strong>${c.n}</strong><span>${c.label}</span></div>`).join('');
}

function renderSugerencias(lista) {
    const etiquetas = [...new Set(lista.map(etiquetaDe))].filter((e) => e !== SIN_ETIQUETA).sort((a, b) => a.localeCompare(b, 'es'));
    document.getElementById('etiquetasExistentes').innerHTML = etiquetas.map((e) => `<option value="${esc(e)}"></option>`).join('');
}

function renderFiltroEtiquetas(lista) {
    const wrap = document.getElementById('alertasFiltroEtiquetas');
    if (lista.length === 0) {
        wrap.innerHTML = '';
        return;
    }
    const conteo = new Map();
    lista.forEach((i) => conteo.set(etiquetaDe(i), (conteo.get(etiquetaDe(i)) || 0) + 1));
    const etiquetas = [...conteo.keys()].sort((a, b) => (a === SIN_ETIQUETA ? 1 : b === SIN_ETIQUETA ? -1 : a.localeCompare(b, 'es')));
    const aislada = etiquetas.find((e) => !estado.etiquetasDesactivadas.has(e)
        && etiquetas.every((x) => x === e || estado.etiquetasDesactivadas.has(x)));
    wrap.innerHTML = `
        <label class="vencimientos-banda filtro-etiqueta">
            <span>Filtrar por etiqueta</span>
            <select id="alertasFiltroEtiquetaSelect" class="form-control">
                <option value="">Mostrar todo (${lista.length})</option>
                ${etiquetas.map((e) => `<option value="${esc(e)}"${e === aislada ? ' selected' : ''}>${esc(e)} (${conteo.get(e)})</option>`).join('')}
            </select>
            <small>Afecta la lista y el calendario de abajo.</small>
        </label>`;
}

function textoDias(dias, nivel) {
    if (nivel === 'completado') return 'Marcado como resuelto';
    if (nivel === 'vencido') {
        const d = Math.abs(dias);
        return `Venció hace ${d} día${d === 1 ? '' : 's'}`;
    }
    if (dias === 0) return 'Vence hoy';
    return `Vence en ${dias} día${dias === 1 ? '' : 's'}`;
}

function renderLista(lista, hay) {
    const el = document.getElementById('alertasList');
    if (lista.length === 0) {
        el.innerHTML = `<div class="empty-state">${hay ? 'Ningún suministro en seguimiento coincide con la etiqueta elegida.' : 'Todavía no agregaste ningún suministro al seguimiento.'}</div>`;
        return;
    }
    el.innerHTML = lista.map((item) => {
        const info = NIVEL_INFO[item.nivel];
        const periodo = `${mesLabelCorto(item.cobertura.anioInicio, item.cobertura.mesInicio)} → ${mesLabelCorto(item.cobertura.anioFin, item.cobertura.mesFin)}`;
        const detalle = detalleDe(item.suministro);
        return `
            <article class="alerta ${info.claseCard}">
                <div class="alerta-info">
                    <strong>N° ${item.numero}${detalle ? ` — ${esc(detalle)}` : ''}</strong>
                    <p>${esc(item.suministro.observaciones || 'Sin observaciones')}</p>
                    <small>Cobertura ${periodo} · ${textoDias(item.diasRestantes, item.nivel)} · Día de alerta: ${item.fechaAlerta.toLocaleDateString('es-AR')}</small>
                    <label class="alerta-etiqueta">Etiqueta
                        <input type="text" class="form-control" maxlength="40" value="${esc(item.etiqueta)}" placeholder="Sin etiqueta" list="etiquetasExistentes" data-etiqueta="${item.numero}" aria-label="Etiqueta para N° ${item.numero}" />
                    </label>
                </div>
                <div class="alerta-acciones">
                    <span class="${info.clasePill}">${info.texto}</span>
                    <label class="alerta-aviso">Avisar con
                        <input type="number" class="form-control" min="1" max="365" value="${item.avisoDias}" data-aviso="${item.numero}" aria-label="Días de anticipación para N° ${item.numero}" /> días
                    </label>
                    <button type="button" class="btn ${item.completado ? 'btn-secondary' : 'btn-primary'} btn-sm" data-completar="${item.numero}" data-completado="${item.completado}">${item.completado ? 'Marcar como pendiente' : 'Marcar como completado'}</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-quitar="${item.numero}">Quitar</button>
                </div>
            </article>`;
    }).join('');
}

function renderCalendario(lista, hay) {
    const el = document.getElementById('alertasCalendario');
    if (lista.length === 0) {
        el.innerHTML = `<div class="empty-state">${hay ? 'Ningún suministro en seguimiento coincide con la etiqueta elegida.' : 'Agregá un suministro al seguimiento para verlo acá.'}</div>`;
        return;
    }
    const hoy = new Date();
    const idxHoy = hoy.getFullYear() * 12 + hoy.getMonth();
    el.innerHTML = lista.map((item) => {
        const ini = item.cobertura.anioInicio * 12 + (item.cobertura.mesInicio - 1);
        const fin = item.cobertura.anioFin * 12 + (item.cobertura.mesFin - 1);
        const celdas = MES_LABELS.map((label, i) => {
            const idx = estado.anio * 12 + i;
            const clase = ['celda', idx >= ini && idx <= fin ? `cubierto-${item.nivel}` : '', idx === idxHoy ? 'hoy' : ''].filter(Boolean).join(' ');
            return `<div class="${clase}" title="${label} ${estado.anio}${idx === idxHoy ? ' · hoy' : ''}">${label}</div>`;
        }).join('');
        return `<div class="calendario-fila">
            <div class="calendario-label">N° ${item.numero}${item.etiqueta ? ` · ${esc(item.etiqueta)}` : ''}</div>
            <div class="calendario-meses">${celdas}</div>
        </div>`;
    }).join('');
}

/* ---------------------------------------------------------------- eventos de la lista */

function bindLista() {
    const lista = document.getElementById('alertasList');
    lista.addEventListener('click', async (e) => {
        const quitar = e.target.closest('[data-quitar]');
        const completar = e.target.closest('[data-completar]');
        try {
            if (quitar) {
                await api('DELETE', `/api/seguimiento/${quitar.dataset.quitar}`);
                await refrescar();
            } else if (completar) {
                await api('PATCH', `/api/seguimiento/${completar.dataset.completar}`, { completado: completar.dataset.completado !== 'true' });
                await refrescar();
            }
        } catch (error) {
            mostrarAviso(error.message);
        }
    });
    lista.addEventListener('change', async (e) => {
        const aviso = e.target.closest('[data-aviso]');
        const etiqueta = e.target.closest('[data-etiqueta]');
        try {
            if (aviso) await api('PATCH', `/api/seguimiento/${aviso.dataset.aviso}`, { avisoDias: aviso.value });
            else if (etiqueta) await api('PATCH', `/api/seguimiento/${etiqueta.dataset.etiqueta}`, { etiqueta: etiqueta.value });
            else return;
            await refrescar();
        } catch (error) {
            mostrarAviso(error.message);
        }
    });
    document.getElementById('alertasFiltroEtiquetas').addEventListener('change', (e) => {
        if (e.target.id !== 'alertasFiltroEtiquetaSelect') return;
        const elegida = e.target.value;
        if (!elegida) estado.etiquetasDesactivadas.clear();
        else {
            const todas = [...new Set(getWatchList().map(etiquetaDe))];
            estado.etiquetasDesactivadas = new Set(todas.filter((x) => x !== elegida));
        }
        render();
    });
    document.addEventListener('click', cerrarPaneles);
}

/* ---------------------------------------------------------------- arranque */

function renderCuenta(sesion, suministrosUrl) {
    const cuenta = document.getElementById('cuenta');
    const volver = suministrosUrl
        ? `<a class="header-button" href="${esc(suministrosUrl)}/dashboard.html">Suministros<span aria-hidden="true">↗</span></a>`
        : '';
    cuenta.innerHTML = `
        <div><strong>${esc(sesion.area)}</strong><small>Legajo ${esc(sesion.usuario)}</small></div>
        ${volver}
        <form method="post" action="/api/auth/salir"><button class="header-button" type="submit">Salir<span aria-hidden="true">↗</span></button></form>`;
    if (suministrosUrl) {
        document.getElementById('pieLinks').insertAdjacentHTML('afterbegin', `<a href="${esc(suministrosUrl)}/dashboard.html">Sistema de Suministros</a>`);
    }
}

(async function iniciar() {
    try {
        const s = await api('GET', '/api/sesion');
        estado.sesion = s.usuario;
        estado.anio = s.anio;
        renderCuenta(s.usuario, s.suministrosUrl);
        document.getElementById('calendarioIntro').textContent = `Qué meses de ${s.anio} cubre cada suministro en seguimiento.`;

        const [sum] = await Promise.all([api('GET', '/api/suministros'), cargarSeguimiento()]);
        const cols = sum.cols;
        sum.rows.forEach((r) => {
            const s2 = Object.fromEntries(cols.map((c, i) => [c, r[i]]));
            estado.suministros.set(s2.numero, s2);
        });

        PREFIJOS.forEach(initSelector);
        bindLista();
        render();
    } catch (error) {
        mostrarAviso(`No se pudieron cargar los datos: ${error.message}`);
    }
})();
