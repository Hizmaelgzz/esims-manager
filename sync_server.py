"""
eSIM Manager - Backend de sincronizacion en la nube (PostgreSQL / Supabase).

Almacena las eSIMs en una base de datos PostgreSQL (compatible con Supabase),
lo que garantiza persistencia aunque Render (plan free) reinicie.

Configuracion por variables de entorno:
  DATABASE_URL  (obligatoria si usas Postgres)  -> cadena de conexion de Supabase/Render
  ESIM_API_KEY  (opcional)                      -> clave secreta; si se define, se exige X-Api-Key

Endpoints:
  GET  /                  -> estado
  POST /api/sync/push     -> subir cambios locales   { since, sims, clientId }
  GET  /api/sync/pull     -> bajar cambios remotos   ?since=123

Despliegue en Render: usa render.yaml (Blueprints). La tabla se crea sola.
"""

import os
import time

from flask import Flask, request, jsonify
from flask_cors import CORS

DATABASE_URL = os.environ.get("DATABASE_URL", "")
API_KEY = os.environ.get("ESIM_API_KEY", "")

# Auto-detectar driver disponible
try:
    import psycopg
    DRIVER = "psycopg3"
except ImportError:
    try:
        import psycopg2
        DRIVER = "psycopg2"
    except ImportError:
        DRIVER = None

app = Flask(__name__)
CORS(app)

DDL = """
CREATE TABLE IF NOT EXISTS esims (
    id         TEXT PRIMARY KEY,
    name       TEXT,
    iccid      TEXT,
    phone      TEXT,
    country    TEXT,
    company    TEXT,
    plan       TEXT,
    status_manual   TEXT,
    status_overridden BOOLEAN DEFAULT FALSE,
    credit     TEXT,
    last_recharge    BIGINT,
    next_recharge    BIGINT,
    warn_days  INTEGER,
    period     TEXT,
    apps       TEXT DEFAULT '[]',
    notes      TEXT,
    color      TEXT,
    created_at BIGINT,
    updated_at BIGINT
);
"""


def _get_conn():
    if DRIVER == "psycopg3":
        import psycopg
        return psycopg.connect(DATABASE_URL)
    if DRIVER == "psycopg2":
        import psycopg2
        return psycopg2.connect(DATABASE_URL)
    raise RuntimeError("No hay driver de Postgres instalado")


def _init_db():
    if not DATABASE_URL:
        return  # modo sin base: falla con mensaje claro
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(DDL)
        conn.commit()
        cur.close()
    finally:
        conn.close()


def _row_to_sim(row):
    if not row:
        return None
    (iid, name, iccid, phone, country, company, plan, status_manual,
     status_overridden, credit, last_recharge, next_recharge, warn_days,
     period, apps, notes, color, created_at, updated_at) = row
    import json as _json
    return {
        "id": iid, "name": name, "iccid": iccid, "phone": phone,
        "country": country, "company": company, "plan": plan,
        "statusManual": status_manual, "statusOverridden": bool(status_overridden),
        "credit": credit, "lastRecharge": last_recharge,
        "nextRecharge": next_recharge, "warnDays": warn_days,
        "period": period,
        "apps": _json.loads(apps) if apps else [],
        "notes": notes, "color": color,
        "createdAt": created_at, "updatedAt": updated_at,
    }


def _sim_to_row(s):
    import json as _json
    return (
        s.get("id"), s.get("name"), s.get("iccid"), s.get("phone"),
        s.get("country"), s.get("company"), s.get("plan"),
        s.get("statusManual"), bool(s.get("statusOverridden")),
        s.get("credit"), s.get("lastRecharge") or None,
        s.get("nextRecharge") or None, s.get("warnDays"),
        s.get("period"), _json.dumps(s.get("apps") or []),
        s.get("notes"), s.get("color"),
        s.get("createdAt") or None, s.get("updatedAt") or None,
    )


UPSERT = """
INSERT INTO esims (id, name, iccid, phone, country, company, plan,
    status_manual, status_overridden, credit, last_recharge, next_recharge,
    warn_days, period, apps, notes, color, created_at, updated_at)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON CONFLICT (id) DO UPDATE SET
    name=EXCLUDED.name, iccid=EXCLUDED.iccid, phone=EXCLUDED.phone,
    country=EXCLUDED.country, company=EXCLUDED.company, plan=EXCLUDED.plan,
    status_manual=EXCLUDED.status_manual,
    status_overridden=EXCLUDED.status_overridden,
    credit=EXCLUDED.credit, last_recharge=EXCLUDED.last_recharge,
    next_recharge=EXCLUDED.next_recharge, warn_days=EXCLUDED.warn_days,
    period=EXCLUDED.period, apps=EXCLUDED.apps, notes=EXCLUDED.notes,
    color=EXCLUDED.color, created_at=EXCLUDED.created_at,
    updated_at=EXCLUDED.updated_at
    WHERE esims.updated_at <= EXCLUDED.updated_at
"""

INSERT_ONLY = """
INSERT INTO esims (id, name, iccid, phone, country, company, plan,
    status_manual, status_overridden, credit, last_recharge, next_recharge,
    warn_days, period, apps, notes, color, created_at, updated_at)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON CONFLICT (id) DO NOTHING
"""


def _check_auth():
    if not API_KEY:
        return None
    if request.headers.get("X-Api-Key") != API_KEY:
        return jsonify({"error": "Clave invalida"}), 401
    return None


@app.route("/")
def index():
    return jsonify({"status": "ok", "service": "esim-manager-sync", "db": DRIVER or "sin-base"})


@app.route("/api/sync/push", methods=["POST"])
def push():
    auth = _check_auth()
    if auth:
        return auth
    if not DATABASE_URL:
        return jsonify({"error": "Base de datos no configurada (falta DATABASE_URL)"}), 500
    body = request.get_json(silent=True) or {}
    sims = body.get("sims") or []
    accepted = 0
    conn = _get_conn()
    try:
        cur = conn.cursor()
        for sim in sims:
            if not sim.get("id"):
                continue
            # insertar solo si es mas reciente (para no pisar datos mas nuevos)
            cur.execute(INSERT_ONLY, _sim_to_row(sim))
            if cur.rowcount == 0:
                cur.execute(UPSERT, _sim_to_row(sim))
            if cur.rowcount > 0:
                accepted += 1
        conn.commit()
        cur.close()
    finally:
        conn.close()
    return jsonify({"accepted": accepted, "syncAt": int(time.time() * 1000)})


@app.route("/api/sync/pull")
def pull():
    auth = _check_auth()
    if auth:
        return auth
    if not DATABASE_URL:
        return jsonify({"error": "Base de datos no configurada (falta DATABASE_URL)"}), 500
    since = int(request.args.get("since", "0") or 0)
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM esims WHERE updated_at > %s", (since,))
        rows = cur.fetchall()
        cur.close()
    finally:
        conn.close()
    colnames = ["id","name","iccid","phone","country","company","plan",
                "status_manual","status_overridden","credit","last_recharge",
                "next_recharge","warn_days","period","apps","notes","color",
                "created_at","updated_at"]
    records = [_row_to_sim([r[colnames.index(c)] for c in colnames]) for r in rows]
    return jsonify({"sims": records, "serverTime": int(time.time() * 1000)})


# Inicializar la tabla al arrancar
if DATABASE_URL:
    _init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    print("Servidor de sincronizacion eSIM Manager")
    print("   Base de datos: PostgreSQL" if DATABASE_URL else "   SIN base de datos configurada (DATABASE_URL)")
    print("   Puerto: " + str(port))
    app.run(host="0.0.0.0", port=port, threaded=True)
