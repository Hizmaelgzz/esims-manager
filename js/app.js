'use strict';

/* ============================================================
   eSIM Manager - Lógica principal de la aplicación
   ============================================================ */

// Configuración de campos y opciones
const COMPANIES = [
  'Claro', 'Movistar', 'Entel', 'Tigo', 'Wom', 'AT&T', 'T-Mobile', 'Verizon',
  'Vodafone', 'O2', 'Orange', 'TIM', 'Airalo', 'Holafly', 'Nomad', 'eSIM Plus',
  'Ubigi', 'Airalo', 'esim.me', 'Telcel', 'Bitel', 'Otro'
];

const APP_OPTIONS = [
  'WhatsApp', 'Telegram', 'Uber', 'Didi', 'Amazon', 'Mercado Libre', 'Instagram',
  'Facebook', 'X (Twitter)', 'TikTok', 'YouTube', 'Google', 'Banking/Fintech',
  'Netflix', 'Spotify', 'Delivery apps', 'Otro'
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Activa', icon: '🟢', badgeColor: '#bbf7d0' },
  { value: 'recharge_pending', label: 'Requiere recarga', icon: '🟠', badgeColor: '#fed7aa' },
  { value: 'soon', label: 'Por vencer/pronto', icon: '🟡', badgeColor: '#fde68a' },
  { value: 'inactive', label: 'Inactiva', icon: '⚪', badgeColor: '#e2e8f0' },
  { value: 'suspended', label: 'Suspendida', icon: '🔴', badgeColor: '#fecaca' }
];

const PERIOD_OPTIONS = ['Diaria', 'Semanal', 'Quincenal', 'Mensual', 'Cada 2 meses', 'Trimestral', 'Semestral', 'Anual', 'Sin periodo'];

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

// Estado derivado de una SIM en función de fechas/crédito
function computeStatus(sim) {
  if (sim.statusOverridden && sim.statusManual) return sim.statusManual;
  if (sim.credit !== null && sim.credit !== '' && Number(sim.credit) <= 0) return 'recharge_pending';
  const dn = daysUntil(sim.nextRecharge);
  if (dn !== null) {
    if (dn < 0) return 'recharge_pending';
    if (sim.warnDays !== null && dn <= sim.warnDays) return 'soon';
  }
  return 'active';
}

function statusDef(val) {
  return STATUS_OPTIONS.find((s) => s.value === val) || STATUS_OPTIONS[3];
}

function sortSims(list) {
  const rank = { active: 0, recharge_pending: 1, soon: 2, inactive: 3, suspended: 4 };
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
    iccid: '',
    phone: '',
    country: '',
    company: '',
    plan: '',
    statusManual: 'active',
    statusOverridden: false,
    credit: '',
    lastRecharge: null,
    nextRecharge: null,
    warnDays: 3,
    period: 'Mensual',
    apps: [],
    notes: '',
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
    renderList();
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
  const pending = all.filter((s) => ['recharge_pending', 'soon', 'suspended'].includes(computeStatus(s))).length;
  const totalApps = new Set(all.flatMap((s) => s.apps || [])).size;
  wrap.innerHTML = `
    <div class="stat-card"><div class="stat-num">${all.length}</div><div class="stat-label">eSIMs totales</div></div>
    <div class="stat-card"><div class="stat-num green">${active}</div><div class="stat-label">Activas</div></div>
    <div class="stat-card"><div class="stat-num orange">${pending}</div><div class="stat-label">Atención</div></div>
    <div class="stat-card"><div class="stat-num blue">${totalApps}</div><div class="stat-label">Apps usadas</div></div>
  `;
}

function needAttention(list) {
  return list.filter((s) => ['recharge_pending', 'soon', 'suspended'].includes(computeStatus(s)));
}

function renderDashboard() {
  const content = $('#view-dashboard-content');
  const list = filteredSims();
  const attention = needAttention(state.sims).slice(0, 6);

  let html = '';

  if (attention.length) {
    html += `<div class="section-head"><h2>⚠️ Requieren atención</h2><button data-goto-list class="link-btn">Ver todo</button></div>
    <div class="attention-grid">`;
    attention.forEach((s) => {
      html += simCard(s);
    });
    html += `</div>`;
  }

  if (!attention.length) {
    html += `<div class="empty-note">🎉 Todo está al día. No hay eSIMs que requieran atención.</div>`;
  }

  html += `<div class="section-head"><h2>Últimas eSIMs</h2></div>`;

  if (!list.length) {
    html += `<div class="empty-state">
      <div class="empty-icon">📱</div>
      <h3>No tienes eSIMs registradas</h3>
      <p>Toca el botón <b>＋</b> para agregar tu primera eSIM y empezar a organizarlas.</p>
      <button class="btn primary" data-add>＋ Agregar eSIM</button>
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

function simCard(s) {
  const st = computeStatus(s);
  const stD = statusDef(st);
  const days = daysUntil(s.nextRecharge);
  const apps = (s.apps || []).slice(0, 4);
  return `
    <div class="sim-card" data-id="${s.id}" style="--accent:${s.color || '#3b82f6'}">
      <div class="sim-card-top">
        <div class="sim-avatar" style="background:${s.color || '#3b82f6'}">${(s.name || '?').charAt(0).toUpperCase()}</div>
        <div class="sim-ident">
          <div class="sim-name">${esc(s.name || 'Sin nombre')}</div>
          <div class="sim-sub">${esc(s.company || 'Compañía')}${s.country ? ' · ' + esc(s.country) : ''}</div>
        </div>
        <span class="badge" style="--bcolor:${stD.badgeColor}">${stD.icon} ${stD.label}</span>
      </div>
      <div class="sim-meta">
        ${s.phone ? `<span>📞 ${esc(s.phone)}</span>` : ''}
        ${days !== null ? `<span class="${days <= (s.warnDays ?? 0) ? 'danger-text' : ''}">⏳ ${days < 0 ? 'venció' : days + ' días'}</span>` : ''}
        ${s.credit !== '' && s.credit !== null ? `<span>💰 $${esc(s.credit)}</span>` : ''}
      </div>
      ${apps.length ? `<div class="sim-apps">${apps.map(a => `<span class="app-tag">${esc(a)}</span>`).join('')}${(s.apps||[]).length > 4 ? `<span class="app-tag more">+${(s.apps||[]).length-4}</span>` : ''}</div>` : ''}
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
  const days = daysUntil(sim.nextRecharge);

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
        ${infoItem('ICCID', sim.iccid || '—', true)}
        ${infoItem('Número de teléfono', sim.phone || '—')}
        ${infoItem('Compañía', sim.company || '—')}
        ${infoItem('País', sim.country || '—')}
        ${infoItem('Plan', sim.plan || '—')}
        ${infoItem('Periodo de recarga', sim.period || '—')}
        ${infoItem('Crédito actual', sim.credit !== '' && sim.credit !== null ? '$' + sim.credit : '—')}
        ${infoItem('Última recarga', sim.lastRecharge ? formatDate(sim.lastRecharge) : '—')}
        ${infoItem('Próxima recarga', sim.nextRecharge ? formatDate(sim.nextRecharge) + (days!==null?` <span class="${days<=0?'danger-text':'muted'}">(${days<0?'venció':days+' días'})</span>`:'') : '—', false, true)}
      </div>

      ${(sim.apps || []).length ? `
      <div class="detail-section">
        <h3>📲 Apps registradas</h3>
        <div class="detail-apps">${sim.apps.map(a => `<span class="app-tag">${esc(a)}</span>`).join('')}</div>
      </div>` : ''}

      ${sim.notes ? `
      <div class="detail-section">
        <h3>📝 Notas</h3>
        <p class="notes-text" style="white-space:pre-wrap">${esc(sim.notes)}</p>
      </div>` : ''}

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
  const selectedApps = new Set(sim.apps || []);
  const selectStatus = sim.statusOverridden ? sim.statusManual : null;

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

      <label class="field">
        <span>Nombre / Etiqueta *</span>
        <input name="name" required value="${escAttr(sim.name || '')}" placeholder="Ej: SIM Bolivia" />
      </label>

      <label class="field">
        <span>ICCID</span>
        <input name="iccid" value="${escAttr(sim.iccid || '')}" placeholder="8930 1234 5678 9012 34" />
      </label>

      <label class="field">
        <span>Número de teléfono</span>
        <input name="phone" inputmode="tel" value="${escAttr(sim.phone || '')}" placeholder="+591 71234567" />
      </label>

      <div class="field-row">
        <label class="field">
          <span>Compañía</span>
          <select name="company">${COMPANIES.map(c => `<option ${sim.company===c?'selected':''}>${c}</option>`).join('')}<option value="">Otro…</option></select>
        </label>
        <label class="field">
          <span>País</span>
          <input name="country" value="${escAttr(sim.country || '')}" placeholder="Bolivia" />
        </label>
      </div>

      <label class="field">
        <span>Plan</span>
        <input name="plan" value="${escAttr(sim.plan || '')}" placeholder="Ej: Prepago 20GB" />
      </label>

      <div class="field-row">
        <label class="field">
          <span>Crédito actual (B$-USD)</span>
          <input name="credit" inputmode="decimal" type="number" step="0.01" value="${escAttr(sim.credit ?? '')}" placeholder="0.00" />
        </label>
        <label class="field">
          <span>Periodo de recarga</span>
          <select name="period">${PERIOD_OPTIONS.map(p => `<option ${sim.period===p?'selected':''}>${p}</option>`).join('')}</select>
        </label>
      </div>

      <div class="field-row">
        <label class="field">
          <span>Última recarga</span>
          <input name="lastRecharge" type="date" value="${sim.lastRecharge ? isoDate(sim.lastRecharge) : ''}" />
        </label>
        <label class="field">
          <span>Próxima recarga / vencimiento</span>
          <input name="nextRecharge" type="date" value="${sim.nextRecharge ? isoDate(sim.nextRecharge) : ''}" />
        </label>
      </div>

      <label class="field">
        <span>Avisarme con anticipación (días)</span>
        <input name="warnDays" type="number" min="0" max="90" value="${escAttr(sim.warnDays ?? 3)}" />
      </label>

      <div class="field">
        <span class="field-label">Estado</span>
        <div class="status-picker">
          <button type="button" class="status-opt ${!sim.statusOverridden ? 'selected' : ''}" data-status="auto">✨ Automático</button>
          ${STATUS_OPTIONS.map(so => `<button type="button" class="status-opt ${selectStatus===so.value?'selected':''}" data-status="${so.value}">${so.icon} ${so.label}</button>`).join('')}
        </div>
        <p class="hint">"Automático" calcula el estado según crédito y fecha de vencimiento.</p>
      </div>

      <div class="field">
        <span class="field-label">Aplicaciones donde está registrada</span>
        <div class="app-chip-list">
          ${APP_OPTIONS.map(a => `<button type="button" class="app-chip ${selectedApps.has(a)?'selected':''}" data-app="${escAttr(a)}">${a}</button>`).join('')}
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

  // custom app input: Enter agrega
  const customApp = $('#customApp');
  customApp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = customApp.value.trim();
      if (v && !selectedApps.has(v)) {
        selectedApps.add(v);
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
      chip.remove();
    });
    content.querySelector('.app-chip-list').appendChild(chip);
  }

  // toggles de apps (las del listado)
  content.querySelectorAll('.app-chip[data-app]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const app = chip.dataset.app;
      if (selectedApps.has(app)) { selectedApps.delete(app); chip.classList.remove('selected'); }
      else { selectedApps.add(app); chip.classList.add('selected'); }
    });
  });

  // status
  content.querySelectorAll('.status-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      // si es automático, desmarcar override; si no, fijar manual
      content.querySelectorAll('.status-opt').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  content.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => goBackAfterForm()));

  $('#simForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const selectedStatus = content.querySelector('.status-opt.selected');
    const statusValue = selectedStatus ? selectedStatus.dataset.status : 'auto';

    const data = {
      ...defaultSim(),
      ...sim,
      name: f.name.value.trim(),
      iccid: f.iccid.value.trim(),
      phone: f.phone.value.trim(),
      company: f.company.value,
      country: f.country.value.trim(),
      plan: f.plan.value.trim(),
      credit: f.credit.value !== '' ? String(f.credit.value) : '',
      period: f.period.value,
      lastRecharge: f.lastRecharge.value ? new Date(f.lastRecharge.value + 'T12:00:00').getTime() : null,
      nextRecharge: f.nextRecharge.value ? new Date(f.nextRecharge.value + 'T12:00:00').getTime() : null,
      warnDays: f.warnDays.value !== '' ? Number(f.warnDays.value) : null,
      notes: f.notes.value.trim(),
      apps: [...selectedApps],
      statusOverridden: statusValue !== 'auto',
      statusManual: statusValue !== 'auto' ? statusValue : sim.statusManual,
      color: (content.querySelector('.color-dot.selected') || {}).dataset?.color || sim.color || '#3b82f6',
    };

    const saved = await DB.put(data);
    const idx = state.sims.findIndex((x) => x.id === saved.id);
    if (idx >= 0) state.sims[idx] = saved; else state.sims.push(saved);
    toast('eSIM guardada ✅');
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
  all.forEach((s) => (s.apps || []).forEach((a) => { appCounts[a] = (appCounts[a] || 0) + 1; }));
  const topApps = Object.entries(appCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const byCompany = {};
  all.forEach((s) => { const c = s.company || 'Sin compañía'; byCompany[c] = (byCompany[c] || 0) + 1; });

  let html = `<div class="stats-block">
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-num">${all.length}</div><div class="stat-label">Totales</div></div>
      <div class="stat-card"><div class="stat-num green">${all.filter(s=>computeStatus(s)==='active').length}</div><div class="stat-label">Activas</div></div>
      <div class="stat-card"><div class="stat-num orange">${needAttention(all).length}</div><div class="stat-label">Atención</div></div>
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
      <div><b>Borrar todo</b><p class="muted">Elimina todas las eSIMs del dispositivo.</p></div>
      <button class="btn danger-ghost" id="btnWipe">Borrar</button>
    </div>
    <input type="file" id="importFile" accept="application/json" class="hidden" />
  </div>`;
  openModal({ title: '📤 Respaldo', body: html, actions: [{ label: 'Cerrar', class: 'btn ghost', onClick: closeModal }] });

  $('#btnExportJson').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), sims: state.sims }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'esims-' + todayISO() + '.json';
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
      const items = (data.sims || []).map((s) => ({ ...defaultSim(), ...s }));
      await DB.bulkPut(items);
      await load();
      render();
      closeModal();
      toast(`Importados ${items.length} eSIMs 📥`);
      autoSync();
    } catch (err) {
      toast('Archivo inválido ⚠️');
    }
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
    <div class="form-actions"><button class="btn primary" id="syncNow">🔄 Sincronizar ahora</button></div>
    <div id="syncResult" class="muted" style="margin-top:10px"></div>
  </div>`;
  openModal({ title: '☁️ Sincronización', body: html, actions: [{ label: 'Cerrar', class: 'btn ghost', onClick: closeModal }] });
  $('#syncNow').addEventListener('click', async () => {
    const r = $('#syncResult');
    r.textContent = 'Sincronizando…';
    try {
      const res = await loadSyncModule().doSync();
      r.textContent = `✅ Subidos ${res.pushed}, descargados ${res.pulled}.`;
      await load(); render();
    } catch (e) {
      r.textContent = '⚠️ Error: ' + (e.message || 'sin conexión');
    }
  });
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
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW no registrado', e));
  }
}

document.addEventListener('DOMContentLoaded', init);
