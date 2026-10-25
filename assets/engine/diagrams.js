// Chartless app — chord diagrams (shared by Chart, Stage and Practice).
// Contract: ChordDiagram.svg(chordName, { instrument, leftHanded, width = 150,
//   capo = 0, tuningNotes, voicingStyle, labelCapo }) returns an SVGElement,
// or null when there's no shape for that chord.
//
// Tuning-aware (the iOS system, ported in fingering.js): any option left
// undefined is read from the stored `settings` — instrument (guitar unless
// Pro), tuningId → open-string notes, voicingStyle, leftHanded — so every
// caller gets the chosen tuning without changes. Pass tuningNotes: null to
// force the instrument's standard tuning.
//
// Drawing follows iOS FretboardDiagram + PianoDiagram (Fingering.swift):
// thick nut, "Nfr" for higher positions, × / ○ above the nut, amber dots,
// "capo N" on the nut; any string count (4–7), four frets or more when a
// voicing needs them. Banjo draws the four fretted strings (the short
// fifth rings open), as on iOS.
//
// Extras: parse(name) → { pc (C = 0), minor }; shape(name, opts);
// capoForKey(label, opts); context(instrument) → { instrument, notes, style,
// tuning }; stateKey() (changes whenever a diagram-affecting setting does);
// onChange(fn).

window.ChordDiagram = (() => {
  const F = window.Fingering;
  const mod12 = (n) => ((n % 12) + 12) % 12;

  // ---------------------------------------------------------- settings cache
  let cache = { settings: {}, customTunings: [], pro: false };
  const listeners = new Set();
  const ready = (async () => {
    try {
      const got = await chrome.storage.local.get(['settings', 'customTunings', 'proActive']);
      cache = { settings: got.settings ?? {}, customTunings: got.customTunings ?? [], pro: !!got.proActive };
    } catch {}
  })();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!changes.settings && !changes.customTunings && !changes.proActive) return;
      const before = stateKey();
      if (changes.settings) cache.settings = changes.settings.newValue ?? {};
      if (changes.customTunings) cache.customTunings = changes.customTunings.newValue ?? [];
      if (changes.proActive) cache.pro = !!changes.proActive.newValue;
      if (stateKey() !== before) for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } }
    });
  } catch {}

  const defaultInstrument = () => (cache.pro ? F.normInstrument(cache.settings.instrument) : 'guitar');

  /** { instrument, notes, style, tuning: { id, label, notes } } for diagrams on this instrument. */
  function context(instrument) {
    const inst = F.normInstrument(instrument ?? defaultInstrument());
    const tuning = F.resolveTuning(cache.settings, cache.customTunings, inst);
    return { instrument: inst, notes: tuning.notes, style: cache.settings.voicingStyle || 'auto', tuning };
  }
  /** Signature of every setting that changes a diagram. */
  function stateKey() {
    const s = cache.settings;
    const c = context();
    return [c.instrument, c.notes?.join(' ') ?? '', c.style, !!s.leftHanded].join('|');
  }

  function resolve(opts = {}) {
    const instrument = F.normInstrument(opts.instrument ?? defaultInstrument());
    const ctx = context(instrument);
    const notes = opts.tuningNotes !== undefined ? opts.tuningNotes : ctx.notes;
    const style = opts.voicingStyle ?? ctx.style;
    const leftHanded = opts.leftHanded ?? !!cache.settings.leftHanded;
    return { instrument, notes, style, leftHanded };
  }

  /** "B♭m7/F" -> { pc (C = 0), minor }; null for anything unparseable (e.g. Nashville "4"). */
  function parse(name) {
    const p = F.parse(name);
    return p ? { pc: mod12(p.pc + 9), minor: p.minor } : null; // Fingering is A = 0
  }

  /** Fret-per-string shape (low to high) or null. */
  function shape(name, opts = {}) {
    const r = resolve(opts);
    const capo = F.takesCapo(r.instrument) ? Math.max(0, opts.capo | 0) : 0;
    return F.shape(name, { instrument: r.instrument, capo, notes: r.notes, style: r.style });
  }

  /** Tuning-aware capo advisor: smallest capo that lands the key on easy shapes (0 = none). */
  function capoForKey(keyLabel, opts = {}) {
    const r = resolve(opts);
    return F.advise(keyLabel, r.instrument, { notes: r.notes, style: r.style });
  }

  // ------------------------------------------------------------------ drawing
  const NS = 'http://www.w3.org/2000/svg';
  const C = { text: '#ECECF1', muted: '#8A8A96', amber: '#F0B95C', ground: '#111116' };

  function el(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  // iOS FretboardDiagram, 150 x 170 at width 150.
  function fretboardSvg(frets, { width, leftHanded, capo }) {
    const shapeLR = leftHanded ? [...frets].reverse() : frets;
    const W = width;
    const H = Math.round(width * 170 / 150);
    const k = width / 150; // type scale
    const strings = shapeLR.length;
    const fretted = shapeLR.filter((f) => f !== null && f > 0);
    const maxFret = fretted.length ? Math.max(...fretted) : 0;
    const base = maxFret > 4 ? Math.min(...fretted) : 1;
    // Four frets like iOS; more only when a solver voicing spans further.
    const fretCount = Math.max(4, maxFret - base + 1);
    const shifted = maxFret > 4;
    const padX = W * (shifted || capo > 0 ? 0.26 : strings >= 7 ? 0.1 : 0.14);
    const padTop = H * 0.16;
    const padBottom = H * 0.06;
    const gridW = W - padX * 2;
    const gridH = H - padTop - padBottom;
    const stringGap = gridW / Math.max(1, strings - 1);
    const fretGap = gridH / fretCount;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chord-diagram', role: 'img' });
    // Nut (thick; amber when it's a capo) or a thinner line at a higher position.
    svg.append(el('line', {
      x1: padX, y1: padTop, x2: padX + gridW, y2: padTop,
      stroke: base === 1 ? (capo > 0 ? C.amber : C.text) : C.text,
      'stroke-opacity': base === 1 ? 1 : 0.7,
      'stroke-width': base === 1 ? 4 * Math.max(0.6, k) : 2, 'stroke-linecap': 'round',
    }));
    const label = (text, x, y, size, fill) => {
      const t = el('text', { x, y, 'font-size': size, 'font-weight': 700, fill, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-family': '-apple-system, BlinkMacSystemFont, system-ui, sans-serif' });
      t.textContent = text;
      svg.append(t);
    };
    if (base > 1) label(`${base + capo}fr`, padX * 0.45, padTop + fretGap / 2, Math.max(8, 13 * k), C.text);
    else if (capo > 0) label(width >= 100 ? `capo ${capo}` : String(capo), padX * 0.45, padTop, Math.max(7, 11 * k), C.amber);
    for (let f = 1; f <= fretCount; f++) {
      const y = padTop + fretGap * f;
      svg.append(el('line', { x1: padX, y1: y, x2: padX + gridW, y2: y, stroke: C.text, 'stroke-opacity': 0.55, 'stroke-width': 2 * Math.max(0.6, k) }));
    }
    for (let s = 0; s < strings; s++) {
      const x = padX + stringGap * s;
      svg.append(el('line', { x1: x, y1: padTop, x2: x, y2: padTop + gridH, stroke: C.text, 'stroke-opacity': 0.8, 'stroke-width': 1.5 * Math.max(0.6, k) }));
    }
    const dotR = Math.min(stringGap, fretGap) * 0.32;
    const markY = padTop - Math.max(7, 11 * k);
    shapeLR.forEach((fret, s) => {
      const x = padX + stringGap * s;
      if (fret === null) { label('×', x, markY, Math.max(9, 15 * k), C.muted); return; }
      if (fret === 0) {
        svg.append(el('circle', { cx: x, cy: markY, r: Math.max(2.5, dotR * 0.6), fill: 'none', stroke: C.muted, 'stroke-width': 1.5 * Math.max(0.6, k) }));
        return;
      }
      const row = fret - base + 1;
      if (row < 1 || row > fretCount) return;
      svg.append(el('circle', { cx: x, cy: padTop + fretGap * (row - 0.5), r: dotR, fill: C.amber }));
    });
    return svg;
  }

  // iOS PianoDiagram: one octave C..B, the triad lit amber. 170 x 70 at width 170.
  function pianoSvg(name, { width }) {
    const p = parse(name);
    if (!p) return null;
    const tones = new Set([p.pc, mod12(p.pc + (p.minor ? 3 : 4)), mod12(p.pc + 7)]);
    const W = width;
    const H = Math.round(width * 70 / 170);
    const whiteW = W / 7;
    const blackW = whiteW * 0.6;
    const blackH = H * 0.62;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chord-diagram piano', role: 'img' });
    [0, 2, 4, 5, 7, 9, 11].forEach((pc, i) => {
      svg.append(el('rect', { x: i * whiteW + 1, y: 0, width: whiteW - 2, height: H, rx: 3, fill: tones.has(pc) ? C.amber : C.text }));
    });
    [[1, 0], [3, 1], [6, 3], [8, 4], [10, 5]].forEach(([pc, after]) => {
      svg.append(el('rect', { x: (after + 1) * whiteW - blackW / 2, y: 0, width: blackW, height: blackH, rx: 2, fill: tones.has(pc) ? C.amber : C.ground }));
    });
    return svg;
  }

  /** SVGElement for the chord, or null (no shape / Nashville number / numbers instrument). */
  function svg(name, opts = {}) {
    const r = resolve(opts);
    const width = opts.width ?? 150;
    if (F.isKeyboard(r.instrument)) return pianoSvg(name, { width });
    if (F.isNumbers(r.instrument)) return null;
    const capo = F.takesCapo(r.instrument) ? Math.max(0, opts.capo | 0) : 0;
    const frets = F.shape(name, { instrument: r.instrument, capo, notes: r.notes, style: r.style });
    if (!frets || frets.length < 2) return null;
    // The nut label is the capo actually on the neck (labelCapo), which can
    // differ from the capo folded into the shape once names read as played.
    const nutCapo = F.takesCapo(r.instrument) ? Math.max(0, (opts.labelCapo ?? capo) | 0) : 0;
    const node = fretboardSvg(frets, { width, leftHanded: r.leftHanded, capo: nutCapo });
    node.setAttribute('aria-label', `${name} ${r.instrument} diagram${r.notes ? ` in ${r.notes.join(' ')}` : ''}`);
    return node;
  }

  return {
    svg, shape, parse, capoForKey, context, stateKey, ready,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
