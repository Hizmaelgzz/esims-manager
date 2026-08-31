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

    schedule() {
      // Sincronización automática diferida (se dispara tras cambios)
      if (window.__syncTimer) clearTimeout(window.__syncTimer);
      window.__syncTimer = setTimeout(() => { this.doSync().catch(() => {}); }, 4000);
    },

    async doSync() {
      const url = this.getUrl();
      if (!url) return { pushed: 0, pulled: 0 };
      const base = url.replace(/\/+$/, '');
      const key = this.getKey();

      let lastSync = (await DB.getMeta(CFG_LAST)) || 0;

      // 1) Subir los cambios locales desde la última sincronización
      const localSims = await DB.getAll();
      const changed = localSims.filter((s) => (s.updatedAt || 0) > lastSync);

      const headers = { 'Content-Type': 'application/json' };
      if (key) headers['X-Api-Key'] = key;

      const pushRes = await fetch(base + '/api/sync/push', {
        method: 'POST',
        headers,
        body: JSON.stringify({ since: lastSync, sims: changed, clientId: 'pwa' })
      });
      if (!pushRes.ok) throw new Error('push ' + pushRes.status);

      const pushData = await pushRes.json();

      // 2) Obtener cambios remotos que no tengo
      const pullRes = await fetch(base + '/api/sync/pull?since=' + lastSync, { headers });
      if (!pullRes.ok) throw new Error('pull ' + pullRes.status);
      const pullData = await pullRes.json();

      // 3) Fusionar: la versión con updatedAt mayor gana
      const remote = pullData.sims || [];
      const localMap = new Map(localSims.map((s) => [s.id, s]));
      const toWrite = [];
      let pulled = 0;
      for (const r of remote) {
        const l = localMap.get(r.id);
        if (!l || (r.updatedAt || 0) > (l.updatedAt || 0)) {
          if (!l) pulled++;
          toWrite.push({ ...window.__defaultSim ? window.__defaultSim() : {}, ...r });
        }
      }
      if (toWrite.length) {
        await DB.bulkPut(toWrite);
      }

      // Guardar timestamp de sincronización
      const now = Date.now();
      await DB.setMeta(CFG_LAST, now);
      localStorage.setItem(CFG_LAST, String(now));

      return { pushed: (pushData.accepted || changed.length), pulled };
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
        toast(`Sync ✅ (↑${res.pushed} ↓${res.pulled})`);
      } catch (e) {
        toast('Sync falló ⚠️ ' + (e.message || ''));
      }
    }
  };

  window.ESIM_SYNC = Sync;
})();
