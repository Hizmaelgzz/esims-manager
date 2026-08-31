# eSIM Manager 📱

Aplicación web progresiva (PWA) para **administrar todas tus eSIMs** desde el móvil. Registra ICCID, número de teléfono, compañía, aplicaciones donde está registrada, estado de recarga, fechas de vencimiento, y mucho más. Interfaz amigable, rápida y que funciona sin conexión.

## Características

- **Registro completo de eSIMs**: nombre, ICCID, teléfono, compañía, país, plan.
- **Estado automático**: calcula si una eSIM está activa, requiere recarga o por vencer, según crédito y fecha de vencimiento. También permite fijar estado manual.
- **Control de recargas**: crédito actual, última y próxima recarga, periodo, avisos anticipados.
- **Aplicaciones**: marca en qué apps está registrada cada SIM (WhatsApp, Uber, Didi, Amazon, Telegram, etc.) y agrega las que quieras.
- **Búsqueda y filtros**: por nombre, ICCID, teléfono, compañía y estado.
- **Dashboard**: resumen visual de totales, activas, las que requieren atención y apps más usadas.
- **Color/etiqueta** por SIM para identificarlas rápidamente.
- **100% local**: los datos se guardan en el dispositivo (IndexedDB) y funcionan sin internet.
- **Instalable**: se puede "instalar" en la pantalla de inicio como una app nativa.
- **Sincronización en la nube (opcional)**: respalda y comparte datos entre dispositivos.

## Cómo usar

### Opción A: solo local (lo más fácil)
1. Navega a la carpeta `esims-app` y abre `index.html` — o mejor, súbela a cualquier hosting estático (GitHub Pages, Netlify, Vercel, etc.).
2. En el móvil, abre la URL.
3. Toca el **＋** para agregar tu primera eSIM.

Para **instalarla** en Android: abre el menú del navegador → "Agregar a pantalla de inicio" / "Instalar app".

### Opción B: con sincronización en la nube
1. Despliega el backend `sync_server.py` en un servidor (Render, Railway, Fly.io, un VPS…).
2. Configura la variable de entorno `ESIM_API_KEY` con una clave secreta personal.
3. En la app: menú ☰ → Ajustes → escribe la URL del servidor y la clave → Guardar.
4. La app sincronizará sola los cambios (sube y descarga).

## Estructura

```
esims-app/
├── index.html            # Interfaz principal
├── css/styles.css        # Estilos (tema oscuro, responsive)
├── js/db.js              # Capa de datos local (IndexedDB)
├── js/app.js             # Lógica de la app y UI
├── js/sync.js            # Sincronización con la nube
├── manifest.webmanifest  # Para instalación PWA
├── sw.js                 # Service worker (offline + caché)
├── icons/                # Iconos de la app
└── sync_server.py        # Backend opcional de sincronización (Flask)
```

## Probar el backend localmente

```bash
cd esims-app
pip install flask flask_cors
set ESIM_API_KEY=miclave
python sync_server.py    # corre en http://127.0.0.1:5001
```

## Notas sobre escalabilidad

La app está pensada para cientos de SIMs (200+). Los datos se guardan localmente en IndexedDB, que maneja sin problema miles de registros, y la búsqueda/filtrado es instantáneo en el dispositivo.

---

Hecho para uso personal. Los datos nunca salen del dispositivo salvo que configures la sincronización voluntariamente.
