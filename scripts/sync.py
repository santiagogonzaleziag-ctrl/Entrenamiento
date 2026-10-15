"""Descarga tus datos de Garmin Connect y genera site/data.json.

Uso:
    python scripts/sync.py            # datos reales (necesita tokens)
    python scripts/sync.py --demo     # datos de ejemplo, sin cuenta

Tokens: se leen de la carpeta GARMINTOKENS (por defecto ~/.garminconnect).
Si existe la variable GARMIN_TOKENS (base64 de garmin_tokens.json) y la
carpeta no tiene tokens, se usan para sembrarla.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import os
import random
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import mean
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data.json"
TZ = ZoneInfo(os.getenv("DASHBOARD_TZ", "Europe/Madrid"))

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


def safe(fn, *args, default=None):
    try:
        return fn(*args)
    except Exception as exc:  # noqa: BLE001 — una métrica rota no debe tumbar todo
        print(f"  · {getattr(fn, '__name__', fn)}{args}: {exc}", file=sys.stderr)
        return default


def fetch_garmin(start: date, today: date) -> dict:
    from garminconnect import Garmin

    store = tokenstore_dir()
    client = Garmin()
    client.login(str(store))  # usa tokens guardados y los refresca solo
    print("✓ Sesión de Garmin abierta")

    activities = []
    # Por bloques de ~3 meses para no pedir demasiado de golpe
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

    # Zonas de FC: vienen en el resumen (hrTimeInZone_N); si faltan, pedirlas
    missing = [a for a in uniq if a.get("averageHR") and "hrTimeInZone_1" not in a]
    for a in missing[-60:]:
        zones = safe(client.get_activity_hr_in_timezones, a["activityId"], default=[]) or []
        for z in zones:
            a[f"hrTimeInZone_{z.get('zoneNumber')}"] = z.get("secsInZone", 0)

    today_s = today.isoformat()
    summary = safe(client.get_user_summary, today_s, default={}) or {}
    sleep = safe(client.get_sleep_data, today_s, default={}) or {}
    maxm = safe(client.get_max_metrics, today_s, default=[]) or []

    # VO2 máx: puede no venir hoy; buscar hacia atrás unos días
    vo2 = None
    for back in range(0, 14):
        d = (today - timedelta(days=back)).isoformat()
        mm = maxm if back == 0 else (safe(client.get_max_metrics, d, default=[]) or [])
        if isinstance(mm, dict):
            mm = [mm]
        for m in mm:
            g = (m or {}).get("generic") or {}
            vo2 = g.get("vo2MaxPreciseValue") or g.get("vo2MaxValue")
            if vo2:
                break
        if vo2:
            break

    body = safe(
        client.get_body_composition, (today - timedelta(days=90)).isoformat(), today_s, default={}
    ) or {}

    sleep_dto = (sleep or {}).get("dailySleepDTO") or {}
    scores = (sleep_dto.get("sleepScores") or {}).get("overall") or {}

    return {
        "activities": uniq,
        "today": {
            "restingHR": summary.get("restingHeartRate"),
            "steps": summary.get("totalSteps"),
            "bodyBattery": summary.get("bodyBatteryMostRecentValue"),
            "stress": summary.get("averageStressLevel"),
            "sleepSeconds": sleep_dto.get("sleepTimeSeconds"),
            "sleepScore": scores.get("value"),
            "vo2max": vo2,
        },
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
def fetch_demo(start: date, today: date) -> dict:
    rnd = random.Random(42)
    acts, aid = [], 1000
    d = start
    places = ["Sevilla", "Dos Hermanas", "Alcalá", "Guadaíra", "Parque del Alamillo", "Doñana"]
    while d <= today:
        week = d.isocalendar().week
        build = 0.6 + 0.4 * math.sin(week / 4)  # bloques de carga
        dow = d.weekday()
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
            pace = {"easy": 6.2, "tempo": 5.2, "long": 6.5}.get(kind, 0)  # min/km
            if key == "trail_running":
                pace += 1.4
            hr = {"easy": 138, "tempo": 158, "long": 145, "gym": 112, "swim": 128,
                  "hike": 115, "mind": 85, "bike": 132}[kind] + rnd.randint(-6, 6)
            dist = 0
            if pace:
                pace *= 1 - 0.05 * (d - start).days / 365  # mejora de forma
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
            a = {
                "activityId": aid,
                "activityName": {
                    "running": f"{rnd.choice(places)} Carrera", "trail_running": f"{rnd.choice(places)} Trail",
                    "hiking": f"{rnd.choice(places)} Senderismo", "road_biking": f"{rnd.choice(places)} Ciclismo",
                }.get(key, type_info(key)[0]),
                "startTimeLocal": f"{d.isoformat()} {7 + i * 10 + rnd.randint(0, 2):02d}:{rnd.randint(0, 59):02d}:00",
                "activityType": {"typeKey": key},
                "duration": secs,
                "distance": dist,
                "elevationGain": (dist / 1000 * (35 if key in ("trail_running", "hiking") else 6)) if dist else 0,
                "averageHR": hr if kind != "mind" else None,
                "maxHR": hr + 20,
                "calories": mins * (9 if kind in ("easy", "tempo", "long") else 6),
            }
            if zones and a["averageHR"]:
                for z, f in enumerate(zones, 1):
                    a[f"hrTimeInZone_{z}"] = secs * f
            acts.append(a)
        d += timedelta(days=1)

    body = []
    w, bf, mm = 74.5, 16.2, 59.8
    for back in range(90, -1, -1):
        if rnd.random() < 0.6:
            body.append({
                "date": (today - timedelta(days=back)).isoformat(),
                "weight": round(w + rnd.uniform(-0.6, 0.6) - back * -0.004, 1),
                "bodyFat": round(bf + rnd.uniform(-0.4, 0.4) - (90 - back) * 0.008, 1),
                "muscle": round(mm + rnd.uniform(-0.3, 0.3) + (90 - back) * 0.004, 1),
            })
    return {
        "activities": acts,
        "today": {"restingHR": 51, "steps": 8423, "bodyBattery": 64, "stress": 29,
                  "sleepSeconds": 7 * 3600 + 24 * 60, "sleepScore": 82, "vo2max": 52.4},
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
        })
    out.sort(key=lambda x: (x["date"], x["time"]))
    return out


def trimp(a: dict, rest: float, hrmax: float) -> float:
    """Carga Banister: minutos × reserva de FC × factor exponencial."""
    if not a["hr"]:
        return a["min"] * 0.25  # yoga, fuerza sin pulso…: algo de carga
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


def window_stats(acts: list[dict], days: int) -> dict:
    weeks = days / 7
    runs = [a for a in acts if a["family"] == "run" and a["km"] > 0.5]
    run_min = sum(a["min"] for a in runs)
    run_km = sum(a["km"] for a in runs)
    hr_runs = [a for a in runs if a["hr"]]
    eff = (
        mean((a["km"] * 1000 / a["min"]) / a["hr"] for a in hr_runs) if hr_runs else None
    )
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


def build(data: dict, today: date, start: date, demo: bool) -> dict:
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

    first_week = monday(year_start)
    weeks = weekly(acts, first_week, today, rest, hrmax)
    year_acts = [a for a in acts if a["date"] >= year_start.isoformat()]

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
        "body": body_summary(data.get("body") or [], today),
        "activities": list(reversed(year_acts)),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="genera datos de ejemplo")
    args = ap.parse_args()

    today = datetime.now(TZ).date()
    start = date(today.year, 1, 1) - timedelta(days=70)  # calentamiento para CTL

    data = fetch_demo(start, today) if args.demo else fetch_garmin(start, today)
    result = build(data, today, start, args.demo)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    print(f"✓ {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB, {result['yearTotals']['activities']} actividades en {today.year})")


if __name__ == "__main__":
    main()
