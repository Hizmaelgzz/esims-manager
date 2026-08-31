'use strict';

/* ============================================================
   Módulo de sincronización en la nube (opcional)
   Permite sincronizar los datos locales con un backend.
   Si no hay servidor configurado, la app funciona 100% local.
   ============================================================ */

(async function () {
  const CFG_URL_KEY = 'sync_url';
  const CFG_KEY_KEY = 'sync_key';
  const CFG_LAST = 'sync_last';

  const Sync = {
    getUrl() { return localStorage.getItem(CFG_URL_KEY) || ''; },
    getKey() { return localStorage.getItem(CFG_KEY_KEY) || ''; },
    saveConfig(url, key) {
      localStorage.setItem(CFG_URL_KEY, url);
      localStorage.setItem(CFG_KEY_KEY, key);
    },
    lastSyncLabel() {
      const t = localStorage.getItem(CFG_LAST);
      return t ? new Date(Number(t)).toLocaleString('es-ES') : null;
    },

    // Colapsa registros remotos que representan el mismo chip
    // (mismo ICCID, o mismo teléfono si no hay ICCID), quedándose con el más reciente.
    dedupeRemote(remote) {
      const byKey = new Map();
      for (const r of remote) {
        const ic = (r.iccid != null ? String(r.iccid) : '').trim();
        const ph = (r.phone != null ? String(r.phone) : '').trim();
        const key = ic ? ('ic:' + ic) : (ph ? ('ph:' + ph) : ('id:' + r.id));
        const prev = byKey.get(key);
        if (!prev || (r.updatedAt || 0) >= (prev.updatedAt || 0)) byKey.set(key, r);
      }
      return [...byKey.values()];
    },

    schedule() {
      // Sincronización automática diferida (se dispara tras cambios)
      if (window.__syncTimer) clearTimeout(window.__syncTimer);
      window.__syncTimer = setTimeout(() => { this.doSync().catch(() => {}); }, 4000);
    },

    _base() { return this.getUrl().replace(/\/+$/, ''); },
    _headers() {
      const h = { 'Content-Type': 'application/json' };
      const key = this.getKey();
      if (key) h['X-Api-Key'] = key;
      return h;
    },
    async _markSaved() {
      const now = Date.now();
      await DB.setMeta(CFG_LAST, now);
      localStorage.setItem(CFG_LAST, String(now));
      return now;
    },

    // SUBIR: envía los datos de ESTE dispositivo al servidor.
    // Los chips nuevos se crean en la nube; si el ICCID (o número) ya existe,
    // se actualizan los datos de ese mismo.
    async upload({ since = 0 } = {}) {
      if (!this.getUrl()) return { uploaded: 0 };
      const localSims = await DB.getAll();
      const sims = since ? localSims.filter((s) => (s.updatedAt || 0) > since) : localSims;
      const res = await fetch(this._base() + '/api/sync/push', {
        method: 'POST', headers: this._headers(),
        body: JSON.stringify({ since, sims, clientId: 'pwa' })
      });
      if (!res.ok) throw new Error('subida HTTP ' + res.status);
      const data = await res.json();
      await this._markSaved();
      return { uploaded: data.accepted || sims.length };
    },

    // DESCARGAR: trae los datos del servidor a ESTE dispositivo.
    // Los chips de la nube se crean aquí; si el ICCID (o número) ya existe
    // localmente, se actualizan los datos de ese mismo.
    async download({ since = 0 } = {}) {
      if (!this.getUrl()) return { downloaded: 0, added: 0, updated: 0 };
      const localSims = await DB.getAll();
      const res = await fetch(this._base() + '/api/sync/pull?since=' + since, { headers: this._headers() });
      if (!res.ok) throw new Error('descarga HTTP ' + res.status);
      const data = await res.json();
      const remote = this.dedupeRemote(data.sims || []);
      let added = 0, updated = 0, toWrite = remote;
      if (remote.length && typeof window.mergeIncoming === 'function') {
        const m = window.mergeIncoming(localSims, remote);
        toWrite = m.toPut; added = m.added; updated = m.updated;
      }
      if (toWrite.length) await DB.bulkPut(toWrite);
      await this._markSaved();
      return { downloaded: added + updated, added, updated };
    },

    async doSync() {
      if (!this.getUrl()) return { uploaded: 0, downloaded: 0 };
      const lastSync = (await DB.getMeta(CFG_LAST)) || 0;
      const up = await this.upload({ since: lastSync });
      const dl = await this.download({ since: lastSync });
      return { uploaded: up.uploaded, downloaded: dl.downloaded };
    },

    async runManualSync() {
      if (!this.getUrl()) {
        toast('☁️ No hay servidor configurado. Ve a Ajustes para agregarlo.');
        return;
      }
      toast('Sincronizando…');
      try {
        const res = await this.doSync();
        await window.loadData && window.loadData();
        render();
        toast(`Sync ✅ (↑${res.uploaded} ↓${res.downloaded})`);
      } catch (e) {
        toast('Sync falló ⚠️ ' + (e.message || ''));
      }
    }
  };

  window.ESIM_SYNC = Sync;
})();
