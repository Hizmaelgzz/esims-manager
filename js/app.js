'use strict';

/* ============================================================
   eSIM Manager - Lógica principal de la aplicación
   ============================================================ */

// Configuración de campos y opciones
const COMPANIES = [
  'Telcel', 'IPB', 'Movistar', 'Dalefon', 'Pillofon', 'Diri', 'AT&T', 'BLACK'
];

const APP_OPTIONS = [
  'WhatsApp', 'Telegram', 'Uber', 'Didi', 'Amazon', 'Mercado Libre', 'Instagram',
  'Facebook', 'X (Twitter)', 'TikTok', 'YouTube', 'Google', 'Banking/Fintech',
  'Netflix', 'Spotify', 'Delivery apps', 'Otro'
];

// Apps que guardan un identificador/sesión de su cuenta (se muestra como label)
const SESSION_APPS = ['WhatsApp', 'Telegram'];

const TYPE_OPTIONS = [
  { value: 'SIM', label: 'SIM', icon: '📟' },
  { value: 'eSIM', label: 'eSIM', icon: '📱' }
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Activa', icon: '🟢', badgeColor: '#bbf7d0' },
  { value: 'inactive', label: 'Inactiva', icon: '⚪', badgeColor: '#e2e8f0' }
];

function typeDef(val) {
  return TYPE_OPTIONS.find((t) => t.value === val) || TYPE_OPTIONS[1];
}

let state = {
  sims: [],
  search: '',
  statusFilter: null,
  companyFilter: null,
  currentView: 'dashboard',
  currentSimId: null,
  editingId: null,
};

const $ = (sel) => document.querySelector(sel);

/* ============================================================
   Utilidades de estado / fecha
   ============================================================ */
function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysUntil(ts) {
  if (!ts) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(ts); target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

// Estado de una SIM (activa o inactiva)
function computeStatus(sim) {
  return sim.statusManual === 'inactive' ? 'inactive' : 'active';
}

function statusDef(val) {
  return STATUS_OPTIONS.find((s) => s.value === val) || STATUS_OPTIONS[0];
}

function sortSims(list) {
  const rank = { active: 0, inactive: 1 };
  return [...list].sort((a, b) => {
    const r = (rank[computeStatus(a)] ?? 9) - (rank[computeStatus(b)] ?? 9);
    return r !== 0 ? r : (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

/* ============================================================
   Inicialización
   ============================================================ */
async function init() {
  bindNav();
  bindGlobal();
  await load();
  render();
  registerSW();
}

async function load() {
  try {
    const sims = await DB.getAll();
    state.sims = sims.map((s) => ({ ...(defaultSim()), ...s }));
  } catch (e) {
    console.error('Error al cargar', e);
  }
}

function defaultSim() {
  return {
    id: null,
    name: '',
    type: 'eSIM',
    iccid: '',
    phone: '',
    company: '',
    plan: '',
    statusManual: 'active',
    statusOverridden: false,
    apps: [],
    notes: '',
    photo: '',
    photoThumb: '',
    color: '#3b82f6',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/* ============================================================
   Navegación
   ============================================================ */
function bindNav() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nav = btn.dataset.nav;
      if (!nav) return;
      showView(nav);
      closeMenu();
    });
  });
  $('#btnAddFab').addEventListener('click', () => openForm());
  $('#fabAdd').addEventListener('click', () => openForm());
  $('#btnMenu').addEventListener('click', () => {
    $('#slidingMenu').classList.toggle('open');
  });
  $('#modalBackdrop').addEventListener('click', closeModal);
  document.querySelectorAll('.menu-item').forEach((mi) => {
    mi.addEventListener('click', () => {
      closeMenu();
      const sheet = mi.dataset.sheet;
      if (sheet === 'stats') showStatsModal();
      if (sheet === 'sync') showSyncModal();
      if (sheet === 'export') showExportModal();
      if (sheet === 'settings') showSettingsModal();
    });
  });
}

function closeMenu() {
  $('#slidingMenu').classList.remove('open');
}

function showView(view) {
  state.currentView = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  $('#view-' + view).classList.remove('hidden');
  if (view === 'dashboard' || view === 'simlist') {
    const btn = document.querySelector(`.nav-btn[data-nav="${view}"]`);
    if (btn) btn.classList.add('active');
    if (view === 'dashboard') $('#fabAdd').classList.remove('hidden');
    else $('#fabAdd').classList.remove('hidden');
  } else {
    $('#fabAdd').classList.add('hidden');
  }
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindGlobal() {
  $('#searchInput').addEventListener('input', (e) => {
    state.search = e.target.value.toLowerCase().trim();
    render();
  });
  $('#btnSync').addEventListener('click', () => {
    const Sync = loadSyncModule();
    Sync && Sync.runManualSync();
  });
}

/* ============================================================
   Filtros
   ============================================================ */
function buildFilterChips() {
  const chips = $('#filterChips');
  chips.innerHTML = '';

  const statusChip = document.createElement('button');
  statusChip.className = 'chip' + (state.statusFilter ? ' active-chip' : '');
  statusChip.textContent = state.statusFilter ? statusDef(state.statusFilter).icon + ' ' + statusDef(state.statusFilter).label : '📊 Estado';
  statusChip.addEventListener('click', () => {
    const options = STATUS_OPTIONS.map((s) => ({ label: s.icon + ' ' + s.label, value: s.value }));
    openPicker('Filtrar por estado', options, (val) => {
      state.statusFilter = state.statusFilter === val ? null : val;
      render();
    }, true);
  });
  chips.appendChild(statusChip);

  const companyChip = document.createElement('button');
  companyChip.className = 'chip' + (state.companyFilter ? ' active-chip' : '');
  companyChip.textContent = state.companyFilter ? '🏢 ' + state.companyFilter : '🏢 Compañía';
  companyChip.addEventListener('click', () => {
    const options = [...new Set(state.sims.map((s) => s.company).filter(Boolean))].sort().map((c) => ({ label: c, value: c }));
    openPicker('Filtrar por compañía', options, (val) => {
      state.companyFilter = state.companyFilter === val ? null : val;
      render();
    }, true);
  });
  chips.appendChild(companyChip);

  if (state.statusFilter || state.companyFilter) {
    const clear = document.createElement('button');
    clear.className = 'chip clear-chip';
    clear.textContent = '✕ Limpiar';
    clear.addEventListener('click', () => {
      state.statusFilter = null;
      state.companyFilter = null;
      $('#searchInput').value = '';
      state.search = '';
      render();
    });
    chips.appendChild(clear);
  }
}

function filteredSims() {
  let list = state.sims;
  if (state.search) {
    list = list.filter((s) =>
      (s.name || '').toLowerCase().includes(state.search) ||
      (s.iccid || '').toLowerCase().includes(state.search) ||
      (s.phone || '').toLowerCase().includes(state.search) ||
      (s.company || '').toLowerCase().includes(state.search) ||
      (s.plan || '').toLowerCase().includes(state.search)
    );
  }
  if (state.statusFilter) {
    list = list.filter((s) => computeStatus(s) === state.statusFilter);
  }
  if (state.companyFilter) {
    list = list.filter((s) => s.company === state.companyFilter);
  }
  return sortSims(list);
}

/* ============================================================
   Renderizado principal
   ============================================================ */
function render() {
  buildFilterChips();
  renderStatsStrip();
  if (state.currentView === 'dashboard') renderDashboard();
  if (state.currentView === 'simlist') renderList();
  if (state.currentView === 'detail') renderDetail();
  if (state.currentView === 'form') { /* form rendered on open */ }
}

function renderStatsStrip() {
  const wrap = $('#statsStrip');
  const all = state.sims;
  const active = all.filter((s) => computeStatus(s) === 'active').length;
  const inactive = all.filter((s) => computeStatus(s) === 'inactive').length;
  const totalApps = new Set(all.flatMap((s) => normalizeApps(s.apps).map((a) => a.name))).size;
  wrap.innerHTML = `
    <div class="stat-card"><div class="stat-num">${all.length}</div><div class="stat-label">SIMs totales</div></div>
    <div class="stat-card"><div class="stat-num green">${active}</div><div class="stat-label">Activas</div></div>
    <div class="stat-card"><div class="stat-num gray">${inactive}</div><div class="stat-label">Inactivas</div></div>
    <div class="stat-card"><div class="stat-num blue">${totalApps}</div><div class="stat-label">Apps usadas</div></div>
  `;
}

function needAttention(list) {
  return list.filter((s) => computeStatus(s) === 'inactive');
}

function renderDashboard() {
  const content = $('#view-dashboard-content');
  const list = filteredSims();
  const attention = needAttention(state.sims).slice(0, 6);

  let html = '';

  if (attention.length) {
    html += `<div class="section-head"><h2>⚪ Inactivas</h2><button data-goto-list class="link-btn">Ver todo</button></div>
    <div class="attention-grid">`;
    attention.forEach((s) => {
      html += simCard(s);
    });
    html += `</div>`;
  }

  if (!attention.length) {
    html += `<div class="empty-note">🎉 Todas tus SIMs están activas.</div>`;
  }

  html += `<div class="section-head"><h2>Últimas SIMs</h2></div>`;

  if (!list.length) {
    html += `<div class="empty-state">
      <div class="empty-icon">📱</div>
      <h3>No tienes SIMs registradas</h3>
      <p>Toca el botón <b>＋</b> para agregar tu primera SIM y empezar a organizarlas.</p>
      <button class="btn primary" data-add>＋ Agregar SIM</button>
    </div>`;
  } else {
    html += `<div class="grid">`;
    list.slice(0, 8).forEach((s) => { html += simCard(s); });
    html += `</div>`;
    if (list.length > 8) {
      html += `<button data-goto-list class="btn outline full-width" style="margin-top:16px">Ver todas (${list.length})</button>`;
    }
  }

  content.innerHTML = html;

  content.querySelectorAll('[data-goto-list]').forEach((b) => b.addEventListener('click', () => showView('simlist')));
  content.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => openForm()));
  content.querySelectorAll('.sim-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-link-open]')) return;
      openDetail(card.dataset.id);
    });
  });
}

function renderList() {
  const content = $('#view-simlist');
  const list = filteredSims();
  let html = `<div class="list-head"><h2>Mis eSIMs (${list.length})</h2></div>`;

  if (!list.length) {
    html += `<div class="empty-state">
      <div class="empty-icon">📱</div>
      <h3>${state.sims.length ? 'Sin resultados' : 'No tienes eSIMs registradas'}</h3>
      <p>${state.sims.length ? 'Prueba con otra búsqueda o quita los filtros.' : 'Toca el botón ＋ para agregar tu primera eSIM.'}</p>
      ${state.sims.length ? '<button class="btn outline" data-clear-filters>Limpiar filtros</button>' : '<button class="btn primary" data-add>＋ Agregar eSIM</button>'}
    </div>`;
  } else {
    html += `<div class="grid">`;
    list.forEach((s) => { html += simCard(s); });
    html += `</div>`;
  }

  content.innerHTML = html;

  content.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => openForm()));
  content.querySelectorAll('[data-clear-filters]').forEach((b) => b.addEventListener('click', () => {
    state.statusFilter = null; state.companyFilter = null; state.search = ''; $('#searchInput').value=''; render();
  }));
  content.querySelectorAll('.sim-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-link-open]') || e.target.closest('.badge-inline')) return;
      openDetail(card.dataset.id);
    });
  });
}

function normalizeApps(apps) {
  return (apps || []).map((a) => {
    if (a && typeof a === 'object' && a.name != null) return { name: String(a.name), session: String(a.session || '') };
    return { name: String(a), session: '' };
  });
}

function renderAppTag(a) {
  let name = a, session = '';
  if (a && typeof a === 'object' && a.name != null) { name = a.name; session = String(a.session || '').trim(); }
  return session ? `<span class="app-tag">${esc(name)} <span class="app-session">${esc(session)}</span></span>` : `<span class="app-tag">${esc(name)}</span>`;
}

function sessionFieldHtml(ap) {
  const name = ap.name;
  return `<div class="app-session-field" data-session-for="${escAttr(name)}">
    <span class="field-label">✉️ ${esc(name)} — ID de sesión</span>
    <input type="text" class="app-session-input" data-session-name="${escAttr(name)}" value="${escAttr(ap.session || '')}" placeholder="Ej: alias o número de la sesión" />
  </div>`;
}

function simCard(s) {
  const st = computeStatus(s);
  const stD = statusDef(st);
  const apps = (s.apps || []).slice(0, 4);
  return `
    <div class="sim-card" data-id="${s.id}" style="--accent:${s.color || '#3b82f6'}">
      <div class="sim-card-top">
        <div class="sim-avatar" style="background:${s.color || '#3b82f6'}">${(s.name || '?').charAt(0).toUpperCase()}</div>
        <div class="sim-ident">
          <div class="sim-name">${esc(s.name || 'Sin nombre')}</div>
          <div class="sim-sub">${esc(s.company || 'Compañía')}</div>
        </div>
        <span class="badge" style="--bcolor:${stD.badgeColor}">${stD.icon} ${stD.label}</span>
      </div>
      <div class="sim-meta">
        <span>${typeDef(s.type).icon} ${esc(typeDef(s.type).label)}</span>
        ${s.phone ? `<span>📞 ${esc(s.phone)}</span>` : ''}
      </div>
      ${apps.length ? `<div class="sim-apps">${apps.map(a => renderAppTag(a)).join('')}${(s.apps||[]).length > 4 ? `<span class="app-tag more">+${(s.apps||[]).length-4}</span>` : ''}</div>` : ''}
    </div>`;
}

/* ============================================================
   Detalle
   ============================================================ */
function openDetail(id) {
  state.currentSimId = id;
  state.editingId = null;
  showView('detail');
}

function renderDetail() {
  const sim = state.sims.find((s) => s.id === state.currentSimId);
  const content = $('#view-detail');
  if (!sim) {
    content.innerHTML = `<div class="empty-state"><h3>No se encontró la eSIM</h3><button class="btn primary" data-back>Volver</button></div>`;
    content.querySelector('[data-back]').addEventListener('click', () => showView('dashboard'));
    return;
  }
  const st = computeStatus(sim);
  const stD = statusDef(st);

  let html = `
    <div class="detail-header" style="--accent:${sim.color}">
      <button class="back-btn" data-back>←</button>
      <div class="detail-title">
        <div class="detail-avatar" style="background:${sim.color}">${(sim.name||'?').charAt(0).toUpperCase()}</div>
        <div>
          <h2>${esc(sim.name || 'Sin nombre')}</h2>
          <span class="badge" style="--bcolor:${stD.badgeColor}">${stD.icon} ${stD.label}</span>
        </div>
      </div>
      <div class="detail-actions">
        <button class="icon-btn" data-edit title="Editar">✏️</button>
        <button class="icon-btn" data-del title="Eliminar">🗑️</button>
      </div>
    </div>

    <div class="detail-body">
      <div class="info-grid">
        ${infoItem('Número de teléfono', sim.phone || '—')}
        ${infoItem('Tipo', `${typeDef(sim.type).icon} ${esc(typeDef(sim.type).label)}`)}
        ${infoItem('ICCID', sim.iccid || '—', true)}
        ${infoItem('Compañía', sim.company || '—')}
        ${infoItem('Plan', sim.plan || '—')}
        ${infoItem('Estado', stD.icon + ' ' + stD.label)}
      </div>

      ${(sim.apps || []).length ? `
      <div class="detail-section">
        <h3>📲 Apps activas</h3>
        <div class="detail-apps">${sim.apps.map(a => renderAppTag(a)).join('')}</div>
      </div>` : ''}

      ${sim.notes ? `
      <div class="detail-section">
        <h3>📝 Notas</h3>
        <p class="notes-text" style="white-space:pre-wrap">${esc(sim.notes)}</p>
      </div>` : ''}

      ${(sim.photo || sim.photoThumb) ? `<div class="detail-photo"><img id="detailPhoto" src="${sim.photoThumb || sim.photo}" data-full="${escAttr(sim.photo || '')}" alt="Foto de la SIM" /></div>` : ''}

      <div class="detail-actions-bottom">
        <button class="btn primary" data-edit2>✏️ Editar eSIM</button>
        <button class="btn danger-ghost" data-del2>Eliminar</button>
      </div>
    </div>
  `;
  content.innerHTML = html;

  content.querySelector('[data-back]').addEventListener('click', () => goBack());
  content.querySelectorAll('[data-edit],[data-edit2]').forEach((b) => b.addEventListener('click', () => openForm(sim.id)));
  content.querySelectorAll('[data-del],[data-del2]').forEach((b) => b.addEventListener('click', () => confirmDelete(sim)));
  content.querySelector('[data-link-open]')  && null;

  // Mostrar miniatura local al instante; cargar la foto completa desde el enlace si hay internet
  const detailPhoto = content.querySelector('#detailPhoto');
  if (detailPhoto && detailPhoto.dataset.full) {
    detailPhoto.addEventListener('click', () => {
      if (detailPhoto.dataset.full) window.open(detailPhoto.dataset.full, '_blank', 'noopener');
    });
    const full = new Image();
    full.onload = () => { detailPhoto.src = full.src; };
    full.onerror = () => { /* sin internet: se mantiene la miniatura */ };
    full.src = detailPhoto.dataset.full;
  }
}

function infoItem(label, value, isCode = false, isHtml = false) {
  return `<div class="info-item"><div class="info-label">${label}</div><div class="info-value">${isHtml ? value : (isCode ? `<code>${esc(value)}</code>` : esc(value))}</div></div>`;
}

function goBack() {
  // Volver a la vista desde la que veníamos
  if (['dashboard', 'simlist'].includes(state.lastView)) showView(state.lastView);
  else showView('simlist');
}

function confirmDelete(sim) {
  openModal({
    title: 'Eliminar eSIM',
    body: `¿Seguro que quieres eliminar <b>${esc(sim.name || 'esta eSIM')}</b>? Esta acción no se puede deshacer.`,
    actions: [
      { label: 'Cancelar', class: 'btn ghost', onClick: closeModal },
      { label: 'Eliminar', class: 'btn danger', onClick: async () => {
        await DB.delete(sim.id);
        state.sims = state.sims.filter((x) => x.id !== sim.id);
        closeModal();
        toast('eSIM eliminada 🗑️');
        showView('simlist');
        autoSync();
      }}
    ]
  });
}

/* ============================================================
   Formulario crear/editar
   ============================================================ */
function openForm(id = null) {
  state.editingId = id;
  showView('form');
  renderForm(id);
}

function renderForm(id) {
  const sim = id ? { ...defaultSim(), ...state.sims.find((s) => s.id === id) } : defaultSim();
  const content = $('#view-form');
  const selectedApps = new Map(); const getApp = (name) => selectedApps.get(name) || { name, session: '' };
  normalizeApps(sim.apps).forEach((a) => selectedApps.set(a.name, a));

  let html = `
    <div class="form-header">
      <button class="back-btn" data-cancel>←</button>
      <h2>${id ? '✏️ Editar eSIM' : '＋ Nueva eSIM'}</h2>
    </div>
    <form id="simForm" class="form-body">
      <div class="color-row">
        ${['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#6366f1','#a855f7','#ec4899','#64748b'].map(c =>
          `<div class="color-dot ${sim.color===c?'selected':''}" data-color="${c}" style="background:${c}"></div>`).join('')}
      </div>

      <div class="field">
        <span class="field-label">Foto del chip (opcional)</span>
        <div class="photo-picker">
          <div id="photoWrap">
            ${sim.photoThumb ? `<img id="photoPreview" class="photo-preview" src="${sim.photoThumb}" alt="Foto de la SIM" />` : `<div id="photoPreview" class="photo-preview photo-empty">📷</div>`}
          </div>
          <input type="text" id="photoUrl" class="custom-app" placeholder="Pega el enlace de Google Drive de la foto" value="${escAttr(sim.photo || '')}" />
          <div class="photo-actions">
            <button type="button" class="btn outline" data-photo-url>🔗 Usar enlace</button>
            <button type="button" class="btn outline" data-thumb-upload>🖼️ Mini foto local</button>
            ${(sim.photo || sim.photoThumb) ? `<button type="button" class="btn danger-ghost" data-photo-remove>🗑️ Quitar</button>` : ''}
          </div>
          <input type="file" id="thumbInput" accept="image/*" class="hidden" />
          <p class="hint">Pega el enlace de Drive y toca "Usar enlace" para la foto completa. La "Mini foto local" se ve sin internet.</p>
        </div>
      </div>

      <label class="field">
        <span>Nombre / Etiqueta *</span>
        <input name="name" required value="${escAttr(sim.name || '')}" placeholder="Ej: SIM Bolivia" />
      </label>

      <label class="field">
        <span>ICCID *</span>
        <input name="iccid" required value="${escAttr(sim.iccid || '')}" placeholder="8930 1234 5678 9012 34" />
      </label>

      <label class="field">
        <span>Número de teléfono *</span>
        <input name="phone" required inputmode="tel" value="${escAttr(sim.phone || '')}" placeholder="+52 71234567" />
      </label>

      <div class="field">
        <span class="field-label">Tipo *</span>
        <div class="status-picker">
          ${TYPE_OPTIONS.map(t => `<button type="button" class="status-opt ${sim.type===t.value?'selected':''}" data-type="${t.value}">${t.icon} ${t.label}</button>`).join('')}
        </div>
      </div>

      <div class="field-row">
        <label class="field">
          <span>Compañía</span>
          <select name="company">${COMPANIES.map(c => `<option ${sim.company===c?'selected':''}>${c}</option>`).join('')}<option value="">Personalizada…</option></select>
        </label>
        <label class="field">
          <span>Otro proveedor</span>
          <input id="customCompany" value="${!COMPANIES.includes(sim.company) && sim.company ? escAttr(sim.company) : ''}" placeholder="Nombre" />
        </label>
      </div>

      <label class="field">
        <span>Plan</span>
        <input name="plan" value="${escAttr(sim.plan || '')}" placeholder="Ej: Prepago 20GB" />
      </label>

      <div class="field">
        <span class="field-label">Estado</span>
        <div class="status-picker">
          ${STATUS_OPTIONS.map(so => `<button type="button" class="status-opt ${sim.statusManual===so.value?'selected':''}" data-status="${so.value}">${so.icon} ${so.label}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <span class="field-label">Aplicaciones donde está registrada</span>
        <div class="app-chip-list">
          ${APP_OPTIONS.map(a => `<button type="button" class="app-chip ${selectedApps.has(a)?'selected':''}" data-app="${escAttr(a)}">${a}</button>`).join('')}
        </div>
        <div class="app-session-fields" id="appSessionFields">
          ${[...selectedApps.values()].filter((ap) => SESSION_APPS.includes(ap.name)).map((ap) => sessionFieldHtml(ap)).join('')}
        </div>
        <input id="customApp" class="custom-app" placeholder="Escribe otra app y pulsa →" style="margin-top:8px" />
      </div>

      <label class="field">
        <span>Notas</span>
        <textarea name="notes" rows="3" placeholder="Observaciones, operador virtual, restricciones…">${esc(sim.notes || '')}</textarea>
      </label>

      <div class="form-actions">
        <button type="button" class="btn ghost" data-cancel>Cancelar</button>
        <button type="submit" class="btn primary">💾 Guardar</button>
      </div>
    </form>
  `;
  content.innerHTML = html;

  // color
  content.querySelectorAll('.color-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      content.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('selected'));
      dot.classList.add('selected');
    });
  });

  // Foto: enlace de Google Drive (completa) + miniatura local comprimida
  let photoUrl = sim.photo || '';
  let photoThumb = sim.photoThumb || '';

  function toDirectImageUrl(u) {
    const url = String(u || '').trim();
    if (!url) return '';
    let m = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
    if (m) return 'https://drive.google.com/uc?export=view&id=' + m[1];
    m = url.match(/(?:drive\.google\.com\/open\?id=|docs\.google\.com\/uc\?id=|uc\?id=)([A-Za-z0-9_-]+)/);
    if (m) return 'https://drive.google.com/uc?export=view&id=' + m[1];
    if (/^https?:\/\//i.test(url)) return url;
    return '';
  }

  function showPreview(src) {
    let prev = content.querySelector('#photoPreview');
    if (!prev) {
      prev = document.createElement('img');
      prev.id = 'photoPreview';
      prev.className = 'photo-preview';
      content.querySelector('#photoWrap').appendChild(prev);
    }
    prev.src = src;
    prev.classList.remove('photo-empty');
  }

  function setPhotoUrl() {
    const direct = toDirectImageUrl(content.querySelector('#photoUrl').value);
    if (!direct) { toast('⚠️ Enlace no válido de Drive'); return; }
    photoUrl = direct;
    content.querySelector('#photoUrl').value = direct;
    if (!photoThumb) showPreview(direct);
    addRemoveButton();
    toast('🔗 Enlace de foto guardado');
  }

  function compressThumb(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const MAX = 600;
          let { width, height } = img;
          if (width > height && width > MAX) { height = Math.round(height * MAX / width); width = MAX; }
          else if (height > MAX) { width = Math.round(width * MAX / height); height = MAX; }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.onerror = () => resolve('');
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function addRemoveButton() {
    const fb = content.querySelector('.photo-actions');
    if (content.querySelector('[data-photo-remove]')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn danger-ghost';
    b.textContent = '🗑️ Quitar';
    b.dataset.photoRemove = '';
    b.addEventListener('click', () => removePhoto());
    fb.appendChild(b);
  }

  function setThumb(dataUrl) {
    photoThumb = dataUrl;
    showPreview(dataUrl);
    addRemoveButton();
    toast('🖼️ Mini foto guardada');
  }

  function removePhoto() {
    photoUrl = '';
    photoThumb = '';
    const urlIn = content.querySelector('#photoUrl'); if (urlIn) urlIn.value = '';
    const prev = content.querySelector('#photoPreview'); if (prev) prev.remove();
    const wrap = content.querySelector('#photoWrap');
    const ph = document.createElement('div');
    ph.id = 'photoPreview';
    ph.className = 'photo-preview photo-empty';
    ph.textContent = '📷';
    if (wrap) wrap.appendChild(ph);
    const rm = content.querySelector('[data-photo-remove]'); if (rm) rm.remove();
  }

  content.querySelector('[data-photo-url]').addEventListener('click', () => setPhotoUrl());

  const thumbInput = content.querySelector('#thumbInput');
  thumbInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    thumbInput.value = '';
    if (!file) return;
    const dataUrl = await compressThumb(file);
    if (dataUrl) setThumb(dataUrl);
  });
  content.querySelector('[data-thumb-upload]').addEventListener('click', () => thumbInput.click());
  content.querySelectorAll('[data-photo-remove]').forEach((b) => b.addEventListener('click', () => removePhoto()));

  const sessionFieldsEl = content.querySelector('#appSessionFields');

  function removeSessionField(name) {
    const f = content.querySelector('.app-session-field[data-session-for="' + CSS.escape(name) + '"]');
    if (f) f.remove();
  }
  function addSessionField(ap) {
    if (!SESSION_APPS.includes(ap.name)) return;
    if (content.querySelector('.app-session-field[data-session-for="' + CSS.escape(ap.name) + '"]')) return;
    sessionFieldsEl.insertAdjacentHTML('beforeend', sessionFieldHtml(ap));
  }

  const customApp = $('#customApp');
  customApp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = customApp.value.trim();
      if (v && !selectedApps.has(v)) {
        selectedApps.set(v, getApp(v));
        addAppChip(v);
        customApp.value = '';
      }
    }
  });

  function addAppChip(name) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'app-chip selected';
    chip.textContent = name;
    chip.dataset.app = name;
    chip.addEventListener('click', () => {
      selectedApps.delete(name);
      removeSessionField(name);
      chip.remove();
    });
    content.querySelector('.app-chip-list').appendChild(chip);
    addSessionField(getApp(name));
  }

  // toggles de apps (las del listado)
  content.querySelectorAll('.app-chip[data-app]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const name = chip.dataset.app;
      if (selectedApps.has(name)) { selectedApps.delete(name); removeSessionField(name); chip.classList.remove('selected'); }
      else { selectedApps.set(name, { name, session: '' }); addSessionField({ name, session: '' }); chip.classList.add('selected'); }
    });
  });

  // tipo (SIM / eSIM)
  content.querySelectorAll('.status-opt[data-type]').forEach((btn) => {
    btn.addEventListener('click', () => {
      content.querySelectorAll('.status-opt[data-type]').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // estado (activa / inactiva)
  content.querySelectorAll('.status-opt[data-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      content.querySelectorAll('.status-opt[data-status]').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  content.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => goBackAfterForm()));

  $('#simForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const selectedStatus = content.querySelector('.status-opt[data-status].selected');
    const statusValue = selectedStatus ? selectedStatus.dataset.status : 'active';
    const selectedType = content.querySelector('.status-opt[data-type].selected');
    const typeValue = selectedType ? selectedType.dataset.type : 'eSIM';

    const customCompany = content.querySelector('#customCompany').value.trim();
    const company = f.company.value || customCompany;

    // Recoger apps como objetos {name, session}; leer el ID de sesión de los inputs
    const appList = [...selectedApps.values()].map((ap) => {
      const inp = content.querySelector('.app-session-input[data-session-name="' + CSS.escape(ap.name) + '"]');
      return { name: ap.name, session: inp ? inp.value.trim() : (ap.session || '') };
    });

    const data = {
      ...defaultSim(),
      ...sim,
      name: f.name.value.trim(),
      type: typeValue,
      iccid: f.iccid.value.trim(),
      phone: f.phone.value.trim(),
      company,
      plan: f.plan.value.trim(),
      notes: f.notes.value.trim(),
      apps: appList,
      photo: photoUrl,
      photoThumb,
      statusOverridden: true,
      statusManual: statusValue,
      color: (content.querySelector('.color-dot.selected') || {}).dataset?.color || sim.color || '#3b82f6',
    };

    const saved = await DB.put(data);
    const idx = state.sims.findIndex((x) => x.id === saved.id);
    if (idx >= 0) state.sims[idx] = saved; else state.sims.push(saved);
    toast('SIM guardada ✅');
    goBackAfterForm();
    autoSync();
  });
}

function goBackAfterForm() {
  state.editingId = null;
  goBack();
}

function isoDate(ts) {
  const d = new Date(ts);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

/* ============================================================
   Modales (picker / confirmación / sheets)
   ============================================================ */
function openModal({ title, body, actions }) {
  const modal = $('#modal');
  modal.innerHTML = `
    <div class="modal-content">
      <h3>${title}</h3>
      <div class="modal-body">${body}</div>
      <div class="modal-actions">${actions.map(a => `<button class="${a.class || 'btn'}">${a.label}</button>`).join('')}</div>
    </div>
  `;
  modal.querySelectorAll('.modal-actions button').forEach((btn, i) => {
    btn.addEventListener('click', actions[i].onClick);
  });
  modal.classList.remove('hidden');
  $('#modalBackdrop').classList.remove('hidden');
}

function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modalBackdrop').classList.add('hidden');
}

function openPicker(title, options, onSelect, allowNone = false) {
  let html = `<div class="picker-list">`;
  if (allowNone) html += `<button class="picker-item" data-val="">✕ Sin filtro</button>`;
  options.forEach((o) => {
    html += `<button class="picker-item" data-val="${escAttr(o.value)}">${o.label}</button>`;
  });
  html += `</div>`;
  openModal({ title, body: html, actions: [{ label: 'Cancelar', class: 'btn ghost', onClick: closeModal }] });
  $('#modal').querySelectorAll('.picker-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.val;
      onSelect(val === '' ? null : val);
      closeModal();
    });
  });
}

/* Sheets */
function showStatsModal() {
  const all = state.sims;
  const appCounts = {};
  all.forEach((s) => normalizeApps(s.apps).forEach((a) => { appCounts[a.name] = (appCounts[a.name] || 0) + 1; }));
  const topApps = Object.entries(appCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const byCompany = {};
  all.forEach((s) => { const c = s.company || 'Sin compañía'; byCompany[c] = (byCompany[c] || 0) + 1; });

  let html = `<div class="stats-block">
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-num">${all.length}</div><div class="stat-label">Totales</div></div>
      <div class="stat-card"><div class="stat-num green">${all.filter(s=>computeStatus(s)==='active').length}</div><div class="stat-label">Activas</div></div>
      <div class="stat-card"><div class="stat-num gray">${needAttention(all).length}</div><div class="stat-label">Inactivas</div></div>
    </div>
    <h4>Apps más usadas</h4>
    ${topApps.length ? topApps.map(([a, n]) => `<div class="bar-row"><span>${esc(a)}</span><div class="bar"><div class="bar-fill" style="width:${(n/Math.max(...topApps.map(t=>t[1]))*100)}%"></div></div><b>${n}</b></div>`).join('') : '<p class="muted">Sin datos.</p>'}
    <h4>Por compañía</h4>
    ${Object.entries(byCompany).map(([c, n]) => `<div class="row-line"><span>${esc(c)}</span><b>${n}</b></div>`).join('') || '<p class="muted">Sin datos.</p>'}
  </div>`;
  openModal({ title: '📊 Resumen', body: html, actions: [{ label: 'Cerrar', class: 'btn primary', onClick: closeModal }] });
}

function showExportModal() {
  let html = `<div class="settings-block">
    <div class="setting-row">
      <div><b>Exportar a JSON</b><p class="muted">Descarga un archivo con todos los datos.</p></div>
      <button class="btn outline" id="btnExportJson">Exportar</button>
    </div>
    <div class="setting-row">
      <div><b>Importar JSON</b><p class="muted">Restaura datos desde un respaldo (fusiona/fusiona).</p></div>
      <button class="btn outline" id="btnImportJson">Importar</button>
    </div>
    <div class="setting-row">
      <div><b>Importación masiva (CSV + fotos)</b><p class="muted">Carga muchos chips desde tu archivo CSV y carpeta de fotos.</p></div>
      <button class="btn outline" id="btnBulkImport">Importar</button>
    </div>
    <div class="setting-row">
      <div><b>Borrar todo</b><p class="muted">Elimina todas las eSIMs del dispositivo.</p></div>
      <button class="btn danger-ghost" id="btnWipe">Borrar</button>
    </div>
    <input type="file" id="importFile" accept="application/json" class="hidden" />
  </div>`;
  openModal({ title: '📤 Respaldo', body: html, actions: [{ label: 'Cerrar', class: 'btn ghost', onClick: closeModal }] });

  $('#btnExportJson').addEventListener('click', () => {
    const incompletas = state.sims.filter((s) => !s.iccid || !s.phone);
    if (incompletas.length) {
      toast(`⚠️ Hay ${incompletas.length} SIM(s) sin ICCID o número. Complétalas para exportar.`);
      return;
    }
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), sims: state.sims }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sims-' + todayISO() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('Respaldo descargado 📥');
  });

  $('#btnImportJson').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      const raw = data.sims || [];
      // Filtrar las que no tienen ICCID y número (campos obligatorios)
      const validos = [];
      const rechazados = [];
      raw.forEach((s) => {
        if (s.iccid && s.phone) validos.push({ ...defaultSim(), ...s });
        else rechazados.push(s);
      });
      if (validos.length) {
        const existing = await DB.getAll();
        const { toPut, added, updated } = mergeIncoming(existing, validos);
        await DB.bulkPut(toPut);
        await load();
        render();
        closeModal();
        const msg = `Importados ${validos.length} (${added} nuevos, ${updated} actualizados por ICCID/número)`;
        toast(rechazados.length ? `${msg}. Omitidos ${rechazados.length} sin ICCID/número ⚠️` : msg + ' 📥');
        autoSync();
      } else {
        toast('⚠️ Ninguna fila válida (faltan ICCID o número)');
      }
    } catch (err) {
      toast('Archivo inválido ⚠️');
    }
  });

  // ---- Importación masiva (CSV + carpeta de fotos) ----
  $('#btnBulkImport').addEventListener('click', () => {
    openModal({
      title: '📦 Importación masiva',
      body: `<div class="settings-block">
        <p class="muted" style="margin-top:0">Selecciona en orden:</p>
        <ol style="margin:8px 0 0 20px;padding:0;line-height:1.8">
          <li><b>Archivo CSV</b> con tus chips (id, teléfono, estado, ICCID, archivo).</li>
          <li><b>Carpeta de fotos</b> — elige la carpeta donde están las imágenes (los nombres deben coincidir con la columna "Archivo").</li>
          <li><small>Opcional</small> — un <b>JSON de enlaces</b> (archivo → URL de Drive) para guardar la foto completa.</li>
        </ol>
        <div class="form-actions">
          <button class="btn" id="biPickCsv">1️⃣ Elegir CSV</button>
          <span id="biCsvName" class="muted"></span>
        </div>
        <div class="form-actions">
          <button class="btn" id="biPickFolder">2️⃣ Elegir carpeta de fotos</button>
          <span id="biFolderCount" class="muted"></span>
        </div>
        <div class="form-actions">
          <button class="btn outline" id="biPickMap">➕ JSON de enlaces (opcional)</button>
          <span id="biMapName" class="muted"></span>
        </div>
        <button class="btn primary" id="biRun" style="width:100%;margin-top:6px">🚀 Importar</button>
        <input type="file" id="cosmosCsv" accept=".csv,text/csv" class="hidden" />
        <input type="file" id="cosmosFolder" webkitdirectory multiple class="hidden" />
        <input type="file" id="cosmosDriveMap" accept=".json,application/json" class="hidden" />
        <div id="biProgress" style="display:none;margin-top:12px">
          <div class="bar-row"><span>Progreso</span><div class="bar" style="flex:3;height:10px"><div id="biBar" class="bar-fill" style="width:0%"></div></div><b id="biPct">0%</b></div>
          <p id="biStatus" class="muted" style="margin:6px 0 0;font-size:.8rem;word-break:break-word"></p>
        </div>
      </div>`,
      actions: [{ label: 'Cerrar', class: 'btn ghost', onClick: closeModal }],
    });

    let csvFile = null, folderFiles = [], mapObj = {};
    const $M = (s) => $('#modal').querySelector(s);

    $('#biPickCsv').addEventListener('click', () => $('#cosmosCsv').click());
    $('#cosmosCsv').addEventListener('change', (e) => {
      csvFile = e.target.files[0] || null;
      $M('#biCsvName').textContent = csvFile ? '✅ ' + csvFile.name : '';
    });
    $('#biPickFolder').addEventListener('click', () => $('#cosmosFolder').click());
    $('#cosmosFolder').addEventListener('change', (e) => {
      folderFiles = Array.from(e.target.files || []);
      $M('#biFolderCount').textContent = '✅ ' + folderFiles.length + ' archivo(s)';
    });
    $('#biPickMap').addEventListener('click', () => $('#cosmosDriveMap').click());
    $('#cosmosDriveMap').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { mapObj = JSON.parse(await f.text()); $M('#biMapName').textContent = '✅ ' + f.name; }
      catch (err) { toast('⚠️ JSON de enlaces inválido'); mapObj = {}; }
    });
    $('#biRun').addEventListener('click', () => {
      const block = $M('#biProgress'), bar = $M('#biBar'), pct = $M('#biPct'), status = $M('#biStatus');
      block.style.display = '';
      const setProg = (p, txt) => { bar.style.width = p + '%'; pct.textContent = p + '%'; status.textContent = txt; };
      importBulk(csvFile, folderFiles, mapObj, (info) => {
        if (info.save) { setProg(100, '💾 Guardando en el dispositivo…'); return; }
        if (info.done) { setProg(100, `✅ ${info.total} chips (${info.added} nuevos, ${info.updated} actualizados)`); return; }
        if (info.total) { const p = Math.round(info.done / info.total * 100); setProg(p, `🖼️ Procesando foto ${info.done}/${info.total}…`); }
      }).catch((err) => { setProg(100, '❌ Error: ' + ((err && err.message) || err)); });
    });
  });

  $('#btnWipe').addEventListener('click', () => {
    openModal({
      title: 'Borrar todo',
      body: 'Se eliminarán <b>todas</b> las eSIMs del dispositivo. Esta acción no se puede deshacer.',
      actions: [
        { label: 'Cancelar', class: 'btn ghost', onClick: closeModal },
        { label: 'Borrar todo', class: 'btn danger', onClick: async () => {
          await DB.clear();
          state.sims = [];
          closeModal();
          toast('Datos borrados');
          showView('dashboard');
        }}
      ]
    });
  });
}

function fileToThumb(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 600;
        let { width, height } = img;
        if (width > height && width > MAX) { height = Math.round(height * MAX / width); width = MAX; }
        else if (height > MAX) { width = Math.round(width * MAX / height); height = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = () => resolve('');
      img.src = e.target.result;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

// Combina una lista de SIMs entrantes con las existentes: si ya existe una con el
// mismo ICCID o el mismo número, la actualiza en lugar de duplicarla.
function mergeIncoming(existingList, incomingList) {
  const byIccid = new Map();
  const byPhone = new Map();
  const reg = (x) => {
    if (x.iccid != null && x.iccid !== '') byIccid.set(String(x.iccid).trim(), x);
    if (x.phone != null && x.phone !== '') byPhone.set(String(x.phone).trim(), x);
  };
  existingList.forEach(reg);
  const result = [];
  let added = 0, updated = 0;
  for (const inc of incomingList) {
    let target = null;
    const kI = (inc.iccid != null && inc.iccid !== '') ? String(inc.iccid).trim() : null;
    const kP = (inc.phone != null && inc.phone !== '') ? String(inc.phone).trim() : null;
    if (kI && byIccid.has(kI)) target = byIccid.get(kI);
    if (!target && kP && byPhone.has(kP)) target = byPhone.get(kP);
    if (target) {
      const merged = { ...target, ...inc, id: target.id, createdAt: target.createdAt, updatedAt: Date.now() };
      const idx = result.indexOf(target);
      if (idx >= 0) result[idx] = merged; else result.push(merged);
      if (target.iccid != null) byIccid.set(String(target.iccid).trim(), merged);
      if (target.phone != null) byPhone.set(String(target.phone).trim(), merged);
      updated++;
    } else {
      const n = { ...inc };
      if (!n.id) n.id = 'sim_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      result.push(n);
      reg(n);
      added++;
    }
  }
  return { toPut: result, added, updated };
}

async function importBulk(csvFile, folderFiles, mapObj, onProgress) {
  if (!csvFile) { toast('⚠️ Primero elige el archivo CSV'); return; }
  let text;
  try { text = await csvFile.text(); } catch (e) { toast('⚠️ No se pudo leer el CSV'); return; }
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  let hdrIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const lower = rows[i].toLowerCase();
    if (lower.includes('telefono') && lower.includes('iccid')) { hdrIdx = i; break; }
  }
  if (hdrIdx < 0) { toast('⚠️ No encontré las columnas Telefono/ICCID en el CSV'); return; }

  const byName = {};
  (folderFiles || []).forEach((f) => { byName[f.name] = f; });
  const driveMap = mapObj && typeof mapObj === 'object' ? (mapObj.files || mapObj) : {};
  const driveUrl = (a) => { const v = driveMap[a]; return (v && typeof v === 'object') ? (v.url || '') : (v || ''); };

  const toImport = [];
  let skipped = 0;
  const rowTotal = rows.length - hdrIdx - 1;
  for (let i = hdrIdx + 1; i < rows.length; i++) {
    const p = rows[i].split(',').map((x) => x.trim());
    const id = p[1], tel = p[2], estado = p[3], iccid = p[4], archivo = p[6] || '';
    if (!iccid || !tel || iccid === 'SIN DATOS' || tel === 'SIN DATOS' || isNaN(iccid)) { skipped++; continue; }
    const now = Date.now();
    const sim = defaultSim();
    sim.type = 'SIM';
    sim.name = id || '';
    sim.iccid = iccid;
    sim.phone = tel;
    sim.company = 'Telcel';
    // OK = inactiva, USADO = activa
    sim.statusManual = (estado && estado.toUpperCase() === 'USADO') ? 'active' : 'inactive';
    sim.statusOverridden = true;
    sim.photo = driveUrl(archivo);
    sim.notes = archivo ? ('Origen: ' + archivo) : '';
    sim.createdAt = now; sim.updatedAt = now;
    const img = byName[archivo];
    sim.photoThumb = img ? await fileToThumb(img) : '';
    toImport.push(sim);
    if (onProgress) onProgress({ done: i - hdrIdx, total: rowTotal });
    await new Promise((r) => setTimeout(r, 0));
  }

  if (!toImport.length) { toast('⚠️ Ninguna fila válida en el CSV'); return; }
  if (onProgress) onProgress({ save: true });
  const existing = await DB.getAll();
  const { toPut, added, updated } = mergeIncoming(existing, toImport);
  await DB.bulkPut(toPut);
  await load();
  render();
  closeModal();
  if (onProgress) onProgress({ done: true, added, updated, skipped, total: toImport.length });
  else toast(`🚀 Importados ${toImport.length} chips (${added} nuevos, ${updated} actualizados por ICCID/número; ${skipped} omitidos sin datos)`);
  autoSync();
}

function showSettingsModal() {
  let html = `<div class="settings-block">
    <div class="setting-row">
      <div><b>Conexión al servidor de sincronización</b><p class="muted">URL base del backend (opcional). Déjalo vacío para usar solo local.</p></div>
    </div>
    <label class="field"><span>URL del servidor</span><input id="syncUrl" placeholder="https://midominio.com" value="${escAttr(loadSyncModule().getUrl() || '')}" /></label>
    <label class="field"><span>Clave de acceso</span><input id="syncKey" type="password" placeholder="clave secreta" value="${escAttr(loadSyncModule().getKey() || '')}" /></label>
    <div class="form-actions"><button class="btn primary" id="saveSyncCfg">💾 Guardar</button></div>
  </div>`;
  openModal({ title: '⚙️ Ajustes', body: html, actions: [{ label: 'Cerrar', class: 'btn ghost', onClick: closeModal }] });
  $('#saveSyncCfg').addEventListener('click', () => {
    loadSyncModule().saveConfig($('#syncUrl').value.trim(), $('#syncKey').value.trim());
    toast('Ajustes guardados ✅');
    closeModal();
  });
}

function showSyncModal() {
  let html = `<div class="settings-block">
    <p>Tu servidor: <b>${esc(loadSyncModule().getUrl() || 'No configurado (solo local)')}</b></p>
    <p class="muted">Última sincronización: ${esc(loadSyncModule().lastSyncLabel() || 'nunca')}</p>
    <div class="form-actions" style="flex-wrap:wrap">
      <button class="btn primary" id="syncUpload">⬆️ Subir datos</button>
      <button class="btn" id="syncDownload">⬇️ Descargar datos</button>
    </div>
    <p class="muted" style="font-size:.85em;margin-top:10px;line-height:1.4">
      <b>Subir</b>: envía los datos de este dispositivo a la nube. Los chips nuevos se crean y los que ya existan (mismo ICCID o número) se actualizan.<br><br>
      <b>Descargar</b>: trae los datos de la nube a este dispositivo. Los chips nuevos se crean y los que ya existan (mismo ICCID o número) se actualizan.
    </p>
    <div id="syncResult" class="muted" style="margin-top:10px"></div>
  </div>`;
  openModal({ title: '☁️ Sincronización', body: html, actions: [{ label: 'Cerrar', class: 'btn ghost', onClick: closeModal }] });
  const run = async (fn, label) => {
    const r = $('#syncResult');
    if (!loadSyncModule().getUrl()) {
      r.textContent = '⚠️ No hay servidor configurado. Agrégalo en Ajustes.';
      return;
    }
    r.textContent = label + '…';
    try {
      const res = await loadSyncModule()[fn]();
      r.textContent = fn === 'upload'
        ? `✅ Subidos ${res.uploaded} chip(s) a la nube.`
        : `✅ Descargados ${res.downloaded} chip(s) (${res.added} nuevos, ${res.updated} actualizados).`;
      if (window.loadData) await window.loadData();
      render();
    } catch (e) {
      r.textContent = '⚠️ Error: ' + (e.message || 'sin conexión');
    }
  };
  $('#syncUpload').addEventListener('click', () => run('upload', 'Subiendo datos'));
  $('#syncDownload').addEventListener('click', () => run('download', 'Descargando datos'));
}

/* ============================================================
   Toast
   ============================================================ */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ============================================================
   Utilidades
   ============================================================ */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function escAttr(s) {
  return String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function autoSync() {
  try { loadSyncModule().schedule(); } catch (e) { /* noop */ }
}

// Cargar módulo de sincronización si existe
function loadSyncModule() {
  return window.ESIM_SYNC || { getUrl: () => '', getKey: () => '', saveConfig: () => {}, doSync: () => ({ pushed: 0, pulled: 0 }), schedule: () => {}, lastSyncLabel: () => '' };
}

// Para el módulo de sync (permite reconstruir sims remotos)
window.__defaultSim = defaultSim;
window.loadData = load;

/* ============================================================
   Service Worker
   ============================================================ */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // Al tomar control un SW nuevo, recargar para que la app use la última versión.
  const askRefresh = () => {
    if (!sessionStorage.getItem('sw_reloaded')) {
      sessionStorage.setItem('sw_reloaded', '1');
      window.location.reload();
    }
  };
  navigator.serviceWorker.addEventListener('controllerchange', askRefresh);
  // updateViaCache:'none' obliga al navegador a revalidar sw.js contra la red en
  // cada carga, para que detecte versiones nuevas y no use la caché HTTP vieja.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    })
    .catch((e) => console.warn('SW no registrado', e));
}

document.addEventListener('DOMContentLoaded', init);
