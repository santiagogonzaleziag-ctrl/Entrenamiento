(async function () {
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- tooltip ----------
  const tip = $('tip');
  function showTip(e, html) {
    tip.innerHTML = html;
    tip.classList.add('on');
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  }
  const hideTip = () => tip.classList.remove('on');

  // ---------- formato ----------
  const dur = (m) => { m = Math.round(m || 0); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
  const pace = (v) => { const m = Math.floor(v), s = Math.round((v - m) * 60); return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`; };
  const fmt = (v, f) => v == null ? '–' : f === 'dur' ? dur(v) : f === 'pace' ? pace(v) : f === 'num2' ? v.toFixed(2) : f === 'num1' ? v.toFixed(1) : Math.round(v).toLocaleString('es-ES');
  const fdate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', opts);
  const sign = (n) => (n > 0 ? '+' : '') + n;
  const hm = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function svg(w, h) { const s = el('svg', { viewBox: `0 0 ${w} ${h}` }); return s; }
  let gid = 0;
  function gradient(s, color, o1 = 0.35, o2 = 0) {
    const id = 'g' + (++gid);
    let defs = s.querySelector('defs') || el('defs', {}, s);
    const g = el('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': o1 }, g);
    el('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': o2 }, g);
    return `url(#${id})`;
  }
  function niceRange(lo, hi, ticks = 4) {
    if (lo === hi) { lo -= 1; hi += 1; }
    const raw = (hi - lo) / ticks, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
  }
  function countUp(node, to, decimals = 0, suffix = '') {
    if (to == null || isNaN(to)) { node.textContent = '–'; return; }
    const put = (v) => (node.textContent = v.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix);
    if (reduce) return put(to);
    const t0 = performance.now(), D = 900;
    const step = (t) => { const k = Math.min(1, (t - t0) / D), e = 1 - (1 - k) ** 3; put(to * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  /**
   * Gráfica genérica con eje X por índice.
   * o = { n, h, lines:[{v, color, w, area, dash, glow, dot}], bars:{v, color, frac, own}, band:{lo, hi},
   *       xLabel(i), yFmt, tip(i), min, max, invert, guides:[{y,label}] }
   */
  function chart(host, o) {
    const W = Math.max(280, host.clientWidth || 600), H = o.h || 200, P = { l: 38, r: 12, t: 12, b: 24 };
    const s = svg(W, H);
    const n = o.n;
    const vals = [];
    (o.lines || []).forEach((l) => l.v.forEach((v) => v != null && vals.push(v)));
    if (o.band) [...o.band.lo, ...o.band.hi].forEach((v) => v != null && vals.push(v));
    if (o.bars && !o.bars.own) o.bars.v.forEach((v) => v != null && vals.push(v));
    (o.guides || []).forEach((g) => vals.push(g.y));
    let lo = o.min ?? Math.min(...vals), hi = o.max ?? Math.max(...vals);
    const r = niceRange(lo, hi);
    if (o.min == null) lo = r.lo; if (o.max == null) hi = r.hi;
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const x = (i) => P.l + (o.cat ? ((i + 0.5) / n) * iw : n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => P.t + (o.invert ? (v - lo) / (hi - lo) : 1 - (v - lo) / (hi - lo)) * ih;
    for (let v = lo; v <= hi + 1e-9; v += r.step) {
      el('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid', 'stroke-dasharray': '2 5' }, s);
      el('text', { x: P.l - 7, y: y(v) + 3.5, class: 'axis', 'text-anchor': 'end' }, s).textContent = o.yFmt ? o.yFmt(v) : +v.toFixed(2);
    }
    if (o.xLabel) for (let i = 0; i < n; i++) { const t = o.xLabel(i); if (t) el('text', { x: x(i), y: H - 6, class: 'axis', 'text-anchor': 'middle' }, s).textContent = t; }

    if (o.bars) {
      const b = o.bars, bw = Math.max(1.5, (iw / n) * (o.cat ? 0.72 : 1) - (o.cat ? 0 : n > 60 ? 1 : 3));
      const bmax = Math.max(1, ...b.v.filter((v) => v != null));
      const by = (v) => b.own ? P.t + ih - (v / bmax) * ih * (b.frac || 0.3) : y(v);
      const base = b.own ? P.t + ih : y(Math.max(lo, 0));
      b.v.forEach((v, i) => {
        if (v == null || v === 0) return;
        const top = by(v);
        el('rect', { x: x(i) - bw / 2, y: Math.min(top, base), width: bw, height: Math.max(1, Math.abs(base - top)), rx: Math.min(3, bw / 3),
          fill: typeof b.color === 'function' ? b.color(i, v) : b.color, opacity: b.opacity ?? 1, class: reduce ? '' : 'grow',
          style: reduce ? null : `animation-delay:${Math.min(600, i * 6)}ms` }, s);
      });
    }
    if (o.band) {
      const pts = [];
      o.band.hi.forEach((v, i) => v != null && pts.push([x(i), y(v)]));
      const back = [];
      o.band.lo.forEach((v, i) => v != null && back.push([x(i), y(v)]));
      if (pts.length > 1) el('path', { d: 'M' + [...pts, ...back.reverse()].map((p) => p.map((c) => c.toFixed(1)).join(',')).join('L') + 'Z', fill: o.band.color, opacity: 0.12 }, s);
    }
    (o.guides || []).forEach((g) => {
      el('line', { x1: P.l, x2: W - P.r, y1: y(g.y), y2: y(g.y), stroke: g.color || 'var(--muted)', 'stroke-dasharray': '4 4', opacity: 0.6 }, s);
      if (g.label) el('text', { x: W - P.r, y: y(g.y) - 5, class: 'axis', 'text-anchor': 'end' }, s).textContent = g.label;
    });
    (o.lines || []).forEach((l) => {
      let d = '', pen = false, first = null, last = null;
      l.v.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true;
        if (first == null) first = i; last = i;
      });
      if (!d) return;
      if (l.area && first != null) {
        const base = o.invert ? P.t : P.t + ih;
        el('path', { d: `${d}L${x(last).toFixed(1)},${base}L${x(first).toFixed(1)},${base}Z`, fill: gradient(s, l.color, o.invert ? 0 : 0.32, o.invert ? 0.32 : 0) }, s);
      }
      el('path', { d, fill: 'none', stroke: l.color, 'stroke-width': l.w || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'stroke-dasharray': l.dash, pathLength: l.dash ? null : 1, class: l.dash || reduce ? '' : 'draw',
        style: l.glow ? `filter: drop-shadow(0 0 6px ${l.color})` : null }, s);
      if (l.dot && last != null) {
        el('circle', { cx: x(last), cy: y(l.v[last]), r: 7, fill: l.color, opacity: 0.25 }, s);
        el('circle', { cx: x(last), cy: y(l.v[last]), r: 3.5, fill: l.color }, s);
      }
    });
    if (o.tip) {
      const guide = el('line', { y1: P.t, y2: P.t + ih, stroke: 'var(--muted)', 'stroke-width': 1, opacity: 0 }, s);
      const hit = el('rect', { x: P.l, y: 0, width: iw, height: H, fill: 'transparent' }, s);
      const move = (e) => {
        const rc = s.getBoundingClientRect();
        const px = ((e.clientX - rc.left) / rc.width) * W;
        const i = Math.max(0, Math.min(n - 1, o.cat ? Math.floor(((px - P.l) / iw) * n) : Math.round(((px - P.l) / iw) * (n - 1))));
        const html = o.tip(i);
        if (!html) return;
        guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i)); guide.setAttribute('opacity', 0.5);
        showTip(e, html);
      };
      hit.addEventListener('mousemove', move);
      hit.addEventListener('mouseleave', () => { hideTip(); guide.setAttribute('opacity', 0); });
    }
    host.innerHTML = '';
    host.appendChild(s);
  }
  function spark(values, color) {
    const v = values.filter((x) => x != null);
    if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v), n = values.length;
    let d = '', pen = false;
    values.forEach((val, i) => {
      if (val == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${((i / (n - 1)) * 100).toFixed(1)},${(26 - ((val - lo) / (hi - lo || 1)) * 22).toFixed(1)}`; pen = true;
    });
    return `<svg viewBox="0 0 100 28" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }
  const monthTick = (dates) => (i) => {
    const d = dates[i];
    if (!d || !d.endsWith('-01')) return i === 0 && dates.length < 100 ? fdate(d, { day: 'numeric', month: 'short' }) : null;
    return MONTHS[+d.slice(5, 7) - 1];
  };
  const everyNth = (dates, k) => (i) => (i % k === 0 ? fdate(dates[i], { day: 'numeric', month: 'short' }) : null);

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
  const S = D.stats, T = D.yearTotals, L = D.load, R = D.recovery, PG = D.progress, HB = D.habits;

  $('year').textContent = D.year;
  document.title = `Entrenamiento ${D.year}`;
  const synced = new Date(D.generatedAt);
  $('sub').textContent = `Sincronizado con Garmin · ${synced.toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
  if (D.demo) $('demo-banner').hidden = false;

  // ---------- nav activa ----------
  const links = [...document.querySelectorAll('.nav a')];
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id));
    });
  }, { rootMargin: '-40% 0px -55% 0px' });
  links.forEach((a) => { const t = document.querySelector(a.getAttribute('href')); if (t) io.observe(t); });

  // ---------- hero ----------
  const STATE_COLOR = { Fresco: 'var(--recovery)', Recuperado: 'var(--good)', Productivo: 'var(--warn)', Sobrecarga: 'var(--bad)' };
  $('state').textContent = L.state;
  $('state').style.color = STATE_COLOR[L.state];
  $('advice').textContent = L.advice;
  $('status-nums').innerHTML = [
    ['ctl', 'Forma', 'var(--recovery)', `${L.ctlChange >= 0 ? '↑' : '↓'} ${Math.abs(L.ctlChange)}% en 7 días`],
    ['atl', 'Fatiga', 'var(--effort)', 'media 7 días'],
    ['tsb', 'Frescura', L.tsb >= 0 ? 'var(--good)' : 'var(--bad)', 'forma − fatiga'],
  ].map(([k, l, c, sm]) => `<div class="snum"><span>${l}</span><b data-k="${k}" style="color:${c}"></b><small>${sm}</small></div>`).join('');
  document.querySelectorAll('.snum b').forEach((b) => countUp(b, L[b.dataset.k], 1));

  const rd = R?.days || [];
  const lastN = (k, n = 30) => rd.slice(-n).map((d) => d[k] ?? null);
  const vo2Series = (PG?.vo2 || []).map((p) => p.v);
  const metrics = [
    { l: 'VO₂ máx', v: S.vo2max, d: 1, c: 'var(--progress)', sp: vo2Series.slice(-30), sub: PG?.vo2?.length > 1 ? `${sign(+(vo2Series.at(-1) - vo2Series[0]).toFixed(1))} este año` : '' },
    { l: 'VFC anoche', v: S.hrv, u: 'ms', c: 'var(--recovery)', sp: lastN('hrv'), sub: R?.hrv?.avg7 ? `media 7 d: ${R.hrv.avg7}` : '' },
    { l: 'FC reposo', v: S.restingHR, u: 'ppm', c: 'var(--bad)', sp: lastN('rhr'), sub: R?.rhr?.avg7 ? `media 7 d: ${R.rhr.avg7}` : '' },
    { l: 'Sueño', v: S.sleepSeconds ? S.sleepSeconds / 3600 : null, hm: true, c: 'var(--recovery)', sp: lastN('sleepH'), sub: S.sleepScore ? `puntuación ${S.sleepScore}` : '' },
    { l: `Horas ${D.year}`, v: T.hours, u: 'h', c: 'var(--effort)', sub: `${T.activities} sesiones · ${T.km.toLocaleString('es-ES')} km` },
  ].filter((m) => m.v != null);
  $('strip').innerHTML = metrics.map((m, i) => `<div class="metric"><span>${m.l}</span><b data-i="${i}"></b><em>${esc(m.sub)}</em>${m.sp ? spark(m.sp, m.c) : ''}</div>`).join('');
  document.querySelectorAll('.metric b').forEach((b) => {
    const m = metrics[+b.dataset.i];
    if (m.hm) { b.innerHTML = hm(m.v).replace(/(\d+)h (\d+)m/, '$1<small>h</small> $2<small>m</small>'); return; }
    const span = document.createElement('span'); span.style.cssText = 'font:inherit;color:inherit;letter-spacing:0;text-transform:none';
    b.appendChild(span);
    if (m.u) b.insertAdjacentHTML('beforeend', `<small>${m.u}</small>`);
    countUp(span, m.v, m.d || 0);
  });

  // ---------- objetivos ----------
  await (async function goals() { try {
    let cfg;
    try { cfg = await (await fetch('objetivos.json', { cache: 'no-cache' })).json(); } catch (e) { return; }
    const races = (cfg.carreras || []).filter((r) => r.fecha && r.objetivo).sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (!races.length) return;
    $('objetivos').hidden = false;
    const pad = (n) => String(n).padStart(2, '0');
    const toSecs = (t) => String(t).replace(/[^\d:]/g, '').split(':').reduce((a, v) => a * 60 + +v, 0);
    const clock = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`; };
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const preds = Object.fromEntries((PG?.predictions || []).map((p) => [p.key, p.secs]));
    const hist = PG?.predHistory || [];
    const label = (st) => ({ ok: ['En objetivo', 'var(--good)'], near: ['A tiro', 'var(--warn)'], far: ['Lejos', 'var(--bad)'], done: ['Terminada', 'var(--muted)'] }[st]);

    const cards = races.map((r, idx) => {
      const dist = r.distancia_km || 21.0975, target = toSecs(r.objetivo);
      const tPace = target / dist / 60;
      const days = Math.round((new Date(r.fecha + 'T12:00:00') - new Date(todayIso + 'T12:00:00')) / 864e5);
      const dateTxt = fdate(r.fecha, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const proj = preds[r.prediccion || 'half'];

      if (days < 0 || (days === 0 && D.activities.some((a) => a.date === r.fecha && a.family === 'run' && Math.abs(a.km - dist) < 1.5))) {
        const act = D.activities.find((a) => a.date === r.fecha && a.family === 'run' && Math.abs(a.km - dist) < 1.5);
        const res = act ? act.min * 60 : null;
        const [lt, lc] = label('done');
        return `<article class="race done"><div><span class="chip" style="color:${lc}">${lt}</span><h3>${esc(r.nombre)}</h3><div class="when">${dateTxt}</div></div>
          <div class="vs"><div><span>Objetivo</span><b>${clock(target)}</b><small>${pace(tPace)}/km</small></div>
          <div><span>Resultado</span><b style="color:${res && res < target ? 'var(--good)' : 'var(--ink)'}">${res ? clock(res) : '–'}</b><small>${res ? pace(res / act.km / 60) + '/km' : 'sin actividad ese día'}</small></div></div>
          <p class="gap">${res ? (res < target ? `<strong class="up">¡Objetivo conseguido!</strong> ${clock(target - res)} por debajo.` : `<strong>Te quedaste a ${clock(res - target)}.</strong> A por la siguiente.`) : 'No se encontró una carrera de esa distancia ese día.'}</p></article>`;
      }

      let st = 'far', gapHtml = '<p class="gap muted">Garmin aún no tiene una proyección para esta distancia. Haz alguna carrera con pulso para que la calcule.</p>';
      if (proj) {
        const gap = proj - target, perKm = gap / dist;
        st = gap < 0 ? 'ok' : gap <= 90 ? 'near' : 'far';
        const perWeek = days >= 7 ? Math.round(gap / (days / 7)) : null;
        gapHtml = gap < 0
          ? `<p class="gap"><strong class="up">Tu proyección ya baja del objetivo</strong> por ${clock(-gap)} (${Math.abs(perKm).toFixed(1)} s/km de margen). Mantén el bloque y llega fresco.</p>`
          : `<p class="gap"><strong class="${st === 'near' ? '' : 'down'}" style="${st === 'near' ? 'color:var(--warn)' : ''}">Te faltan ${clock(gap)}</strong>, unos ${perKm.toFixed(1)} s/km.${perWeek ? ` Eso es mejorar unos ${perWeek} s de proyección por semana hasta la carrera.` : ''}</p>`;
      }
      const [lt, lc] = label(st);
      const cd = days === 0 ? '¡Hoy!' : days === 1 ? 'Mañana' : days;
      const cdSub = days >= 7 ? `${Math.floor(days / 7)} ${Math.floor(days / 7) === 1 ? 'semana' : 'semanas'}${days % 7 ? ` y ${days % 7} ${days % 7 === 1 ? 'día' : 'días'}` : ''}` : '';
      return `<article class="race">
        <div><span class="chip" style="color:${lc}">${lt}</span><h3>${esc(r.nombre)}</h3><div class="when">${dateTxt}</div>
          <div class="cd"><b>${cd}</b>${typeof cd === 'number' ? `<span>${days === 1 ? 'día' : 'días'}</span><small>${cdSub}</small>` : ''}</div></div>
        <div><div class="vs"><div><span>Objetivo · sub</span><b style="color:var(--gold)">${clock(target)}</b><small>${pace(tPace)}/km</small></div>
          <div><span>Proyección actual</span><b style="color:var(--progress)">${proj ? clock(proj) : '–'}</b><small>${proj ? pace(proj / dist / 60) + '/km' : 'sin datos'}</small></div></div>
          ${gapHtml}<div class="gauge" id="gauge-${idx}"></div></div>
        <div class="mini"><div class="ph"><h3 style="font-size:14px;letter-spacing:.1em">Proyección vs objetivo</h3></div><div class="chart" id="goal-chart-${idx}"></div></div>
      </article>`;
    });
    $('races').innerHTML = cards.join('');

    races.forEach((r, idx) => {
      const dist = r.distancia_km || 21.0975, target = toSecs(r.objetivo), proj = preds[r.prediccion || 'half'];
      const g = $(`gauge-${idx}`);
      if (g && proj) {
        const tP = target / dist, pP = proj / dist; // s/km
        const lo = Math.min(tP, pP) - 6, hi = Math.max(tP, pP) + 6;
        const W = 400, H = 58, x = (v) => 10 + ((hi - v) / (hi - lo)) * (W - 20);
        const s = svg(W, H);
        el('line', { x1: 10, x2: W - 10, y1: 30, y2: 30, stroke: 'var(--line)', 'stroke-width': 6, 'stroke-linecap': 'round' }, s);
        el('line', { x1: x(pP), x2: x(tP), y1: 30, y2: 30, stroke: pP <= tP ? 'var(--good)' : 'var(--warn)', 'stroke-width': 6, 'stroke-linecap': 'round', opacity: 0.6 }, s);
        el('line', { x1: x(tP), x2: x(tP), y1: 18, y2: 42, stroke: 'var(--gold)', 'stroke-width': 3 }, s);
        el('text', { x: x(tP), y: 12, class: 'axis', 'text-anchor': 'middle', style: 'fill:var(--gold)' }, s).textContent = `objetivo ${pace(tP / 60)}`;
        el('circle', { cx: x(pP), cy: 30, r: 7, fill: 'var(--progress)', style: 'filter: drop-shadow(0 0 6px var(--progress))' }, s);
        el('text', { x: x(pP), y: 56, class: 'axis', 'text-anchor': 'middle', style: 'fill:var(--progress)' }, s).textContent = `ahora ${pace(pP / 60)}`;
        el('text', { x: 10, y: 56, class: 'axis' }, s).textContent = '← más lento';
        el('text', { x: W - 10, y: 56, class: 'axis', 'text-anchor': 'end' }, s).textContent = 'más rápido →';
        g.appendChild(s);
      }
      const host = $(`goal-chart-${idx}`);
      if (!host) return;
      const key = r.prediccion || 'half';
      const pts = hist.filter((h) => h[key]);
      if (pts.length >= 2) {
        chart(host, {
          n: pts.length, h: 170, invert: true, yFmt: (v) => clock(v),
          lines: [{ v: pts.map((p) => p[key]), color: 'var(--progress)', w: 2.4, area: true, glow: true, dot: true }],
          guides: [{ y: target, label: `objetivo ${clock(target)}`, color: 'var(--gold)' }],
          xLabel: (i) => (i === 0 || i === pts.length - 1 ? fdate(pts[i].date, { day: 'numeric', month: 'short' }) : null),
          tip: (i) => `<b>${fdate(pts[i].date)}</b><br>Proyección ${clock(pts[i][key])}<br>${pts[i][key] <= target ? 'por debajo' : 'a ' + clock(pts[i][key] - target)} del objetivo`,
        });
      } else {
        host.innerHTML = '<p class="note">La gráfica se irá dibujando a partir de hoy: cada día se guarda tu proyección para ver cómo se acerca al objetivo.</p>';
      }
    });
  } catch (err) { console.error('Objetivos:', err); } })();

  // ---------- heatmap ----------
  (function heatmap() {
    $('heat-title').textContent = `${T.activities} actividades`;
    const jan1 = new Date(D.year, 0, 1);
    const start = new Date(jan1); start.setDate(jan1.getDate() - ((jan1.getDay() + 6) % 7));
    const end = new Date(D.year, 11, 31);
    const C = 14, G = 3, Lp = 22, TOP = 18;
    const weeks = Math.ceil((end - start) / 864e5 / 7) + 1;
    const s = svg(Lp + weeks * C, TOP + 7 * C);
    const level = (m) => (m <= 0 ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 100 ? 3 : 4);
    DOW.forEach((d, i) => { if (i % 2 === 0) el('text', { x: 0, y: TOP + i * C + 10, class: 'axis' }, s).textContent = d; });
    let lastMonth = -1, sel = null;
    for (let d = new Date(start), i = 0; d <= end; d.setDate(d.getDate() + 1), i++) {
      if (d < jan1) continue;
      const w = Math.floor(i / 7), dow = i % 7;
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (d.getMonth() !== lastMonth) { el('text', { x: Lp + (w + (dow > 3 ? 1 : 0)) * C, y: 11, class: 'axis' }, s).textContent = MONTHS[d.getMonth()]; lastMonth = d.getMonth(); }
      const day = D.days[iso], future = iso > D.today;
      const lv = level(day?.min || 0);
      const r = el('rect', { x: Lp + w * C, y: TOP + dow * C, width: C - G, height: C - G, rx: 3,
        fill: future ? 'transparent' : `var(--h${lv})`, stroke: future ? 'var(--line)' : null, class: future ? null : 'cell',
        style: lv === 4 ? 'filter: drop-shadow(0 0 3px var(--effort))' : null }, s);
      if (future) continue;
      const label = day ? `${day.n} ${day.n === 1 ? 'actividad' : 'actividades'} · ${dur(day.min)}` : 'Descanso';
      r.addEventListener('mousemove', (e) => showTip(e, `<b>${fdate(iso)}</b><br>${label}`));
      r.addEventListener('mouseleave', hideTip);
      const pick = () => {
        sel?.classList.remove('sel'); sel = r; r.classList.add('sel');
        const acts = D.activities.filter((a) => a.date === iso);
        $('day-detail').innerHTML = `<b>${fdate(iso, { weekday: 'long', day: 'numeric', month: 'long' })}</b>` +
          (acts.length ? acts.map((a) => `${esc(a.name)} · ${dur(a.min)}${a.km ? ` · ${a.km.toFixed(1)} km` : ''}`).join('  ·  ') : 'Día de descanso');
      };
      r.addEventListener('click', pick);
      if (iso === D.today) pick();
    }
    $('heatmap').appendChild(s);
    const sc = document.querySelector('.heat-scroll'); sc.scrollLeft = sc.scrollWidth;
  })();

  // ---------- carga ----------
  (function load() {
    const ser = L.series, dates = ser.map((d) => d.date);
    $('form-chip').textContent = L.state;
    $('form-chip').style.color = STATE_COLOR[L.state];
    $('load-legend').innerHTML =
      `<span><i class="sw" style="background:var(--recovery)"></i>Forma<b>${L.ctl.toFixed(1)}</b></span>` +
      `<span><i class="sw" style="background:var(--effort)"></i>Fatiga<b>${L.atl.toFixed(1)}</b></span>` +
      `<span><i class="sw" style="background:var(--good);opacity:.5"></i>Frescura<b>${sign(L.tsb.toFixed(1))}</b></span>`;
    chart($('load-chart'), {
      n: ser.length, h: 250,
      bars: { v: ser.map((d) => d.tsb), color: (i, v) => (v >= 0 ? 'var(--good)' : 'var(--bad)'), opacity: 0.28 },
      lines: [{ v: ser.map((d) => d.atl), color: 'var(--effort)', w: 1.6 }, { v: ser.map((d) => d.ctl), color: 'var(--recovery)', w: 2.6, area: true, glow: true, dot: true }],
      xLabel: monthTick(dates),
      tip: (i) => { const d = ser[i]; return `<b>${fdate(d.date)}</b><br>Forma ${d.ctl} · Fatiga ${d.atl}<br>Frescura ${sign(d.tsb)} · Carga ${Math.round(d.load)}`; },
    });
  })();

  // ---------- progreso ----------
  (function prog() {
    if (!PG) { $('progreso').hidden = true; return; }
    $('prog-insights').innerHTML = PG.insights.map((t) => `<li>${esc(t)}</li>`).join('');
    $('preds').innerHTML = PG.predictions.map((p) => {
      const d = p.delta;
      const dh = d != null && Math.abs(d) >= 1 ? `<span class="d ${d < 0 ? 'up' : 'down'}">${d < 0 ? '−' : '+'}${Math.abs(Math.round(d))} s</span>` : '';
      return `<div class="pred"><span>${p.label}</span><b>${p.time}</b><small>${p.pace}/km${dh}</small></div>`;
    }).join('');
    if (!PG.predictions.length) { $('preds').hidden = true; $('preds-head').hidden = true; }

    const wk = {};
    PG.vo2.forEach((p) => { const d = new Date(p.date + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); wk[d.toISOString().slice(0, 10)] = p; });
    const v = Object.values(wk);
    if (v.length) {
      $('vo2-now').textContent = (S.vo2max || v.at(-1).v).toFixed?.(1) ?? v.at(-1).v;
      const dates = v.map((p) => p.date);
      chart($('vo2-chart'), {
        n: v.length, h: 190, lines: [{ v: v.map((p) => p.v), color: 'var(--progress)', w: 2.4, area: true, glow: true, dot: true }],
        xLabel: (i) => { const m = dates[i].slice(5, 7); return i === 0 || dates[i - 1].slice(5, 7) !== m ? MONTHS[+m - 1] : null; },
        tip: (i) => `<b>${fdate(dates[i])}</b><br>VO₂ máx ${v[i].v}`,
      });
    } else $('vo2-chart').innerHTML = '<p class="note">Tu reloj aún no ha estimado el VO₂ máx en carreras.</p>';

    const e = PG.efficiency;
    $('eff-title').textContent = `Ritmo a ${PG.refHr} ppm`;
    if (e.length >= 2) {
      chart($('eff-chart'), {
        n: e.length, h: 190, invert: true, cat: true, yFmt: (x) => pace(x),
        lines: [{ v: e.map((m) => m.pace), color: 'var(--recovery)', w: 2.4, glow: true, dot: true }],
        bars: null, xLabel: (i) => e[i].label,
        tip: (i) => `<b>${e[i].label}</b><br>${pace(e[i].pace)}/km a ${PG.refHr} ppm<br>${e[i].n} carreras`,
      });
    } else $('eff-chart').innerHTML = '<p class="note">Hacen falta carreras con pulso de al menos dos meses.</p>';
  })();

  // ---------- recuperación ----------
  (function rec() {
    if (!R) return;
    $('recuperacion').hidden = false;
    const c = { 'Óptima': 'var(--good)', Normal: 'var(--recovery)', 'Atención': 'var(--warn)' }[R.state];
    $('rec-chip').textContent = R.state; $('rec-chip').style.color = c;
    $('rec-note').textContent = R.note;
    const stat = (label, o, fmtv, better, color) => {
      if (!o || o.avg7 == null) return '';
      const p = o.pct;
      const cls = p == null || Math.abs(p) < 2 ? 'flat' : (p > 0) === (better === 'up') ? 'up' : 'down';
      return `<div class="metric"><span>${label}</span><b style="color:${color}">${fmtv(o.avg7)}</b><em>media 7 d · <span class="${cls}" style="font:inherit;letter-spacing:0;text-transform:none">${p != null ? sign(p) + '%' : ''}</span> vs 30 d</em></div>`;
    };
    $('rec-stats').innerHTML = [
      stat('VFC', R.hrv, (v) => `${Math.round(v)}<small>ms</small>`, 'up', 'var(--recovery)'),
      stat('FC reposo', R.rhr, (v) => `${Math.round(v)}<small>ppm</small>`, 'down', 'var(--ink)'),
      stat('Sueño', R.sleepH, (v) => hm(v).replace(/(\d+)h (\d+)m/, '$1<small>h</small> $2<small>m</small>'), 'up', 'var(--ink)'),
      stat('Recarga nocturna', R.bb, (v) => `+${Math.round(v)}<small>BB</small>`, 'up', 'var(--ink)'),
    ].join('');

    const days = R.days, dates = days.map((d) => d.date);
    const avg7 = days.map((d, i) => {
      const w = days.slice(Math.max(0, i - 6), i + 1).map((x) => x.hrv).filter((x) => x != null);
      return w.length >= 3 ? w.reduce((a, b) => a + b, 0) / w.length : null;
    });
    if (days.some((d) => d.hrv != null)) {
      chart($('hrv-chart'), {
        n: days.length, h: 230,
        band: { lo: days.map((d) => d.hrvLow ?? null), hi: days.map((d) => d.hrvHigh ?? null), color: 'var(--recovery)' },
        bars: { v: days.map((d) => d.load || 0), color: 'var(--effort)', own: true, frac: 0.28, opacity: 0.45 },
        lines: [{ v: days.map((d) => d.hrv ?? null), color: 'var(--recovery)', w: 1.2, dash: '0' }, { v: avg7, color: 'var(--recovery)', w: 2.6, glow: true, dot: true }],
        xLabel: everyNth(dates, Math.ceil(days.length / 6)),
        tip: (i) => { const d = days[i]; return `<b>${fdate(d.date)}</b><br>VFC ${d.hrv ?? '–'} ms${avg7[i] ? ` · media 7 d ${Math.round(avg7[i])}` : ''}<br>Carga del día anterior ${Math.round(days[i - 1]?.load || 0)}`; },
      });
    } else $('hrv-chart').closest('.panel').hidden = true;

    const scoreColor = (sc) => (sc == null ? 'var(--dim)' : sc >= 80 ? 'var(--recovery)' : sc >= 60 ? 'var(--warn)' : 'var(--bad)');
    const sd = days.slice(-45), sdates = sd.map((d) => d.date);
    chart($('sleep-chart'), {
      n: sd.length, h: 190, min: 0, cat: true,
      bars: { v: sd.map((d) => d.sleepH ?? null), color: (i) => scoreColor(sd[i].sleepScore) },
      guides: [{ y: 7, label: '7 h', color: 'var(--muted)' }],
      yFmt: (v) => `${v}h`, xLabel: everyNth(sdates, Math.ceil(sd.length / 5)),
      tip: (i) => { const d = sd[i]; return `<b>Noche del ${fdate(d.date)}</b><br>${d.sleepH ? hm(d.sleepH) : '–'}${d.deepH ? ` · profundo ${hm(d.deepH)}` : ''}<br>Puntuación ${d.sleepScore ?? '–'}`; },
    });
    chart($('rhr-chart'), {
      n: days.length, h: 190,
      lines: [{ v: days.map((d) => d.rhr ?? null), color: 'var(--bad)', w: 2, area: true, dot: true }],
      xLabel: everyNth(dates, Math.ceil(days.length / 5)),
      tip: (i) => `<b>${fdate(days[i].date)}</b><br>FC en reposo ${days[i].rhr ?? '–'} ppm`,
    });
    $('rec-insights').innerHTML = (R.insights || []).map((t) => `<li>${esc(t)}</li>`).join('');
  })();

  // ---------- hábitos ----------
  (function habits() {
    if (!HB) { $('habitos').hidden = true; return; }
    const pctYear = Math.round((HB.activeDays / HB.daysSoFar) * 100);
    $('streaks').innerHTML = [
      [HB.weekStreak, HB.weekStreak === 1 ? 'semana' : 'semanas', 'Racha actual', 'seguidas con 3 o más sesiones'],
      [HB.bestWeekStreak ?? HB.weekStreak, (HB.bestWeekStreak ?? HB.weekStreak) === 1 ? 'semana' : 'semanas', 'Mejor racha', HB.bestWeekStreakEnd ? `hasta la semana ${HB.bestWeekStreakEnd}` : 'en lo que va de año'],
      [HB.thisWeek ?? 0, 'de 3', 'Esta semana', (HB.thisWeek ?? 0) >= 3 ? 'objetivo cumplido' : `faltan ${3 - (HB.thisWeek ?? 0)} para el objetivo`],
      [pctYear, '%', 'Días activos', `${HB.activeDays} de ${HB.daysSoFar} este año`],
    ].map(([v, u, l, e]) => `<div class="streak"><span>${l}</span><b><span data-v="${v}" style="font:inherit;color:inherit;letter-spacing:0"></span><small>${u}</small></b><em>${esc(e)}</em></div>`).join('');
    document.querySelectorAll('.streak b span').forEach((s) => countUp(s, +s.dataset.v));

    // tarjeta de horarios
    const host = $('punch');
    const W = Math.max(300, host.clientWidth || 500), Lp = 22, TOP = 8, B = 20;
    const cw = (W - Lp - 4) / 24, ch = Math.min(cw * 1.1, 26), H = TOP + 7 * ch + B;
    const s = svg(W, H);
    const max = Math.max(1, ...HB.punch.flat());
    DOW.forEach((d, r) => el('text', { x: 0, y: TOP + r * ch + ch / 2 + 3.5, class: 'axis' }, s).textContent = d);
    [0, 6, 12, 18, 23].forEach((h) => el('text', { x: Lp + h * cw + cw / 2, y: H - 5, class: 'axis', 'text-anchor': 'middle' }, s).textContent = `${h}h`);
    HB.punch.forEach((row, r) => row.forEach((v, h) => {
      const cx = Lp + h * cw + cw / 2, cy = TOP + r * ch + ch / 2;
      if (!v) { el('circle', { cx, cy, r: 1.2, fill: 'var(--line)' }, s); return; }
      const rad = Math.max(2, Math.sqrt(v / max) * Math.min(cw, ch) * 0.48);
      const c = el('circle', { cx, cy, r: rad, fill: 'var(--effort)', opacity: 0.35 + 0.65 * (v / max) }, s);
      c.addEventListener('mousemove', (e) => showTip(e, `<b>${['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][r]}, ${h}:00</b><br>${v} ${v === 1 ? 'sesión' : 'sesiones'}`));
      c.addEventListener('mouseleave', hideTip);
    }));
    host.appendChild(s);

    const M = HB.monthly;
    chart($('monthly'), {
      n: M.length, h: 190, min: 0, max: 100, cat: true, yFmt: (v) => `${v}%`,
      bars: { v: M.map((m) => m.pct), color: (i, v) => (v >= 70 ? 'var(--gold)' : v >= 45 ? 'var(--warn)' : 'var(--dim)') },
      xLabel: (i) => M[i].month,
      tip: (i) => `<b>${M[i].month}</b><br>${M[i].active} de ${M[i].days} días activos<br>${M[i].hours} h entrenadas`,
    });
    $('hab-insights').innerHTML = HB.insights.map((t) => `<li>${esc(t)}</li>`).join('');
  })();

  // ---------- tendencias ----------
  (function trends() {
    const G = D.trends.groups;
    const groups = [['improving', '▲ Mejorando'], ['declining', '▼ Empeorando'], ['shifting', '◆ Por deporte'], ['steady', '— Estable']];
    $('trends').innerHTML = groups.filter(([k]) => G[k].length).map(([k, title]) => `
      <div class="tgroup"><h3 class="${k === 'improving' ? 'up' : k === 'declining' ? 'down' : 'flat'}">${title}</h3>${G[k].map((r) => {
        const cl = k === 'improving' ? 'up' : k === 'declining' ? 'down' : 'flat';
        const u = r.fmt === 'dur' ? '' : r.unit ? ` ${r.unit}` : '';
        return `<div class="trow"><span>${esc(r.label)}</span><span class="v">${fmt(r.prev, r.fmt)}→${fmt(r.cur, r.fmt)}${u}</span><span class="p ${cl}">${sign(r.pct)}%</span></div>`;
      }).join('')}</div>`).join('');
    $('trend-note').textContent = D.trends.verdict;
  })();

  // ---------- zonas ----------
  (function zones() {
    const Z = D.zones, weeks = D.weeks.filter((w) => w.zones.some((z) => z > 0)).slice(-16);
    $('zone-model').textContent = `${Z.model} · Z3 ${Z.cur[2]}%`;
    const host = $('zone-chart');
    const W = Math.max(280, host.clientWidth || 440), H = 180, P = { l: 30, r: 4, t: 6, b: 22 };
    const s = svg(W, H);
    const max = Math.max(1, ...weeks.map((w) => w.zones.reduce((a, b) => a + b, 0)));
    const nice = Math.ceil(max / 60) * 60;
    const bw = (W - P.l - P.r) / Math.max(weeks.length, 1);
    const y = (v) => P.t + (1 - v / nice) * (H - P.t - P.b);
    for (let v = 0; v <= nice; v += nice / 2) {
      el('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid', 'stroke-dasharray': '2 5' }, s);
      el('text', { x: P.l - 5, y: y(v) + 3, class: 'axis', 'text-anchor': 'end' }, s).textContent = v ? `${v / 60}h` : '0';
    }
    weeks.forEach((w, i) => {
      let acc = 0;
      const g = el('g', { class: reduce ? null : 'grow', style: reduce ? null : `animation-delay:${i * 25}ms` }, s);
      w.zones.forEach((m, z) => {
        if (!m) return;
        el('rect', { x: P.l + i * bw + 2, y: y(acc + m), width: Math.max(1, bw - 4), height: y(acc) - y(acc + m), fill: `var(--z${z + 1})` }, g);
        acc += m;
      });
      if (i % 2 === weeks.length % 2 || weeks.length < 9) el('text', { x: P.l + i * bw + bw / 2, y: H - 6, class: 'axis', 'text-anchor': 'middle' }, s).textContent = `S${w.week}`;
      el('rect', { x: P.l + i * bw, y: 0, width: bw, height: H - P.b, fill: 'transparent' }, g);
      g.addEventListener('mousemove', (e) => showTip(e, `<b>Semana ${w.week}</b><br>${w.zones.map((m, z) => `Z${z + 1} ${dur(m)}`).join(' · ')}`));
      g.addEventListener('mouseleave', hideTip);
    });
    host.appendChild(s);
    $('zone-split').innerHTML = Z.cur.map((p, i) => `<div style="flex:${p};background:var(--z${i + 1})">${p >= 8 ? `Z${i + 1} ${p}%` : ''}</div>`).join('');
    $('zone-keys').innerHTML = Z.cur.map((p, i) => `<span>Z${i + 1} ${p}% <span class="${Z.delta[i] > 0 ? 'up' : Z.delta[i] < 0 ? 'down' : 'flat'}">${Z.delta[i] ? sign(Z.delta[i]) : ''}</span></span>`).join('');
    $('zone-note').textContent = Z.note;
  })();

  // ---------- tirada larga ----------
  (function longRun() {
    const ws = D.weeks.filter((w) => w.longRun);
    if (!ws.length) { $('long-note').textContent = 'Aún no hay carreras este año.'; return; }
    const peak = ws.reduce((a, b) => (b.longRun.km > a.longRun.km ? b : a));
    $('long-peak').textContent = `pico ${peak.longRun.km.toFixed(1)} km · S${peak.week}`;
    const show = ws.slice(-20);
    chart($('long-chart'), {
      n: show.length, h: 180, min: 0, cat: true,
      bars: { v: show.map((w) => w.longRun.km), color: (i) => (i === show.length - 1 ? 'var(--effort)' : show[i] === peak ? 'var(--gold)' : 'rgb(255 90 54 / .45)') },
      xLabel: (i) => (i % 2 === show.length % 2 || show.length < 9 ? `S${show[i].week}` : null),
      tip: (i) => `<b>Semana ${show[i].week}</b><br>${show[i].longRun.km.toFixed(1)} km · ${dur(show[i].longRun.min)} · ${show[i].longRun.pace}/km`,
    });
    const a = show.at(-1).longRun.km, b = show.at(-2)?.longRun.km;
    const ch = b ? Math.round(((a - b) / b) * 100) : 0;
    const prev = show.slice(-5, -1);
    const avg4 = prev.reduce((t, w) => t + w.longRun.km, 0) / Math.max(1, prev.length);
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
      return `<div class="bstat"><b>${B[k].cur}<small class="muted"> ${u}</small> <span class="badge ${cls}">${d != null ? sign(d) : ''}</span></b><small>${label}</small>${spark(B.series.map((p) => p[k] ?? null), 'var(--muted)')}</div>`;
    }).join('');
    $('body-note').textContent = B.note || '';
  })();

  // ---------- semanas ----------
  (function weeks() {
    const ws = D.weeks.slice().reverse();
    let shown = 0;
    const render = () => {
      const html = ws.slice(shown, shown + 8).map((w, idx) => {
        const i = shown + idx, prev = ws[i + 1];
        const ch = prev && prev.min ? Math.round(((w.min - prev.min) / prev.min) * 100) : null;
        const end = new Date(w.start + 'T12:00:00'); end.setDate(end.getDate() + 6);
        const tot = Object.values(w.types).reduce((a, b) => a + b, 0) || 1;
        return `<div class="week">
          <div class="wk"><b>S${w.week}${i === 0 ? '<small>actual</small>' : ''}</b><small>${fdate(w.start, { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</small></div>
          <div><div class="wbar">${Object.entries(w.types).map(([t, m]) => `<div style="flex:${m / tot};background:${famColor(t)}" title="${esc(t)} ${dur(m)}"></div>`).join('')}</div>
            <div class="wtypes">${w.sessions ? Object.entries(w.types).slice(0, 4).map(([t, m]) => `<span><i class="sw" style="background:${famColor(t)}"></i>${esc(t)} ${dur(m)}</span>`).join('') : 'Sin actividad'}
            ${ch != null ? `<span class="badge ${ch >= 0 ? 'up' : 'down'}">${sign(ch)}%</span>` : ''}</div></div>
          <div class="wnums"><span>${dur(w.min)}<small>${w.sessions} sesiones</small></span><span>${w.km.toFixed(1)}<small>km</small></span><span>${w.elev}<small>m ↑</small></span></div>
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
    let filter = null, shown = 0, lastWeek = null;
    $('filters').innerHTML = [`<button class="on" data-f="">Todas</button>`, ...labels.map((l) => `<button data-f="${esc(l)}"><i class="sw" style="background:${famColor(l)}"></i>${esc(l)} <span class="muted">${counts[l]}</span></button>`)].join('');
    $('filters').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      $('filters').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      filter = b.dataset.f || null; shown = 0; $('acts').innerHTML = ''; render();
    };
    const mainZone = (z) => (z ? z.indexOf(Math.max(...z)) + 1 : null);
    function render() {
      const list = D.activities.filter((a) => !filter || a.label === filter);
      $('act-count').textContent = `${list.length} en ${D.year}`;
      if (shown === 0) lastWeek = null;
      const html = list.slice(shown, shown + 25).map((a) => {
        const d = new Date(a.date + 'T12:00:00'), mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const wk = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
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
