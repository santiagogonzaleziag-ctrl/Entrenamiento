"""Descarga tus datos de Garmin Connect y genera site/data.json.

Uso:
    python scripts/sync.py            # datos reales (necesita tokens)
    python scripts/sync.py --demo     # datos de ejemplo, sin cuenta

Tokens: se leen de la carpeta GARMINTOKENS (por defecto ~/.garminconnect).
Si existe la variable GARMIN_TOKENS (base64 de garmin_tokens.json) y la
carpeta no tiene tokens, se usan para sembrarla.

Si existe PAGES_URL (la URL pública de data.json), se reutiliza el historial
ya publicado para no volver a pedir a Garmin días que ya tenemos.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import os
import random
import sys
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import mean, median
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data.json"
TZ = ZoneInfo(os.getenv("DASHBOARD_TZ", "Europe/Madrid"))
RECOVERY_DAYS = 90

DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

# --------------------------------------------------------------------------
# Tipos de actividad → nombre visible y familia
# --------------------------------------------------------------------------
TYPES = {
    "running": ("Carrera", "run"),
    "street_running": ("Carrera", "run"),
    "track_running": ("Pista", "run"),
    "treadmill_running": ("Cinta", "run"),
    "trail_running": ("Trail", "run"),
    "virtual_run": ("Carrera virtual", "run"),
    "cycling": ("Ciclismo", "bike"),
    "road_biking": ("Ciclismo", "bike"),
    "mountain_biking": ("MTB", "bike"),
    "gravel_cycling": ("Gravel", "bike"),
    "indoor_cycling": ("Rodillo", "bike"),
    "virtual_ride": ("Rodillo", "bike"),
    "e_bike_fitness": ("E-bike", "bike"),
    "lap_swimming": ("Piscina", "swim"),
    "open_water_swimming": ("Aguas abiertas", "swim"),
    "hiking": ("Senderismo", "hike"),
    "walking": ("Caminar", "hike"),
    "strength_training": ("Fuerza", "gym"),
    "indoor_cardio": ("Cardio", "gym"),
    "hiit": ("HIIT", "gym"),
    "yoga": ("Yoga", "mind"),
    "pilates": ("Pilates", "mind"),
    "breathwork": ("Respiración", "mind"),
    "indoor_rowing": ("Remo", "other"),
    "rowing": ("Remo", "other"),
    "stand_up_paddleboarding": ("Paddle surf", "other"),
    "indoor_climbing": ("Escalada", "other"),
    "bouldering": ("Búlder", "other"),
    "tennis": ("Tenis", "other"),
    "padel": ("Pádel", "other"),
    "soccer": ("Fútbol", "other"),
}


def type_info(key: str) -> tuple[str, str]:
    key = (key or "other").lower()
    if key in TYPES:
        return TYPES[key]
    base = key.removesuffix("_v2")
    if base in TYPES:
        return TYPES[base]
    return base.replace("_", " ").capitalize(), "other"


# --------------------------------------------------------------------------
# Utilidades
# --------------------------------------------------------------------------
def safe(fn, *args, default=None):
    try:
        return fn(*args)
    except Exception as exc:  # noqa: BLE001 — una métrica rota no debe tumbar todo
        print(f"  · {getattr(fn, '__name__', fn)}{args}: {exc}", file=sys.stderr)
        return default


def load_previous() -> dict:
    """Lee el data.json ya publicado para reutilizar el historial."""
    url = os.getenv("PAGES_URL")
    if not url:
        return {}
    try:
        import urllib.request

        req = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=20) as r:
            prev = json.loads(r.read())
        if prev.get("demo"):
            return {}
        print("✓ Historial previo cargado")
        return prev
    except Exception as exc:  # noqa: BLE001
        print(f"  · sin historial previo: {exc}", file=sys.stderr)
        return {}


def round_or_none(v, nd=1):
    return round(v, nd) if isinstance(v, (int, float)) else None


# --------------------------------------------------------------------------
# Descarga desde Garmin
# --------------------------------------------------------------------------
def tokenstore_dir() -> Path:
    path = Path(os.getenv("GARMINTOKENS", "~/.garminconnect")).expanduser()
    path.mkdir(parents=True, exist_ok=True)
    token_file = path / "garmin_tokens.json"
    seed = os.getenv("GARMIN_TOKENS", "").strip()
    if seed and not token_file.exists():
        token_file.write_bytes(base64.b64decode(seed))
        token_file.chmod(0o600)
    return path


def recovery_day(client, d: str) -> dict:
    sl = safe(client.get_sleep_data, d, default={}) or {}
    dto = sl.get("dailySleepDTO") or {}
    hrv = safe(client.get_hrv_data, d, default={}) or {}
    hs = (hrv or {}).get("hrvSummary") or {}
    base = hs.get("baseline") or {}
    secs = dto.get("sleepTimeSeconds")
    deep = dto.get("deepSleepSeconds")
    return {
        "date": d,
        "sleepH": round(secs / 3600, 2) if secs else None,
        "deepH": round(deep / 3600, 2) if deep else None,
        "sleepScore": ((dto.get("sleepScores") or {}).get("overall") or {}).get("value"),
        "hrv": hs.get("lastNightAvg") or sl.get("avgOvernightHrv"),
        "hrvLow": base.get("balancedLow"),
        "hrvHigh": base.get("balancedUpper"),
        "rhr": sl.get("restingHeartRate"),
        "bb": sl.get("bodyBatteryChange"),
    }


def fetch_garmin(start: date, today: date, prev: dict) -> dict:
    from garminconnect import Garmin

    store = tokenstore_dir()
    client = Garmin()
    client.login(str(store))  # usa tokens guardados y los refresca solo
    print("✓ Sesión de Garmin abierta")

    activities = []
    cursor = start
    while cursor <= today:
        block_end = min(cursor + timedelta(days=90), today)
        chunk = safe(client.get_activities_by_date, cursor.isoformat(), block_end.isoformat(), default=[]) or []
        activities.extend(chunk)
        cursor = block_end + timedelta(days=1)
    seen, uniq = set(), []
    for a in activities:
        if a.get("activityId") not in seen:
            seen.add(a.get("activityId"))
            uniq.append(a)
    print(f"✓ {len(uniq)} actividades")

    missing = [a for a in uniq if a.get("averageHR") and "hrTimeInZone_1" not in a]
    for a in missing[-60:]:
        zones = safe(client.get_activity_hr_in_timezones, a["activityId"], default=[]) or []
        for z in zones:
            a[f"hrTimeInZone_{z.get('zoneNumber')}"] = z.get("secsInZone", 0)

    today_s = today.isoformat()
    summary = safe(client.get_user_summary, today_s, default={}) or {}

    vo2 = None
    for back in range(0, 14):
        d = (today - timedelta(days=back)).isoformat()
        mm = safe(client.get_max_metrics, d, default=[]) or []
        if isinstance(mm, dict):
            mm = [mm]
        for m in mm:
            g = (m or {}).get("generic") or {}
            vo2 = g.get("vo2MaxPreciseValue") or g.get("vo2MaxValue")
            if vo2:
                break
        if vo2:
            break

    # Recuperación: solo pedimos los días que no estaban ya publicados
    # Solo se reutilizan días con datos; los vacíos (p. ej. por un 429) se reintentan
    known = {d["date"]: d for d in (prev.get("recovery") or {}).get("days", [])
             if any(d.get(k) for k in ("hrv", "sleepH", "rhr"))}
    recovery, fetched = [], 0
    for back in range(RECOVERY_DAYS - 1, -1, -1):
        d = (today - timedelta(days=back)).isoformat()
        if d in known and back > 1:
            recovery.append(known[d])
            continue
        recovery.append(recovery_day(client, d))
        fetched += 1
        time.sleep(0.25)
    print(f"✓ Recuperación: {fetched} días descargados, {RECOVERY_DAYS - fetched} reutilizados")

    rp = safe(client.get_race_predictions, default=None)
    if isinstance(rp, list):
        rp = rp[-1] if rp else None
    preds = None
    if isinstance(rp, dict):
        preds = {k: rp.get(f) for k, f in
                 [("5K", "time5K"), ("10K", "time10K"), ("half", "timeHalfMarathon"), ("full", "timeMarathon")]}
        if not any(preds.values()):
            preds = None

    # Historial de predicciones: se rellena una vez desde Garmin (después se va acumulando solo)
    pred_backfill = []
    if len((prev.get("progress") or {}).get("predHistory", [])) < 20:
        start_p = (today - timedelta(days=120)).isoformat()
        raw = safe(client.get_race_predictions, start_p, today_s, "daily", default=None)
        if isinstance(raw, dict):
            raw = raw.get("racePredictions") or raw.get("entries") or [raw]
        for e in raw or []:
            if not isinstance(e, dict):
                continue
            d = (e.get("calendarDate") or e.get("fromCalendarDate") or "")[:10]
            if d and e.get("timeHalfMarathon"):
                pred_backfill.append({"date": d, "5K": e.get("time5K"), "10K": e.get("time10K"),
                                      "half": e.get("timeHalfMarathon"), "full": e.get("timeMarathon")})
        print(f"✓ Historial de predicciones: {len(pred_backfill)} días")

    body = safe(client.get_body_composition, (today - timedelta(days=90)).isoformat(), today_s, default={}) or {}
    last = recovery[-1] if recovery else {}

    return {
        "activities": uniq,
        "today": {
            "restingHR": summary.get("restingHeartRate") or last.get("rhr"),
            "steps": summary.get("totalSteps"),
            "bodyBattery": summary.get("bodyBatteryMostRecentValue"),
            "stress": summary.get("averageStressLevel"),
            "sleepSeconds": (last.get("sleepH") or 0) * 3600 or None,
            "sleepScore": last.get("sleepScore"),
            "hrv": last.get("hrv"),
            "vo2max": vo2,
        },
        "recovery": recovery,
        "predictions": preds,
        "predBackfill": pred_backfill,
        "body": [
            {
                "date": w.get("calendarDate"),
                "weight": (w.get("weight") or 0) / 1000 or None,
                "bodyFat": w.get("bodyFat"),
                "muscle": (w.get("muscleMass") or 0) / 1000 or None,
            }
            for w in (body.get("dateWeightList") or [])
            if w.get("weight")
        ],
        "name": safe(client.get_full_name, default=None),
    }


# --------------------------------------------------------------------------
# Datos de ejemplo (mismo formato que devuelve Garmin)
# --------------------------------------------------------------------------
def fetch_demo(start: date, today: date, prev: dict) -> dict:
    rnd = random.Random(42)
    acts, aid = [], 1000
    d = start
    places = ["Sevilla", "Dos Hermanas", "Alcalá", "Guadaíra", "Parque del Alamillo", "Doñana"]
    while d <= today:
        week = d.isocalendar().week
        build = 0.6 + 0.4 * math.sin(week / 4)
        dow = d.weekday()
        progress = (d - start).days / 365
        plan = []
        if dow in (0, 3) and rnd.random() < 0.85:
            plan.append(("running", 35 + rnd.randint(0, 25), "easy"))
        if dow == 1 and rnd.random() < 0.8:
            plan.append(("strength_training", 45 + rnd.randint(0, 25), "gym"))
        if dow == 2 and rnd.random() < 0.75:
            plan.append((rnd.choice(["treadmill_running", "running"]), 30 + rnd.randint(0, 15), "tempo"))
        if dow == 4 and rnd.random() < 0.5:
            plan.append(("lap_swimming", 30 + rnd.randint(0, 15), "swim"))
        if dow == 5 and rnd.random() < 0.35:
            plan.append(("hiking", 120 + rnd.randint(0, 120), "hike"))
        if dow == 6 and rnd.random() < 0.85:
            plan.append((rnd.choice(["running", "running", "trail_running"]), int((60 + rnd.randint(0, 50)) * build), "long"))
        if dow == 3 and rnd.random() < 0.3:
            plan.append(("yoga", 40 + rnd.randint(0, 30), "mind"))
        if dow == 5 and rnd.random() < 0.25:
            plan.append(("road_biking", 90 + rnd.randint(0, 60), "bike"))

        for i, (key, mins, kind) in enumerate(plan):
            aid += 1
            secs = mins * 60
            pace = {"easy": 6.2, "tempo": 5.2, "long": 6.5}.get(kind, 0)
            if key == "trail_running":
                pace += 1.4
            hr = {"easy": 140, "tempo": 158, "long": 146, "gym": 112, "swim": 128,
                  "hike": 115, "mind": 85, "bike": 132}[kind] + rnd.randint(-6, 6)
            dist = 0
            if pace:
                pace *= 1 - 0.06 * progress
                dist = mins / pace * 1000
            elif key == "lap_swimming":
                dist = mins * 33
            elif key == "hiking":
                dist = mins / 13 * 1000
            elif key == "road_biking":
                dist = mins / 60 * 27000
            zones = {
                "easy": [0.1, 0.6, 0.25, 0.05, 0], "tempo": [0.05, 0.2, 0.35, 0.3, 0.1],
                "long": [0.05, 0.5, 0.35, 0.1, 0], "swim": [0.2, 0.6, 0.2, 0, 0],
                "hike": [0.5, 0.45, 0.05, 0, 0], "bike": [0.15, 0.55, 0.25, 0.05, 0],
            }.get(kind)
            hour = rnd.choice([7, 7, 8, 19, 19, 20]) if dow < 5 else rnd.choice([8, 9, 10])
            a = {
                "activityId": aid,
                "activityName": {
                    "running": f"{rnd.choice(places)} Carrera", "trail_running": f"{rnd.choice(places)} Trail",
                    "hiking": f"{rnd.choice(places)} Senderismo", "road_biking": f"{rnd.choice(places)} Ciclismo",
                }.get(key, type_info(key)[0]),
                "startTimeLocal": f"{d.isoformat()} {min(23, hour + i):02d}:{rnd.randint(0, 59):02d}:00",
                "activityType": {"typeKey": key},
                "duration": secs,
                "distance": dist,
                "elevationGain": (dist / 1000 * (35 if key in ("trail_running", "hiking") else 6)) if dist else 0,
                "averageHR": hr if kind != "mind" else None,
                "maxHR": hr + 20,
                "calories": mins * (9 if kind in ("easy", "tempo", "long") else 6),
            }
            if key in ("running", "treadmill_running", "trail_running"):
                a["vO2MaxValue"] = round(49 + 3.5 * progress + rnd.uniform(-0.4, 0.4))
            if zones and a["averageHR"]:
                for z, f in enumerate(zones, 1):
                    a[f"hrTimeInZone_{z}"] = secs * f
            acts.append(a)
        d += timedelta(days=1)

    recovery = []
    for back in range(RECOVERY_DAYS - 1, -1, -1):
        dd = today - timedelta(days=back)
        hard = sum(1 for a in acts if a["startTimeLocal"][:10] == (dd - timedelta(days=1)).isoformat()
                   and (a.get("averageHR") or 0) > 150)
        sleep = rnd.uniform(6.0, 8.3) - (0.3 if dd.weekday() == 6 else 0)
        recovery.append({
            "date": dd.isoformat(),
            "sleepH": round(sleep, 2),
            "deepH": round(sleep * rnd.uniform(0.14, 0.22), 2),
            "sleepScore": int(max(45, min(96, 55 + (sleep - 6) * 14 + rnd.randint(-6, 6)))),
            "hrv": int(58 + 6 * math.sin(back / 9) - hard * 7 + rnd.randint(-4, 4) + (90 - back) * 0.04),
            "hrvLow": 52, "hrvHigh": 68,
            "rhr": int(51 + hard * 2 + rnd.randint(-1, 2) - (90 - back) * 0.01),
            "bb": int(35 + (sleep - 6) * 15 + rnd.randint(-8, 8)),
        })

    body = []
    w, bf, mm = 74.5, 16.2, 59.8
    for back in range(90, -1, -1):
        if rnd.random() < 0.6:
            body.append({
                "date": (today - timedelta(days=back)).isoformat(),
                "weight": round(w + rnd.uniform(-0.6, 0.6) - (90 - back) * 0.006, 1),
                "bodyFat": round(bf + rnd.uniform(-0.4, 0.4) - (90 - back) * 0.008, 1),
                "muscle": round(mm + rnd.uniform(-0.3, 0.3) + (90 - back) * 0.004, 1),
            })
    last = recovery[-1]
    return {
        "activities": acts,
        "today": {"restingHR": last["rhr"], "steps": 8423, "bodyBattery": 64, "stress": 29,
                  "sleepSeconds": last["sleepH"] * 3600, "sleepScore": last["sleepScore"],
                  "hrv": last["hrv"], "vo2max": 52.4},
        "recovery": recovery,
        "predictions": {"5K": 22 * 60 + 41, "10K": 47 * 60 + 12, "half": 1 * 3600 + 44 * 60 + 30, "full": 3 * 3600 + 41 * 60 + 5},
        "body": body,
        "name": "Demo",
    }


# --------------------------------------------------------------------------
# Procesado
# --------------------------------------------------------------------------
def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def normalize(raw: list[dict]) -> list[dict]:
    out = []
    for a in raw:
        try:
            start = datetime.strptime(a["startTimeLocal"][:19], "%Y-%m-%d %H:%M:%S")
        except (KeyError, ValueError):
            continue
        key = (a.get("activityType") or {}).get("typeKey", "other")
        label, family = type_info(key)
        zones = [round((a.get(f"hrTimeInZone_{z}") or 0) / 60, 1) for z in range(1, 6)]
        out.append({
            "id": a.get("activityId"),
            "name": a.get("activityName") or label,
            "date": start.date().isoformat(),
            "time": start.strftime("%H:%M"),
            "type": key,
            "label": label,
            "family": family,
            "min": round((a.get("duration") or 0) / 60, 1),
            "km": round((a.get("distance") or 0) / 1000, 2),
            "elev": round(a.get("elevationGain") or 0),
            "hr": round(a["averageHR"]) if a.get("averageHR") else None,
            "maxHr": round(a["maxHR"]) if a.get("maxHR") else None,
            "kcal": round(a.get("calories") or 0),
            "zones": zones if sum(zones) else None,
            "vo2": a.get("vO2MaxValue"),
        })
    out.sort(key=lambda x: (x["date"], x["time"]))
    return out


def trimp(a: dict, rest: float, hrmax: float) -> float:
    """Carga Banister: minutos × reserva de FC × factor exponencial."""
    if not a["hr"]:
        return a["min"] * 0.25
    x = max(0.0, min(1.0, (a["hr"] - rest) / max(1, hrmax - rest)))
    return a["min"] * x * 0.64 * math.exp(1.92 * x)


def load_series(acts, start, today, rest, hrmax):
    daily = defaultdict(float)
    for a in acts:
        daily[a["date"]] += trimp(a, rest, hrmax)
    ctl = atl = 0.0
    series = []
    d = start
    k_ctl, k_atl = 1 - math.exp(-1 / 42), 1 - math.exp(-1 / 7)
    while d <= today:
        l = daily.get(d.isoformat(), 0.0)
        ctl += (l - ctl) * k_ctl
        atl += (l - atl) * k_atl
        series.append({"date": d.isoformat(), "load": round(l, 1), "ctl": round(ctl, 1),
                       "atl": round(atl, 1), "tsb": round(ctl - atl, 1)})
        d += timedelta(days=1)
    return series


def form_state(tsb: float, ctl: float) -> tuple[str, str]:
    r = tsb / ctl if ctl else 0
    if r > 0.25:
        return "Fresco", "Mucho descanso acumulado. Buen momento para competir, o vas perdiendo forma si se alarga."
    if r > -0.1:
        return "Recuperado", "Buen equilibrio entre forma y fatiga. Listo para un bloque normal o un pequeño empujón."
    if r > -0.3:
        return "Productivo", "Fatiga controlada: zona donde se gana forma. Cuida el sueño."
    return "Sobrecarga", "La fatiga supera mucho a la forma. Mete días suaves antes de que pase factura."


def fmt_pace(min_per_km: float | None) -> str | None:
    if not min_per_km:
        return None
    m = int(min_per_km)
    s = round((min_per_km - m) * 60)
    if s == 60:
        m, s = m + 1, 0
    return f"{m}:{s:02d}"


def fmt_secs(s: float) -> str:
    s = round(s)
    h, r = divmod(s, 3600)
    m, s = divmod(r, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def window_stats(acts: list[dict], days: int) -> dict:
    weeks = days / 7
    runs = [a for a in acts if a["family"] == "run" and a["km"] > 0.5]
    run_min = sum(a["min"] for a in runs)
    run_km = sum(a["km"] for a in runs)
    hr_runs = [a for a in runs if a["hr"]]
    eff = mean((a["km"] * 1000 / a["min"]) / a["hr"] for a in hr_runs) if hr_runs else None
    hr_acts = [a for a in acts if a["hr"]]
    by_type = defaultdict(float)
    for a in acts:
        by_type[a["label"]] += a["min"]
    return {
        "sessionMin": mean(a["min"] for a in acts) if acts else None,
        "pace": run_min / run_km if run_km else None,
        "efficiency": eff,
        "weekMin": sum(a["min"] for a in acts) / weeks,
        "weekKm": sum(a["km"] for a in acts if a["family"] != "swim") / weeks,
        "weekElev": sum(a["elev"] for a in acts) / weeks,
        "sessions": len(acts) / weeks,
        "hr": mean(a["hr"] for a in hr_acts) if hr_acts else None,
        "byType": {k: v / weeks for k, v in by_type.items()},
    }


def trends(acts: list[dict], today: date) -> dict:
    cut1 = (today - timedelta(days=27)).isoformat()
    cut0 = (today - timedelta(days=55)).isoformat()
    cur = window_stats([a for a in acts if a["date"] >= cut1], 28)
    prev = window_stats([a for a in acts if cut0 <= a["date"] < cut1], 28)

    rows = []

    def add(key, label, unit, better="up", fmt=None):
        a, b = prev.get(key), cur.get(key)
        if a is None or b is None or a == 0:
            return
        pct = (b - a) / a * 100
        good = pct if better == "up" else -pct
        rows.append({"label": label, "prev": a, "cur": b, "pct": round(pct), "good": round(good),
                     "unit": unit, "fmt": fmt})

    add("sessionMin", "Duración media", "min", "up", "dur")
    add("pace", "Ritmo de carrera", "/km", "down", "pace")
    add("efficiency", "Eficiencia cardiaca", "m/lat", "up", "num2")
    add("weekMin", "Volumen semanal", "", "up", "dur")
    add("weekKm", "Distancia semanal", "km", "up", "num1")
    add("weekElev", "Desnivel semanal", "m", "up", "int")
    add("sessions", "Sesiones / semana", "", "up", "num1")
    add("hr", "FC media entrenando", "ppm", "flat", "int")

    groups = {"improving": [], "declining": [], "steady": [], "shifting": []}
    for r in rows:
        if r["label"] == "FC media entrenando" or abs(r["pct"]) < 3:
            groups["steady"].append(r)
        elif r["good"] > 0:
            groups["improving"].append(r)
        else:
            groups["declining"].append(r)

    types = set(cur["byType"]) | set(prev["byType"])
    for t in sorted(types, key=lambda t: -(cur["byType"].get(t, 0) + prev["byType"].get(t, 0)))[:5]:
        a, b = prev["byType"].get(t, 0), cur["byType"].get(t, 0)
        pct = round((b - a) / a * 100) if a else 100
        groups["shifting"].append({"label": t, "prev": a, "cur": b, "pct": pct, "fmt": "dur", "unit": "/sem"})

    ni, nd = len(groups["improving"]), len(groups["declining"])
    if ni and not nd:
        verdict = "Todo apunta hacia arriba. Buen bloque: mantén la constancia."
    elif nd and not ni:
        verdict = "Bajón general. Si es una descarga planificada, perfecto; si no, vuelve poco a poco a la rutina."
    elif ni > nd:
        verdict = "Más mejoras que retrocesos. Vas en buena dirección."
    else:
        verdict = "Señales mixtas: algunas cosas mejoran y otras flojean. Normal al cambiar de fase; céntrate en lo que importa para tu objetivo."
    return {"groups": groups, "verdict": verdict}


def weekly(acts: list[dict], first_week: date, today: date, rest: float, hrmax: float) -> list[dict]:
    weeks = []
    w = first_week
    by_week = defaultdict(list)
    for a in acts:
        by_week[monday(date.fromisoformat(a["date"])).isoformat()].append(a)
    while w <= today:
        items = by_week.get(w.isoformat(), [])
        types = defaultdict(float)
        for a in items:
            types[a["label"]] += a["min"]
        zones = [0.0] * 5
        for a in items:
            if a["zones"]:
                zones = [z + y for z, y in zip(zones, a["zones"])]
        runs = [a for a in items if a["family"] == "run" and a["km"] > 0]
        long_run = max(runs, key=lambda a: a["km"], default=None)
        hr = [a for a in items if a["hr"]]
        weeks.append({
            "start": w.isoformat(),
            "week": w.isocalendar().week,
            "sessions": len(items),
            "min": round(sum(a["min"] for a in items)),
            "km": round(sum(a["km"] for a in items), 1),
            "elev": round(sum(a["elev"] for a in items)),
            "kcal": sum(a["kcal"] for a in items),
            "hr": round(sum(a["hr"] * a["min"] for a in hr) / sum(a["min"] for a in hr)) if hr else None,
            "load": round(sum(trimp(a, rest, hrmax) for a in items)),
            "types": dict(sorted(types.items(), key=lambda kv: -kv[1])),
            "zones": [round(z) for z in zones],
            "longRun": {
                "km": long_run["km"], "min": long_run["min"],
                "pace": fmt_pace(long_run["min"] / long_run["km"]),
            } if long_run else None,
        })
        w += timedelta(days=7)
    return weeks


def zone_summary(weeks: list[dict]) -> dict:
    def pct(ws):
        tot = [sum(w["zones"][i] for w in ws) for i in range(5)]
        s = sum(tot)
        return [round(t / s * 100) if s else 0 for t in tot]

    cur, prev = pct(weeks[-4:]), pct(weeks[-8:-4])
    easy, hard = cur[0] + cur[1], cur[3] + cur[4]
    if cur[2] > 30:
        model, note = "umbral", "Mucho tiempo en Z3 («tierra de nadie»). Prueba a hacer más suave lo suave y más duro lo duro."
    elif easy >= 70:
        model, note = "polarizado", "Buen reparto polarizado: casi todo suave y fuerte cuando toca. Sostenible para ganar fondo."
    elif hard > 25:
        model, note = "intenso", "Mucha intensidad alta. Vigila la recuperación o añade rodajes en Z2."
    else:
        model, note = "piramidal", "Reparto piramidal: base suave con algo de tempo. Equilibrado."
    return {"cur": cur, "delta": [c - p for c, p in zip(cur, prev)], "model": model, "note": note}


def body_summary(body: list[dict], today: date) -> dict | None:
    if not body:
        return None
    body = sorted(body, key=lambda b: b["date"])

    def avg(rows, k):
        vals = [r[k] for r in rows if r.get(k)]
        return round(mean(vals), 1) if vals else None

    c30 = (today - timedelta(days=30)).isoformat()
    c60 = (today - timedelta(days=60)).isoformat()
    cur = [b for b in body if b["date"] >= c30]
    prev = [b for b in body if c60 <= b["date"] < c30]
    out = {"series": body[-90:]}
    for k in ("weight", "bodyFat", "muscle"):
        a, b = avg(prev, k), avg(cur, k)
        out[k] = {"cur": b, "delta": round(b - a, 1) if a is not None and b is not None else None}
    w, m = out["weight"]["delta"], out["muscle"]["delta"]
    if w is not None and m is not None:
        if w < 0 and m < 0:
            out["note"] = "Bajando peso y también músculo. Suaviza el déficit o mete más fuerza para proteger la masa magra."
        elif w < 0:
            out["note"] = "Bajando peso manteniendo músculo. Recomposición en buena dirección."
        elif m > 0:
            out["note"] = "Ganando músculo. Si el peso sube, que sea sobre todo por ahí."
        else:
            out["note"] = "Composición estable."
    return out


# ---------- Nuevos bloques ----------
def habits(acts: list[dict], weeks: list[dict], today: date) -> dict:
    year = str(today.year)
    active = {a["date"] for a in acts}
    d = today if today.isoformat() in active else today - timedelta(days=1)
    streak = 0
    while d.isoformat() in active:
        streak += 1
        d -= timedelta(days=1)

    longest = cur = 0
    best_end, prev_d = None, None
    for s in sorted(x for x in active if x[:4] == year):
        dd = date.fromisoformat(s)
        cur = cur + 1 if prev_d and (dd - prev_d).days == 1 else 1
        if cur > longest:
            longest, best_end = cur, s
        prev_d = dd

    yacts = [a for a in acts if a["date"][:4] == year]
    weekday = [0.0] * 7
    punch = [[0] * 24 for _ in range(7)]
    hours = [0] * 24
    for a in yacts:
        dd = date.fromisoformat(a["date"])
        h = int(a["time"][:2])
        weekday[dd.weekday()] += a["min"]
        punch[dd.weekday()][h] += 1
        hours[h] += 1

    monthly = []
    for m in range(1, today.month + 1):
        first = date(today.year, m, 1)
        last = (date(today.year + (m == 12), m % 12 + 1, 1) - timedelta(days=1))
        last = min(last, today)
        ndays = (last - first).days + 1
        act_days = len({x for x in active if x[:7] == f"{year}-{m:02d}"})
        mins = sum(a["min"] for a in yacts if a["date"][:7] == f"{year}-{m:02d}")
        monthly.append({"month": MESES[m - 1], "active": act_days, "days": ndays,
                        "pct": round(act_days / ndays * 100), "hours": round(mins / 60, 1)})

    full_weeks = [w for w in weeks if date.fromisoformat(w["start"]) + timedelta(days=6) <= today]
    goal_weeks = sum(1 for w in full_weeks if w["sessions"] >= 3)
    run_weeks = 0
    for w in reversed(full_weeks):
        if w["sessions"] >= 3:
            run_weeks += 1
        else:
            break
    best_weeks, cur_w, best_weeks_end = 0, 0, None
    for w in full_weeks:
        cur_w = cur_w + 1 if w["sessions"] >= 3 else 0
        if cur_w > best_weeks:
            best_weeks, best_weeks_end = cur_w, w["week"]
    this_week = weeks[-1]["sessions"] if weeks else 0

    fav_day = DIAS[max(range(7), key=lambda i: weekday[i])] if any(weekday) else None
    quiet_day = DIAS[min(range(7), key=lambda i: weekday[i])] if any(weekday) else None
    buckets = {"de madrugada": range(0, 7), "por la mañana": range(7, 12), "a mediodía": range(12, 16),
               "por la tarde": range(16, 20), "por la noche": range(20, 24)}
    when = max(buckets, key=lambda b: sum(hours[h] for h in buckets[b])) if any(hours) else None
    when_pct = round(sum(hours[h] for h in buckets[when]) / sum(hours) * 100) if when else 0
    sports = Counter(a["label"] for a in yacts)
    fav_sport = sports.most_common(1)[0] if sports else None

    days_so_far = (today - date(today.year, 1, 1)).days + 1
    active_year = len({x for x in active if x[:4] == year})

    insights = []
    if when:
        insights.append(f"Entrenas sobre todo {when} ({when_pct}% de las sesiones).")
    if fav_day:
        insights.append(f"Tu día fuerte es el {fav_day}; el más tranquilo, el {quiet_day}.")
    if full_weeks:
        insights.append(f"{goal_weeks} de {len(full_weeks)} semanas con 3 o más sesiones "
                        f"({round(goal_weeks / len(full_weeks) * 100)}%).")
    if fav_sport:
        insights.append(f"Deporte más frecuente: {fav_sport[0].lower()} ({fav_sport[1]} sesiones).")

    return {
        "streak": streak, "longest": longest, "longestEnd": best_end,
        "activeDays": active_year, "daysSoFar": days_so_far,
        "weekStreak": run_weeks, "goalWeeks": goal_weeks, "fullWeeks": len(full_weeks),
        "bestWeekStreak": best_weeks, "bestWeekStreakEnd": best_weeks_end, "thisWeek": this_week,
        "weekday": [round(m) for m in weekday], "punch": punch, "monthly": monthly,
        "insights": insights,
    }


def progress(acts: list[dict], data: dict, prev: dict, today: date) -> dict:
    # VO2 máx: lo que Garmin estima en cada carrera
    vo2_by_day = {}
    for a in acts:
        if a.get("vo2"):
            vo2_by_day[a["date"]] = a["vo2"]
    if data["today"].get("vo2max"):
        vo2_by_day[today.isoformat()] = data["today"]["vo2max"]
    vo2 = [{"date": k, "v": v} for k, v in sorted(vo2_by_day.items()) if k >= f"{today.year - 1}-12-01"]

    # Ritmo a igual pulso: carreras en llano con FC media
    runs = [a for a in acts if a["family"] == "run" and a["type"] != "trail_running"
            and a["hr"] and a["km"] >= 2 and a["min"] >= 12]
    ref = int(round(median(a["hr"] for a in runs) / 5) * 5) if runs else 150
    by_month = defaultdict(list)
    for a in runs:
        by_month[a["date"][:7]].append((a["km"] * 1000 / a["min"]) / a["hr"])
    eff = []
    for m in sorted(by_month):
        if m[:4] != str(today.year) and m != f"{today.year - 1}-12":
            continue
        e = median(by_month[m])
        eff.append({"month": m, "label": MESES[int(m[5:]) - 1], "pace": round(1000 / (e * ref), 3),
                    "n": len(by_month[m])})

    preds = data.get("predictions")
    by_date = {h["date"]: h for h in data.get("predBackfill") or []}
    by_date.update({h["date"]: h for h in (prev.get("progress") or {}).get("predHistory", [])})
    if preds:
        by_date[today.isoformat()] = {"date": today.isoformat(), **preds}
    hist = [by_date[k] for k in sorted(by_date)][-400:]
    ago = None
    for h in reversed(hist):
        if h["date"] <= (today - timedelta(days=30)).isoformat():
            ago = h
            break

    pred_cards = []
    if preds:
        for k, label, km in [("5K", "5 km", 5), ("10K", "10 km", 10), ("half", "Media", 21.0975), ("full", "Maratón", 42.195)]:
            if preds.get(k):
                delta = (preds[k] - ago[k]) if ago and ago.get(k) else None
                pred_cards.append({"key": k, "label": label, "secs": preds[k], "time": fmt_secs(preds[k]),
                                   "pace": fmt_pace(preds[k] / 60 / km), "delta": delta})

    insights = []
    if len(vo2) >= 2:
        first = next((x for x in vo2 if x["date"][:4] == str(today.year)), vo2[0])
        dv = vo2[-1]["v"] - first["v"]
        if abs(dv) >= 0.5:
            insights.append(f"VO₂ máx {'+' if dv > 0 else ''}{dv:.1f} desde {MESES[int(first['date'][5:7]) - 1]}.")
        else:
            insights.append("VO₂ máx estable en lo que va de año.")
    if len(eff) >= 2:
        diff = (eff[0]["pace"] - eff[-1]["pace"]) * 60
        if diff > 3:
            insights.append(f"A {ref} ppm corres {round(diff)} s/km más rápido que en {eff[0]['label']}: mejor base aeróbica.")
        elif diff < -3:
            insights.append(f"A {ref} ppm vas {round(-diff)} s/km más lento que en {eff[0]['label']}. Calor, fatiga o pérdida de base.")
        else:
            insights.append(f"Ritmo a {ref} ppm estable desde {eff[0]['label']}.")
    if pred_cards and pred_cards[0]["delta"] is not None:
        d = pred_cards[0]["delta"]
        if abs(d) >= 5:
            insights.append(f"Predicción de 5 km {'mejora' if d < 0 else 'empeora'} {abs(round(d))} s en 30 días.")

    return {"vo2": vo2, "refHr": ref, "efficiency": eff, "predictions": pred_cards,
            "predHistory": hist, "insights": insights}


def recovery_block(days: list[dict], series: list[dict]) -> dict | None:
    days = [d for d in days if any(d.get(k) for k in ("hrv", "sleepH", "rhr"))]
    if not days:
        return None
    load = {s["date"]: s["load"] for s in series}
    for d in days:
        d["load"] = load.get(d["date"], 0)

    def avg(rows, k):
        vals = [r[k] for r in rows if r.get(k)]
        return mean(vals) if vals else None

    last7, base = days[-7:], days[-37:-7] or days[:-7]
    out = {"days": days}
    for k in ("hrv", "rhr", "sleepH", "sleepScore", "bb"):
        a, b = avg(base, k), avg(last7, k)
        out[k] = {"avg7": round_or_none(b), "avg30": round_or_none(a),
                  "pct": round((b - a) / a * 100) if a and b else None}

    hrv_pct = out["hrv"]["pct"] or 0
    rhr_d = (out["rhr"]["avg7"] or 0) - (out["rhr"]["avg30"] or 0)
    if hrv_pct <= -7 or rhr_d >= 3:
        state, note = "Atención", "Tu VFC baja o tu pulso en reposo sube respecto a tu normalidad. Prioriza sueño y días suaves."
    elif hrv_pct >= 4 and rhr_d <= 0:
        state, note = "Óptima", "VFC por encima de tu media y pulso en reposo controlado: buen momento para apretar."
    else:
        state, note = "Normal", "Indicadores dentro de tu rango habitual. Sigue con el plan."
    out["state"], out["note"] = state, note

    insights = []
    loads = sorted(d["load"] for d in days if d["load"] > 0)
    if len(loads) >= 8:
        p75 = loads[int(len(loads) * 0.75)]
        by_date = {d["date"]: d for d in days}
        after_hard, after_easy = [], []
        for d in days:
            prev_d = (date.fromisoformat(d["date"]) - timedelta(days=1)).isoformat()
            p = by_date.get(prev_d)
            if p and d.get("hrv"):
                (after_hard if p["load"] >= p75 else after_easy).append(d["hrv"])
        if len(after_hard) >= 3 and after_easy:
            diff = (mean(after_hard) - mean(after_easy)) / mean(after_easy) * 100
            if diff <= -3:
                insights.append(f"Tras tus días de más carga, tu VFC cae un {abs(round(diff))}% la noche siguiente.")
            else:
                insights.append("Tu VFC aguanta bien los días de carga alta: buena capacidad de recuperación.")
    short = [d for d in days if d.get("sleepH") and d["sleepH"] < 6.5 and d.get("rhr")]
    longs = [d for d in days if d.get("sleepH") and d["sleepH"] >= 7.5 and d.get("rhr")]
    if len(short) >= 3 and len(longs) >= 3:
        diff = mean(d["rhr"] for d in short) - mean(d["rhr"] for d in longs)
        if diff >= 1:
            insights.append(f"Las noches de menos de 6 h 30 min tu pulso en reposo es {diff:.1f} ppm más alto.")
    sleeps = [d["sleepH"] for d in days[-30:] if d.get("sleepH")]
    if sleeps:
        under7 = sum(1 for s in sleeps if s < 7)
        insights.append(f"{under7} de las últimas {len(sleeps)} noches dormiste menos de 7 h.")
    out["insights"] = insights
    return out


def build(data: dict, today: date, start: date, demo: bool, prev: dict) -> dict:
    acts = normalize(data["activities"])
    year_start = date(today.year, 1, 1)
    rest = data["today"].get("restingHR") or 55
    observed = [a["maxHr"] for a in acts if a["maxHr"]]
    hrmax = max(observed) if observed else 190

    series = load_series(acts, start, today, rest, hrmax)
    last = series[-1]
    ago = series[-8]["ctl"] if len(series) > 8 else last["ctl"]
    state, advice = form_state(last["tsb"], last["ctl"])

    days = defaultdict(lambda: {"n": 0, "min": 0.0, "types": []})
    for a in acts:
        if a["date"] >= year_start.isoformat():
            d = days[a["date"]]
            d["n"] += 1
            d["min"] = round(d["min"] + a["min"], 1)
            d["types"].append(a["label"])

    weeks = weekly(acts, monday(year_start), today, rest, hrmax)
    year_acts = [a for a in acts if a["date"] >= year_start.isoformat()]
    for a in acts:
        if not a.get("vo2"):
            a.pop("vo2", None)

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "demo": demo,
        "name": data.get("name"),
        "today": today.isoformat(),
        "year": today.year,
        "stats": {**data["today"], "hrMax": hrmax},
        "yearTotals": {
            "activities": len(year_acts),
            "hours": round(sum(a["min"] for a in year_acts) / 60),
            "km": round(sum(a["km"] for a in year_acts if a["family"] != "swim")),
            "elev": round(sum(a["elev"] for a in year_acts)),
        },
        "days": days,
        "load": {
            "series": [s for s in series if s["date"] >= year_start.isoformat()],
            "ctl": last["ctl"], "atl": last["atl"], "tsb": last["tsb"],
            "ctlChange": round((last["ctl"] - ago) / ago * 100) if ago else 0,
            "state": state, "advice": advice,
        },
        "trends": trends(acts, today),
        "zones": zone_summary(weeks),
        "weeks": weeks,
        "progress": progress(acts, data, prev, today),
        "recovery": recovery_block(data.get("recovery") or [], series),
        "habits": habits(acts, weeks, today),
        "body": body_summary(data.get("body") or [], today),
        "activities": list(reversed(year_acts)),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="genera datos de ejemplo")
    args = ap.parse_args()

    today = datetime.now(TZ).date()
    start = date(today.year, 1, 1) - timedelta(days=70)  # calentamiento para CTL

    prev = {} if args.demo else load_previous()
    data = fetch_demo(start, today, prev) if args.demo else fetch_garmin(start, today, prev)
    result = build(data, today, start, args.demo, prev)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    print(f"✓ {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB, {result['yearTotals']['activities']} actividades en {today.year})")


if __name__ == "__main__":
    main()
