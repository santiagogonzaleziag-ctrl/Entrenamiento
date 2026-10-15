# Dashboard de entrenamiento Garmin

Una página web con tus datos de Garmin Connect que se actualiza sola cada hora:
heatmap anual de actividades, carga de entrenamiento (forma / fatiga / frescura),
tendencias de 4 semanas, zonas de FC, progresión de la tirada larga, resumen
semanal y lista de actividades. Inspirado en <https://araujo.zip/training>.

**Coste: 0 €.** No necesitas servidor: GitHub Actions descarga tus datos cada
hora y GitHub Pages sirve la web.

```
Reloj → Garmin Connect ──(cada hora)──► GitHub Actions: scripts/sync.py
                                              │  genera site/data.json
                                              ▼
                                        GitHub Pages: index.html + app.js
```

## Probarlo en local (2 minutos, sin cuenta)

```bash
python3 scripts/sync.py --demo        # genera datos de ejemplo
cd site && python3 -m http.server 8000
# abre http://localhost:8000
```

## Ponerlo en marcha con tus datos

### 1. Sube el proyecto a GitHub

Crea un repositorio nuevo (público, para que Pages sea gratis) y sube esta
carpeta. Tus datos y tokens **no** se suben nunca al repo: el `.gitignore` los
excluye y el JSON solo existe dentro del despliegue de Pages.

### 2. Inicia sesión en Garmin una vez (en tu ordenador)

Garmin no tiene API pública; se usa
[python-garminconnect](https://github.com/cyberjunky/python-garminconnect), que
inicia sesión como lo hace la app oficial. Necesitas Python 3.12 o superior.

```bash
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python scripts/login.py
```

Te pedirá email, contraseña y, si lo tienes activado, el código MFA. Al terminar
imprime una cadena larga en base64. Tu contraseña no se guarda en ningún sitio.

### 3. Guarda el token como secreto

En GitHub: **Settings → Secrets and variables → Actions → New repository secret**

- Nombre: `GARMIN_TOKENS`
- Valor: la cadena que imprimió `login.py`

### 4. Activa GitHub Pages

**Settings → Pages → Build and deployment → Source: GitHub Actions**.

### 5. Primera ejecución

**Actions → Sincronizar Garmin y publicar → Run workflow**. En un par de minutos
tendrás la web en `https://TU_USUARIO.github.io/NOMBRE_DEL_REPO/`. A partir de
ahí se actualiza sola cada hora.

## Personalizar

- **Zona horaria**: `DASHBOARD_TZ` en `.github/workflows/sync.yml`.
- **Frecuencia**: la línea `cron`. Cada hora es más que suficiente; no la bajes
  de 30 min para no abusar de los servidores de Garmin.
- **Nombres y colores de deportes**: el diccionario `TYPES` en `scripts/sync.py`
  y las variables `--run`, `--bike`… en `site/style.css`.
- **Tu propio dominio**: Settings → Pages → Custom domain.
- **Integrarlo en otra web**: copia la carpeta `site/` (es HTML/JS sin
  dependencias) y apunta el workflow para que publique `data.json` donde
  necesites.

## Cómo se calculan las métricas

- **Carga diaria**: TRIMP de Banister = minutos × reserva de FC × factor
  exponencial. Las actividades sin pulso (yoga, fuerza…) cuentan poco.
- **Forma (CTL)**: media exponencial de 42 días de la carga.
  **Fatiga (ATL)**: media de 7 días. **Frescura (TSB)** = forma − fatiga.
- **Tendencias**: últimos 28 días frente a los 28 anteriores.
- **Eficiencia cardiaca**: metros por minuto ÷ pulsaciones medias en carrera
  (más alto = mejor).
- **Zonas**: tiempo en cada zona según las zonas configuradas en tu Garmin.

## Si algo falla

- **El workflow falla al iniciar sesión**: el token se ha caducado o revocado.
  Repite el paso 2 y actualiza el secreto `GARMIN_TOKENS`. La web sigue
  mostrando los últimos datos publicados mientras tanto.
- **Garmin cambia su login**: pasa de vez en cuando. Actualiza la librería
  (`pip install -U garminconnect`) y revisa sus issues en GitHub.
- **Faltan VO₂ máx o sueño**: dependen de tu modelo de reloj; las tarjetas sin
  datos se ocultan solas.

## Privacidad

La página es pública. Muestra nombres de actividad (Garmin suele ponerles el
nombre de la localidad), fechas y horas, pero **no** rutas GPS. Si no quieres
que se vea dónde entrenas, renombra las actividades o cambia
`"name": a.get("activityName")` por `"name": label` en `normalize()` dentro de
`scripts/sync.py`.

El token da acceso a tu cuenta de Garmin: guárdalo solo como secreto de GitHub.
Si se filtra, cambia tu contraseña de Garmin para invalidarlo.
