(async function () {
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const FAMILY_NAMES = { run: 'Carrera', bike: 'Ciclismo', swim: 'Natación', hike: 'Caminar', gym: 'Gimnasio', mind: 'Cuerpo-mente', other: 'Otros' };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- tema ----------
  $('theme').onclick = () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
  };

  // ---------- tooltip ----------
  const tip = $('tip');
  function showTip(e, html) {
    tip.innerHTML = html;
    tip.classList.add('on');
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 12, y = e.clientY + 12;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 12;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 12;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  const hideTip = () => tip.classList.remove('on');

  // ---------- formato ----------
  const dur = (m) => {
    m = Math.round(m || 0);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  };
  const pace = (v) => { const m = Math.floor(v), s = Math.round((v - m) * 60); return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`; };
  const fmt = (v, f) => v == null ? '–' : f === 'dur' ? dur(v) : f === 'pace' ? pace(v) : f === 'num2' ? v.toFixed(2) : f === 'num1' ? v.toFixed(1) : Math.round(v).toLocaleString('es-ES');
  const fdate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', opts);
  const sign = (n) => (n > 0 ? '+' : '') + n;

  function svg(w, h, cls) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', `0 0 ${w} ${h}`);
    if (cls) s.setAttribute('class', cls);
    return s;
  }
  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  // ---------- datos ----------
  let D;
  try {
    D = await (await fetch('data.json', { cache: 'no-cache' })).json();
  } catch (e) {
    $('sub').textContent = 'No hay datos todavía. Ejecuta scripts/sync.py.';
    return;
  }

  const famOf = {};
  D.activities.forEach((a) => (famOf[a.label] = a.family));
  const famColor = (label) => `var(--${famOf[label] || 'other'})`;

  $('year').textContent = D.year;
  document.title = `Entrenamiento ${D.year}`;
  const synced = new Date(D.generatedAt);
  $('sub').textContent = `Registro diario · sincronizado desde Garmin Connect · ${synced.toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
  if (D.demo) $('demo-banner').hidden = false;

  // ---------- tarjetas ----------
  const S = D.stats, T = D.yearTotals;
  const tiles = [
    [S.vo2max && S.vo2max.toFixed?.(1), '', 'VO₂ máx'],
    [S.restingHR, 'ppm', 'FC en reposo'],
    [S.sleepSeconds && dur(S.sleepSeconds / 60), '', 'Sueño anoche'],
    [S.sleepScore, '', 'Puntuación sueño'],
    [S.bodyBattery, '', 'Body Battery'],
    [T.activities, '', `Actividades ${D.year}`],
    [T.hours, 'h', 'Horas este año'],
    [T.km?.toLocaleString('es-ES'), 'km', 'Distancia este año'],
  ].filter((t) => t[0] != null && t[0] !== '');
  $('tiles').innerHTML = tiles.map(([v, u, l]) => `<div class="tile"><b>${esc(v)}${u ? `<span class="unit">${u}</span>` : ''}</b><small>${l}</small></div>`).join('');

  // ---------- heatmap ----------
  (function heatmap() {
    $('heat-title').textContent = `${T.activities} actividades en ${D.year}`;
    const jan1 = new Date(D.year, 0, 1);
    const start = new Date(jan1); start.setDate(jan1.getDate() - ((jan1.getDay() + 6) % 7));
    const end = new Date(D.year, 11, 31);
    const today = D.today;
    const C = 13, G = 3, L = 24, TOP = 18;
    const weeks = Math.ceil((end - start) / 864e5 / 7) + 1;
    const s = svg(L + weeks * C, TOP + 7 * C);
    const level = (m) => (m <= 0 ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 100 ? 3 : 4);
    DOW.forEach((d, i) => { if (i % 2 === 0) el('text', { x: 0, y: TOP + i * C + 10, class: 'axis' }, s).textContent = d; });
    let lastMonth = -1, sel = null;
    for (let d = new Date(start), i = 0; d <= end; d.setDate(d.getDate() + 1), i++) {
      if (d < jan1) continue;
      const w = Math.floor(i / 7), dow = i % 7;
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (d.getMonth() !== lastMonth) {
        el('text', { x: L + (w + (dow > 3 ? 1 : 0)) * C, y: 11, class: 'axis' }, s).textContent = MONTHS[d.getMonth()];
        lastMonth = d.getMonth();
      }
      const day = D.days[iso];
      const future = iso > today;
      const r = el('rect', {
        x: L + w * C, y: TOP + dow * C, width: C - G, height: C - G, rx: 2,
        fill: future ? 'transparent' : `var(--h${level(day?.min || 0)})`,
        stroke: future ? 'var(--line)' : 'none', class: future ? '' : 'cell',
      }, s);
      if (future) continue;
      const label = day ? `${day.n} ${day.n === 1 ? 'actividad' : 'actividades'} · ${dur(day.min)}` : 'Descanso';
      r.addEventListener('mousemove', (e) => showTip(e, `<b>${fdate(iso)}</b><br>${label}`));
      r.addEventListener('mouseleave', hideTip);
      const pick = () => {
        sel?.classList.remove('sel'); sel = r; r.classList.add('sel');
        const acts = D.activities.filter((a) => a.date === iso);
        $('day-detail').innerHTML = `<span class="when">${fdate(iso, { weekday: 'long', day: 'numeric', month: 'long' })}</span>` +
          (acts.length ? acts.map((a) => `<span class="muted">· ${esc(a.name)} ${dur(a.min)}${a.km ? ` · ${a.km.toFixed(1)} km` : ''}</span>`).join(' ') : '<span class="muted">Día de descanso</span>');
      };
      r.addEventListener('click', pick);
      if (iso === today) pick();
    }
    $('heatmap').appendChild(s);
    const sc = document.querySelector('.heat-scroll'); sc.scrollLeft = sc.scrollWidth;
  })();

  // ---------- carga ----------
  (function load() {
    const L = D.load, ser = L.series;
    $('form-pill').textContent = L.state;
    $('form-pill').style.color = { Fresco: 'var(--ctl)', Recuperado: 'var(--good)', Productivo: 'var(--z4)', Sobrecarga: 'var(--bad)' }[L.state];
    $('load-legend').innerHTML =
      `<span><i class="sw" style="background:var(--ctl)"></i>Forma <b>${L.ctl.toFixed(1)}</b></span>` +
      `<span><i class="sw" style="background:var(--atl)"></i>Fatiga <b>${L.atl.toFixed(1)}</b></span>` +
      `<span><i class="sw" style="background:var(--muted);opacity:.5"></i>Frescura <b>${sign(L.tsb.toFixed(1))}</b></span>` +
      `<span class="muted">forma ${L.ctlChange >= 0 ? '↑' : '↓'}${Math.abs(L.ctlChange)}% en 7 días</span>`;
    $('load-note').textContent = L.advice;

    const W = Math.max(300, $('load-chart').clientWidth || 900), H = W < 600 ? 200 : 230, P = { l: 34, r: 8, t: 10, b: 22 };
    const s = svg(W, H);
    const vals = ser.flatMap((d) => [d.ctl, d.atl, d.tsb]);
    let lo = Math.min(0, ...vals), hi = Math.max(...vals);
    const step = Math.max(5, Math.ceil((hi - lo) / 4 / 5) * 5);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const x = (i) => P.l + (i / (ser.length - 1)) * (W - P.l - P.r);
    const y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
    for (let v = lo; v <= hi; v += step) {
      el('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid', 'stroke-dasharray': v === 0 ? '' : '2 4' }, s);
      el('text', { x: P.l - 6, y: y(v) + 3, class: 'axis', 'text-anchor': 'end' }, s).textContent = v;
    }
    ser.forEach((d, i) => {
      if (d.date.endsWith('-01') && (W > 600 || +d.date.slice(5, 7) % 2)) el('text', { x: x(i), y: H - 6, class: 'axis' }, s).textContent = MONTHS[+d.date.slice(5, 7) - 1];
    });
    const bw = Math.max(1, (W - P.l - P.r) / ser.length - 0.5);
    ser.forEach((d, i) => {
      el('rect', { x: x(i) - bw / 2, y: Math.min(y(0), y(d.tsb)), width: bw, height: Math.abs(y(d.tsb) - y(0)),
        fill: d.tsb >= 0 ? 'var(--good)' : 'var(--bad)', opacity: 0.25 }, s);
    });
    const line = (k, c) => el('path', { d: ser.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(''),
      fill: 'none', stroke: c, 'stroke-width': 2, 'stroke-linejoin': 'round' }, s);
    line('atl', 'var(--atl)'); line('ctl', 'var(--ctl)');
    const guide = el('line', { y1: P.t, y2: H - P.b, stroke: 'var(--muted)', 'stroke-width': 1, opacity: 0 }, s);
    const hit = el('rect', { x: P.l, y: 0, width: W - P.l - P.r, height: H, fill: 'transparent' }, s);
    hit.addEventListener('mousemove', (e) => {
      const r = s.getBoundingClientRect();
      const i = Math.max(0, Math.min(ser.length - 1, Math.round(((e.clientX - r.left) / r.width * W - P.l) / (W - P.l - P.r) * (ser.length - 1))));
      const d = ser[i];
      guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i)); guide.setAttribute('opacity', 0.5);
      showTip(e, `<b>${fdate(d.date)}</b><br>Forma ${d.ctl} · Fatiga ${d.atl}<br>Frescura ${sign(d.tsb)} · Carga del día ${Math.round(d.load)}`);
    });
    hit.addEventListener('mouseleave', () => { hideTip(); guide.setAttribute('opacity', 0); });
    $('load-chart').appendChild(s);
  })();

  // ---------- tendencias ----------
  (function trends() {
    const G = D.trends.groups;
    const groups = [
      ['improving', '▲ Mejorando'], ['declining', '▼ Empeorando'], ['shifting', '◆ Cambio de deportes'], ['steady', '— Estable'],
    ];
    $('trends').innerHTML = groups.filter(([k]) => G[k].length).map(([k, title]) => `
      <div class="tgroup"><h3>${title}</h3>${G[k].map((r) => {
        const cls = k === 'improving' ? 'up' : k === 'declining' ? 'down' : r.pct > 0 ? 'up' : r.pct < 0 ? 'down' : 'flat';
        const cl = k === 'shifting' || k === 'steady' ? 'flat' : cls;
        const u = r.fmt === 'dur' ? '' : r.unit ? ` ${r.unit}` : '';
        return `<div class="trow"><span>${esc(r.label)}</span><span class="v">${fmt(r.prev, r.fmt)}→${fmt(r.cur, r.fmt)}${u}</span><span class="p ${cl}">${sign(r.pct)}%</span></div>`;
      }).join('')}</div>`).join('');
    $('trend-note').textContent = D.trends.verdict;
  })();

  // ---------- zonas ----------
  (function zones() {
    const Z = D.zones, weeks = D.weeks.filter((w) => w.zones.some((z) => z > 0)).slice(-16);
    $('zone-model').textContent = `${Z.model} · Z3 ${Z.cur[2]}%`;
    const W = Math.max(280, $('zone-chart').clientWidth || 440), H = 170, P = { l: 30, r: 4, t: 6, b: 20 };
    const s = svg(W, H);
    const max = Math.max(1, ...weeks.map((w) => w.zones.reduce((a, b) => a + b, 0)));
    const nice = Math.ceil(max / 60) * 60;
    const bw = (W - P.l - P.r) / Math.max(weeks.length, 1);
    const y = (v) => P.t + (1 - v / nice) * (H - P.t - P.b);
    for (let v = 0; v <= nice; v += nice / 2) {
      el('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid', 'stroke-dasharray': v ? '2 4' : '' }, s);
      el('text', { x: P.l - 5, y: y(v) + 3, class: 'axis', 'text-anchor': 'end' }, s).textContent = v ? `${v / 60}h` : '0';
    }
    weeks.forEach((w, i) => {
      let acc = 0;
      const g = el('g', {}, s);
      w.zones.forEach((m, z) => {
        if (!m) return;
        el('rect', { x: P.l + i * bw + 2, y: y(acc + m), width: bw - 4, height: y(acc) - y(acc + m), fill: `var(--z${z + 1})` }, g);
        acc += m;
      });
      if (i % 2 === weeks.length % 2 || weeks.length < 9) el('text', { x: P.l + i * bw + bw / 2, y: H - 5, class: 'axis', 'text-anchor': 'middle' }, s).textContent = `S${w.week}`;
      el('rect', { x: P.l + i * bw, y: 0, width: bw, height: H - P.b, fill: 'transparent' }, g);
      g.addEventListener('mousemove', (e) => showTip(e, `<b>Semana ${w.week}</b><br>${w.zones.map((m, z) => `Z${z + 1} ${dur(m)}`).join(' · ')}`));
      g.addEventListener('mouseleave', hideTip);
    });
    $('zone-chart').appendChild(s);
    $('zone-split').innerHTML = Z.cur.map((p, i) => `<div style="flex:${p};background:var(--z${i + 1})" title="Z${i + 1}">${p >= 7 ? `Z${i + 1} ${p}%` : ''}</div>`).join('');
    $('zone-split').insertAdjacentHTML('afterend', `<div class="zone-keys">${Z.cur.map((p, i) => `<span>Z${i + 1} ${p}% <span class="${Z.delta[i] > 0 ? 'up' : Z.delta[i] < 0 ? 'down' : 'flat'}">${Z.delta[i] ? sign(Z.delta[i]) : ''}</span></span>`).join('')}</div>`);
    $('zone-note').textContent = Z.note;
  })();

  // ---------- tirada larga ----------
  (function longRun() {
    const ws = D.weeks.filter((w) => w.longRun);
    if (!ws.length) { $('long-note').textContent = 'Aún no hay carreras este año.'; return; }
    const peak = ws.reduce((a, b) => (b.longRun.km > a.longRun.km ? b : a));
    $('long-peak').textContent = `pico ${peak.longRun.km.toFixed(1)} km · S${peak.week}`;
    const show = ws.slice(-20);
    const W = Math.max(280, $('long-chart').clientWidth || 440), H = 170, P = { l: 30, r: 4, t: 14, b: 20 };
    const s = svg(W, H);
    const max = Math.ceil(Math.max(...show.map((w) => w.longRun.km)) / 5) * 5;
    const bw = (W - P.l - P.r) / show.length;
    const y = (v) => P.t + (1 - v / max) * (H - P.t - P.b);
    for (let v = 0; v <= max; v += max / 2) {
      el('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid', 'stroke-dasharray': v ? '2 4' : '' }, s);
      el('text', { x: P.l - 5, y: y(v) + 3, class: 'axis', 'text-anchor': 'end' }, s).textContent = v;
    }
    show.forEach((w, i) => {
      const last = i === show.length - 1;
      const r = el('rect', { x: P.l + i * bw + 2, y: y(w.longRun.km), width: bw - 4, height: y(0) - y(w.longRun.km), rx: 2,
        fill: 'var(--run)', opacity: last ? 1 : 0.55 }, s);
      if (last) el('text', { x: P.l + i * bw + bw / 2, y: y(w.longRun.km) - 4, class: 'axis', 'text-anchor': 'middle' }, s).textContent = w.longRun.km.toFixed(1);
      if (i % 2 === show.length % 2 || show.length < 9) el('text', { x: P.l + i * bw + bw / 2, y: H - 5, class: 'axis', 'text-anchor': 'middle' }, s).textContent = `S${w.week}`;
      r.addEventListener('mousemove', (e) => showTip(e, `<b>Semana ${w.week}</b><br>${w.longRun.km.toFixed(1)} km · ${dur(w.longRun.min)} · ${w.longRun.pace}/km`));
      r.addEventListener('mouseleave', hideTip);
    });
    $('long-chart').appendChild(s);
    const a = show.at(-1).longRun.km, b = show.at(-2)?.longRun.km;
    const ch = b ? Math.round((a - b) / b * 100) : 0;
    const avg4 = show.slice(-5, -1).reduce((t, w) => t + w.longRun.km, 0) / Math.max(1, show.slice(-5, -1).length);
    $('long-note').textContent = a < avg4 * 0.75
      ? `La tirada larga ha bajado (${sign(ch)}% vs la anterior). Si es una descarga, perfecto; si no, recupérala poco a poco.`
      : a > avg4 * 1.15
        ? `Tirada larga en subida (${sign(ch)}% vs la anterior). Intenta no subir más de un 10–15% por semana.`
        : `Tirada larga estable en torno a ${avg4.toFixed(1)} km.`;
  })();

  // ---------- composición corporal ----------
  (function body() {
    const B = D.body;
    if (!B) return;
    $('body-card').hidden = false;
    const items = [['weight', 'Peso', 'kg', 'down'], ['bodyFat', 'Grasa corporal', '%', 'down'], ['muscle', 'Masa muscular', 'kg', 'up']];
    $('body').innerHTML = items.filter(([k]) => B[k]?.cur != null).map(([k, label, u, better]) => {
      const d = B[k].delta;
      const cls = d == null || d === 0 ? 'flat' : (d > 0) === (better === 'up') ? 'up' : 'down';
      const pts = B.series.filter((p) => p[k] != null);
      const vs = pts.map((p) => p[k]), lo = Math.min(...vs), hi = Math.max(...vs) || 1;
      const path = pts.map((p, i) => `${i ? 'L' : 'M'}${(i / Math.max(1, pts.length - 1) * 200).toFixed(1)},${(34 - (p[k] - lo) / (hi - lo || 1) * 30).toFixed(1)}`).join('');
      return `<div class="bstat"><b>${B[k].cur}<span class="unit">${u}</span> <span class="badge ${cls}">${d != null ? sign(d) : ''}</span></b><small>${label}</small>
        <svg viewBox="0 0 200 36" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="var(--muted)" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg></div>`;
    }).join('');
    $('body-note').textContent = B.note || '';
  })();

  // ---------- semanas ----------
  (function weeks() {
    const ws = D.weeks.slice().reverse();
    let shown = 0;
    const render = () => {
      const html = ws.slice(shown, shown + 8).map((w, idx) => {
        const i = shown + idx;
        const prev = ws[i + 1];
        const ch = prev && prev.min ? Math.round((w.min - prev.min) / prev.min * 100) : null;
        const end = new Date(w.start + 'T12:00:00'); end.setDate(end.getDate() + 6);
        const tot = Object.values(w.types).reduce((a, b) => a + b, 0) || 1;
        return `<div class="week">
          <div class="wk"><b>S${w.week}${i === 0 ? ' <small>actual</small>' : ''}</b><small>${fdate(w.start, { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</small></div>
          <div><div class="wbar">${Object.entries(w.types).map(([t, m]) => `<div style="flex:${m / tot};background:${famColor(t)}" title="${esc(t)} ${dur(m)}"></div>`).join('')}</div>
            <div class="wtypes">${w.sessions ? Object.entries(w.types).slice(0, 4).map(([t, m]) => `<span><i class="sw" style="background:${famColor(t)}"></i>${esc(t)} ${dur(m)}</span>`).join('') : 'Sin actividad'}
            ${ch != null ? `<span class="badge ${ch >= 0 ? 'up' : 'down'}">${sign(ch)}%</span>` : ''}</div></div>
          <div class="wnums"><span>${dur(w.min)}<small>${w.sessions} ses.</small></span><span>${w.km.toFixed(1)}<small>km</small></span><span>${w.elev}<small>m ↑ · ${w.hr ?? '–'} ppm</small></span></div>
        </div>`;
      }).join('');
      $('weeks').insertAdjacentHTML('beforeend', html);
      shown += 8;
      $('weeks-more').hidden = shown >= ws.length;
    };
    $('weeks-more').onclick = render;
    render();
  })();

  // ---------- actividades ----------
  (function acts() {
    const counts = {};
    D.activities.forEach((a) => (counts[a.label] = (counts[a.label] || 0) + 1));
    const labels = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    let filter = null, shown = 0;
    $('filters').innerHTML = [`<button class="on" data-f="">Todas</button>`, ...labels.map((l) => `<button data-f="${esc(l)}"><i class="sw" style="background:${famColor(l)}"></i>${esc(l)} <span class="muted">${counts[l]}</span></button>`)].join('');
    $('filters').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      $('filters').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      filter = b.dataset.f || null; shown = 0; $('acts').innerHTML = ''; render();
    };
    const mainZone = (z) => z ? z.indexOf(Math.max(...z)) + 1 : null;
    let lastWeek = null;
    function render() {
      const list = D.activities.filter((a) => !filter || a.label === filter);
      $('act-count').textContent = `${list.length} en total`;
      if (shown === 0) lastWeek = null;
      const html = list.slice(shown, shown + 25).map((a) => {
        const d = new Date(a.date + 'T12:00:00'), mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const wk = mon.toISOString().slice(0, 10);
        let sep = '';
        if (wk !== lastWeek) { lastWeek = wk; const e = new Date(mon); e.setDate(mon.getDate() + 6); sep = `<div class="wk-sep">${fdate(wk, { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</div>`; }
        const z = mainZone(a.zones);
        const meta = [fdate(a.date), a.label, a.km ? (a.family === 'swim' ? `${Math.round(a.km * 1000)} m` : `${a.km.toFixed(1)} km`) : null,
          a.family === 'run' && a.km > 0.5 ? `${pace(a.min / a.km)}/km` : null, a.hr ? `${a.hr} ppm` : null].filter(Boolean).join(' · ');
        return `${sep}<div class="act"><div class="stripe" style="background:var(--${a.family})"></div>
          <div><div class="t">${esc(a.name)}${z ? `<span class="zchip" style="background:var(--z${z})">Z${z}</span>` : ''}</div><div class="m">${meta}</div></div>
          <div class="r">${dur(a.min)}${a.elev ? `<small>${a.elev} m ↑</small>` : a.kcal ? `<small>${a.kcal} kcal</small>` : ''}</div></div>`;
      }).join('');
      $('acts').insertAdjacentHTML('beforeend', html);
      shown += 25;
      $('acts-more').hidden = shown >= list.length;
    }
    $('acts-more').onclick = render;
    render();
  })();
})();
