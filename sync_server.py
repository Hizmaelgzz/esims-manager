"""
eSIM Manager - Backend de sincronización en la nube.

API de sincronización simple que almacena las eSIMs en un archivo JSON.
Pensado para desplegar en un servidor (Render, Railway, VPS, etc.).

Endpoints:
  GET  /                 -> estado
  POST /api/sync/push    -> subir cambios locales  { since, sims, clientId }
  GET  /api/sync/pull?since=123  -> bajar cambios remotos desde 'since'

Uso local:
  pip install flask flask_cors
  python sync_server.py
"""

import os
import json
import time
import threading
from flask import Flask, request, jsonify
from flask_cors import CORS

DATA_FILE = os.environ.get("ESIM_DATA_FILE", "esims_sync_data.json")
API_KEY = os.environ.get("ESIM_API_KEY", "")  # Si se define, se exige X-Api-Key

app = Flask(__name__)
CORS(app)

_lock = threading.Lock()


def _load():
    if not os.path.exists(DATA_FILE):
        return {}
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _save(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _check_auth():
    """Devuelve None si está OK, o una respuesta de error."""
    if not API_KEY:
        return None
    if request.headers.get("X-Api-Key") != API_KEY:
        return jsonify({"error": "Clave invalida"}), 401
    return None


@app.route("/")
def index():
    return jsonify({"status": "ok", "service": "esim-manager-sync"})


@app.route("/api/sync/push", methods=["POST"])
def push():
    auth = _check_auth()
    if auth:
        return auth
    body = request.get_json(silent=True) or {}
    sims = body.get("sims") or []
    now = int(time.time() * 1000)

    with _lock:
        data = _load()
        sims_all = data.get("sims", {})
        accepted = 0
        for sim in sims:
            if not sim.get("id"):
                continue
            existing = sims_all.get(sim["id"]) or {}
            # Resolución de conflictos: gana la versión más reciente
            if (sim.get("updatedAt", 0) >= existing.get("updatedAt", 0)):
                sims_all[sim["id"]] = sim
                accepted += 1
        data["sims"] = sims_all
        data["syncAt"] = now
        _save(data)

    return jsonify({"accepted": accepted, "syncAt": now})


@app.route("/api/sync/pull")
def pull():
    auth = _check_auth()
    if auth:
        return auth
    since = int(request.args.get("since", "0") or 0)
    data = _load()
    sims_all = data.get("sims", {})
    remote = [s for s in sims_all.values() if s.get("updatedAt", 0) > since]
    return jsonify({"sims": remote, "serverTime": int(time.time() * 1000)})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    print("=" * 50)
    print("Servidor de sincronizacion eSIM Manager")
    print("   Archivo de datos: " + DATA_FILE)
    print("   Puerto: " + str(port))
    print("=" * 50)
    app.run(host="0.0.0.0", port=port, threaded=True)
