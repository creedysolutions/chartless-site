// Chartless app — fingerings, tunings and the voicing solver. A direct port
// of ios/Chartless/Sources/Fingering.swift (Fingering, Voicer), the Tuning
// enum in TunerModels.swift, Capo in SongChart.swift and the tuning bits of
// ChartSettings.swift. Android twin: model/Fingering.kt.
//
// Conventions (same as Swift): pitch classes are A = 0 unless a name says
// C; shapes are fret per string, low string first, 0 = open, null = muted.
// Standard tunings use the hand-made shapes; anything else goes through the
// solver. Unlike Swift there is no static tuning state: every call takes a
// context { notes, style } (notes = open strings low→high or null for the
// instrument's standard tuning; style = 'auto' | 'drone' | 'barre' | 'fingered').
//
// Custom tunings (settings "custom:<id>") come from two places:
//   - chrome.storage.local `customTunings`: [{ id, name, notes }] — the
//     iOS customTunings.v1 shape, written by Settings → "New custom tuning…".
//   - settings.tunerSavedTunings: [{ name, notes }] — the Tuner tab's saved
//     tunings, referenced as "custom:tuner:<name>" (the tuner keys them by
//     index, which shifts on delete, so the name is the stable handle).

window.Fingering = (() => {
  'use strict';
  const mod12 = (n) => ((n % 12) + 12) % 12;

  // --------------------------------------------------------------- instruments
  const INSTRUMENTS = [
    { id: 'guitar', label: 'Guitar' },
    { id: 'baritone', label: 'Baritone guitar' },
    { id: 'ukulele', label: 'Ukulele' },
    { id: 'baritoneUke', label: 'Baritone uke' },
    { id: 'mandolin', label: 'Mandolin' },
    { id: 'banjo', label: 'Banjo (5-string)' },
    { id: 'bass', label: 'Bass' },
    { id: 'piano', label: 'Piano' },
    { id: 'nashville', label: 'Numbers' },
  ];
  const normInstrument = (i) => (i === 'uke' ? 'ukulele' : i === 'keys' ? 'piano' : i || 'guitar');
  const isNumbers = (i) => i === 'nashville';
  const isKeyboard = (i) => i === 'piano';
  /** Guitar-family fretboards where a capo makes sense. */
  const takesCapo = (i) => i === 'guitar' || i === 'baritone';

  // ------------------------------------------------------------------ tunings
  // [id (iOS rawValue), label, notes low→high, group]
  const TUNING_LIST = [
    ['standard', 'Standard', 'E2 A2 D3 G3 B3 E4', 'Guitar'],
    ['dropD', 'Drop D', 'D2 A2 D3 G3 B3 E4', 'Guitar'],
    ['ebStandard', 'E♭ standard (half down)', 'D#2 G#2 C#3 F#3 A#3 D#4', 'Guitar'],
    ['dStandard', 'D standard (whole down)', 'D2 G2 C3 F3 A3 D4', 'Guitar'],
    ['dropC', 'Drop C', 'C2 G2 C3 F3 A3 D4', 'Guitar'],
    ['doubleDropD', 'Double drop D', 'D2 A2 D3 G3 B3 D4', 'Guitar'],
    ['cStandard', 'C standard', 'C2 F2 A#2 D#3 G3 C4', 'Guitar'],
    ['dadgad', 'DADGAD', 'D2 A2 D3 G3 A3 D4', 'Open & modal'],
    ['openG', 'Open G', 'D2 G2 D3 G3 B3 D4', 'Open & modal'],
    ['openD', 'Open D', 'D2 A2 D3 F#3 A3 D4', 'Open & modal'],
    ['openE', 'Open E', 'E2 B2 E3 G#3 B3 E4', 'Open & modal'],
    ['openA', 'Open A', 'E2 A2 E3 A3 C#4 E4', 'Open & modal'],
    ['openC', 'Open C', 'C2 G2 C3 G3 C4 E4', 'Open & modal'],
    ['openDm', 'Open D minor', 'D2 A2 D3 F3 A3 D4', 'Open & modal'],
    ['nashvilleHigh', 'Nashville high-strung', 'E3 A3 D4 G4 B3 E4', 'Open & modal'],
    ['baritoneB', 'Baritone — B standard', 'B1 E2 A2 D3 F#3 B3', 'Baritone & 7-string'],
    ['baritoneA', 'Baritone — A standard', 'A1 D2 G2 C3 E3 A3', 'Baritone & 7-string'],
    ['sevenString', '7-string — B standard', 'B1 E2 A2 D3 G3 B3 E4', 'Baritone & 7-string'],
    ['bass4', 'Bass — standard', 'E1 A1 D2 G2', 'Bass'],
    ['bass5', 'Bass — 5-string', 'B0 E1 A1 D2 G2', 'Bass'],
    ['bassDropD', 'Bass — drop D', 'D1 A1 D2 G2', 'Bass'],
    ['ukeC', 'Ukulele — gCEA', 'G4 C4 E4 A4', 'Ukulele'],
    ['ukeLowG', 'Ukulele — low G', 'G3 C4 E4 A4', 'Ukulele'],
    ['ukeBaritone', 'Ukulele — baritone DGBE', 'D3 G3 B3 E4', 'Ukulele'],
    ['mandolin', 'Mandolin — GDAE', 'G3 D4 A4 E5', 'Mandolin, banjo, strings'],
    ['banjoOpenG', 'Banjo — open G', 'G4 D3 G3 B3 D4', 'Mandolin, banjo, strings'],
    ['banjoDoubleC', 'Banjo — double C', 'G4 C3 G3 C4 D4', 'Mandolin, banjo, strings'],
    ['violin', 'Violin — GDAE', 'G3 D4 A4 E5', 'Mandolin, banjo, strings'],
    ['viola', 'Viola — CGDA', 'C3 G3 D4 A4', 'Mandolin, banjo, strings'],
    ['cello', 'Cello — CGDA', 'C2 G2 D3 A3', 'Mandolin, banjo, strings'],
    ['dobroOpenG', 'Dobro — open G (GBD)', 'G2 B2 D3 G3 B3 D4', 'Mandolin, banjo, strings'],
  ];
  const TUNINGS = {};
  for (const [id, label, notes, group] of TUNING_LIST) TUNINGS[id] = { id, label, notes: notes.split(' '), group };

  /** Tunings the diagram picker offers per instrument (Tuning.options(for:)); first = standard. */
  const OPTIONS = {
    guitar: ['standard', 'dropD', 'ebStandard', 'dStandard', 'dropC', 'doubleDropD', 'cStandard',
      'dadgad', 'openG', 'openD', 'openE', 'openA', 'openC', 'openDm', 'nashvilleHigh', 'sevenString'],
    baritone: ['baritoneB', 'baritoneA'],
    ukulele: ['ukeC', 'ukeLowG'],
    baritoneUke: ['ukeBaritone'],
    mandolin: ['mandolin'],
    banjo: ['banjoOpenG', 'banjoDoubleC'],
    bass: ['bass4', 'bass5', 'bassDropD'],
    piano: [], nashville: [],
  };
  const tuningOptions = (instrument) => (OPTIONS[normInstrument(instrument)] ?? []).map((id) => TUNINGS[id]);
  const standardTuning = (instrument) => tuningOptions(instrument)[0] ?? null;

  // -------------------------------------------------------------- note names
  const NOTE_INDEX = { A: 0, 'A#': 1, B: 2, C: 3, 'C#': 4, D: 5, 'D#': 6, E: 7, F: 8, 'F#': 9, G: 10, 'G#': 11 };
  const NOTE_NAMES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  const sharpName = (pc, minor) => NOTE_NAMES[mod12(pc)] + (minor ? 'm' : '');

  /**
   * "A♭m", "C#", "G/B", "Bbmaj7" → { pc (A = 0), minor }. Extensions fall
   * back to their triad (the extension's lenient parse; Swift is stricter).
   */
  function parse(chord) {
    if (!chord || typeof chord !== 'string') return null;
    const base = chord.trim().split('/')[0];
    const m = /^([A-G])([#♯b♭]?)(.*)$/.exec(base);
    if (!m) return null;
    let pc = NOTE_INDEX[m[1]];
    if (m[2] === '#' || m[2] === '♯') pc += 1;
    if (m[2] === 'b' || m[2] === '♭') pc -= 1;
    const minor = /^(m(?!aj)|min|-|dim|°)/.test(m[3]);
    return { pc: mod12(pc), minor };
  }

  const MIDI_PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  /** "D2" → MIDI-style absolute pitch (octaves roll at C). */
  function pitch(note) {
    const s = String(note);
    const letter = s.slice(0, -1).replace('♭', 'b').replace('♯', '#');
    const octave = Number.parseInt(s.slice(-1), 10);
    return (MIDI_PC[letter] ?? 0) + ((Number.isNaN(octave) ? 3 : octave) + 1) * 12;
  }
  const toC = (pcA) => mod12(pcA + 9); // A = 0 → C = 0
  const sameNotes = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);

  // ------------------------------------------------------ hand-made shapes
  const UKE_SHAPES = {
    A: [2, 1, 0, 0], Am: [2, 0, 0, 0], 'A#': [3, 2, 1, 1], 'A#m': [3, 1, 1, 1],
    B: [4, 3, 2, 2], Bm: [4, 2, 2, 2], C: [0, 0, 0, 3], Cm: [0, 3, 3, 3],
    'C#': [1, 1, 1, 4], 'C#m': [1, 1, 0, 4], D: [2, 2, 2, 0], Dm: [2, 2, 1, 0],
    'D#': [0, 3, 3, 1], 'D#m': [3, 3, 2, 1], E: [4, 4, 4, 2], Em: [0, 4, 3, 2],
    F: [2, 0, 1, 0], Fm: [1, 0, 1, 3], 'F#': [3, 1, 2, 1], 'F#m': [2, 1, 2, 0],
    G: [0, 2, 3, 2], Gm: [0, 2, 3, 1], 'G#': [1, 3, 4, 3], 'G#m': [1, 3, 4, 2],
  };
  const GUITAR_SHAPES = {
    A: [null, 0, 2, 2, 2, 0], Am: [null, 0, 2, 2, 1, 0],
    'A#': [null, 1, 3, 3, 3, 1], 'A#m': [null, 1, 3, 3, 2, 1],
    B: [null, 2, 4, 4, 4, 2], Bm: [null, 2, 4, 4, 3, 2],
    C: [null, 3, 2, 0, 1, 0], Cm: [null, 3, 5, 5, 4, 3],
    'C#': [null, 4, 6, 6, 6, 4], 'C#m': [null, 4, 6, 6, 5, 4],
    D: [null, null, 0, 2, 3, 2], Dm: [null, null, 0, 2, 3, 1],
    'D#': [null, null, 1, 3, 4, 3], 'D#m': [null, null, 1, 3, 4, 2],
    E: [0, 2, 2, 1, 0, 0], Em: [0, 2, 2, 0, 0, 0],
    F: [1, 3, 3, 2, 1, 1], Fm: [1, 3, 3, 1, 1, 1],
    'F#': [2, 4, 4, 3, 2, 2], 'F#m': [2, 4, 4, 2, 2, 2],
    G: [3, 2, 0, 0, 0, 3], Gm: [3, 5, 5, 3, 3, 3],
    'G#': [4, 6, 6, 5, 4, 4], 'G#m': [4, 6, 6, 4, 4, 4],
  };
  // Mandolin (G D A E): open shapes where they exist, else the movable A/Am shape.
  const MANDOLIN_SHAPES = {
    G: [0, 0, 2, 3], C: [0, 2, 3, 0], D: [2, 0, 0, 2], E: [1, 2, 2, 0], F: [2, 3, 3, 1], A: [2, 2, 4, 5],
    Am: [2, 2, 3, 5], Dm: [2, 0, 0, 1], Em: [0, 2, 2, 0], Gm: [0, 0, 1, 3], Cm: [0, 1, 3, 3],
  };
  function mandolinShape(pc, minor) {
    const open = MANDOLIN_SHAPES[sharpName(pc, minor)];
    if (open) return open;
    const f = mod12(pc - NOTE_INDEX.A) + 2;
    return minor ? [f, f, f + 1, f + 3] : [f, f, f + 2, f + 3];
  }
  // Banjo open G, drawn as the four fretted strings (D G B D); the short fifth rings open.
  const BANJO_SHAPES = {
    G: [0, 0, 0, 0], C: [2, 0, 1, 2], D: [0, 2, 3, 4], A: [2, 2, 2, 2], F: [3, 2, 1, 3], E: [2, 1, 0, 2],
    Em: [2, 0, 0, 2], Am: [2, 2, 1, 2], Dm: [0, 2, 3, 3], Bm: [4, 4, 3, 4],
  };
  function banjoShape(pc, minor) {
    const open = BANJO_SHAPES[sharpName(pc, minor)];
    if (open) return open;
    if (minor) { const f = mod12(pc - NOTE_INDEX.E); return [f + 2, f, f, f + 2]; }
    const f = mod12(pc - NOTE_INDEX.G);
    return [f, f, f, f];
  }
  /** Bass (EADG): root-fifth-octave box on the E string, else the A string. */
  function bassShape(pc) {
    let fret = mod12(pc - NOTE_INDEX.E);
    if (fret <= 7) return [fret, fret + 2, fret + 2, null];
    fret = mod12(pc - NOTE_INDEX.A);
    return [null, fret, fret + 2, fret + 2];
  }

  // ------------------------------------------------------- tuning families
  const VOICING_STYLES = ['auto', 'drone', 'barre', 'fingered'];

  /** Reference open strings — what the hand-made shapes and the capo advisor's open keys are written for. */
  function referenceNotes(instrument) {
    switch (normInstrument(instrument)) {
      case 'guitar': case 'baritone': return ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
      case 'baritoneUke': return ['D3', 'G3', 'B3', 'E4'];
      case 'ukulele': return ['G4', 'C4', 'E4', 'A4'];
      case 'mandolin': return ['G3', 'D4', 'A4', 'E5'];
      case 'banjo': return ['G4', 'D3', 'G3', 'B3', 'D4'];
      case 'bass': return ['E1', 'A1', 'D2', 'G2'];
      default: return null;
    }
  }

  /** 'standard' | 'uniform' | 'derived' | 'openTriad' | 'modal' | 'other' */
  function tuningKind(notes, instrument) {
    const ref = referenceNotes(instrument);
    if (!ref) return 'other';
    const cur = notes.map(pitch), refP = ref.map(pitch);
    if (sameNotes(notes, ref)) return 'standard';
    if (cur.length === refP.length) {
      const diffs = cur.map((c, i) => c - refP[i]);
      if (diffs.every((d) => d === diffs[0])) return diffs[0] === 0 ? 'standard' : 'uniform';
      if (diffs.every((d) => d % 12 === 0)) return 'standard';
    }
    if (openTriad(notes)) return 'openTriad';
    if (derivedBase(notes, instrument)) return 'derived';
    if (dronePcs(notes).size) return 'modal';
    return 'other';
  }

  /** At least four strings match the reference (possibly all shifted by k). { shift, map: Map(cur → ref) } */
  function derivedBase(notes, instrument) {
    const ref = referenceNotes(instrument);
    if (!ref) return null;
    const cur = notes.map(pitch), refP = ref.map(pitch);
    const offset = cur.length - refP.length;
    if (offset < 0) return null;
    let best = null;
    for (let shift = -7; shift <= 7; shift++) {
      const map = new Map();
      for (let r = 0; r < refP.length; r++) if (cur[r + offset] === refP[r] + shift) map.set(r + offset, r);
      if (map.size >= 4 && (!best || map.size > best.map.size)) best = { shift, map };
    }
    return best;
  }

  /** Open strings spelling one triad: { root (A = 0), minor } or null. */
  function openTriad(notes) {
    const pcs = new Set(notes.map((n) => (pitch(n) + 3) % 12));
    if (pcs.size !== 3) return null;
    const eq = (a) => a.every((x) => pcs.has(x));
    for (const r of pcs) {
      if (eq([r, (r + 4) % 12, (r + 7) % 12])) return { root: r, minor: false };
      if (eq([r, (r + 3) % 12, (r + 7) % 12])) return { root: r, minor: true };
    }
    return null;
  }

  /** MIDI pcs (C = 0) that appear on two or more strings. */
  function dronePcs(notes) {
    const count = new Map();
    for (const n of notes) { const pc = pitch(n) % 12; count.set(pc, (count.get(pc) ?? 0) + 1); }
    return new Set([...count].filter(([, c]) => c >= 2).map(([pc]) => pc));
  }

  /** The style in force (auto resolved). ctx = { notes, style }. */
  function effectiveStyle(instrument, ctx = {}) {
    instrument = normInstrument(instrument);
    const notes = ctx.notes;
    if (!notes || !(takesCapo(instrument) || instrument === 'baritoneUke')) return 'fingered';
    const style = VOICING_STYLES.includes(ctx.style) ? ctx.style : 'auto';
    if (style !== 'auto') return style;
    switch (tuningKind(notes, instrument)) {
      case 'openTriad': return 'barre';
      case 'modal': return 'drone';
      default: return 'fingered';
    }
  }
  /** Badge suffix: " · drone", " · barre", " · fingered" or "". */
  function styleSuffix(instrument, ctx = {}) {
    if (!ctx.notes) return '';
    const kind = tuningKind(ctx.notes, instrument);
    return ['openTriad', 'modal', 'other'].includes(kind) ? ` · ${effectiveStyle(instrument, ctx)}` : '';
  }

  /** The notes the diagrams currently assume. */
  function activeNotes(instrument, ctx = {}) {
    if (ctx.notes) return ctx.notes;
    if (normInstrument(instrument) === 'baritone') return ['B1', 'E2', 'A2', 'D3', 'F#3', 'B3'];
    return referenceNotes(instrument);
  }

  /** Semitones the tuning sits above the reference when uniform (E♭ −1, baritone B −5); else 0. */
  function tuningShift(instrument, ctx = {}) {
    const ref = referenceNotes(instrument), cur = activeNotes(instrument, ctx);
    if (!ref || !cur || ref.length !== cur.length) return 0;
    const diffs = cur.map((c, i) => pitch(c) - pitch(ref[i]));
    return diffs.every((d) => d === diffs[0]) ? diffs[0] : 0;
  }

  // Capo advisor's classic open keys (A = 0): C G D A E; Am Em Dm.
  const OPEN_KEY_PCS = new Set([3, 10, 5, 0, 7]);
  const OPEN_MINOR_KEY_PCS = new Set([0, 7, 5]);

  /** Keys whose I, IV, V, vi fall under the hand in this tuning. */
  function openKeyPcs(instrument, ctx = {}, minor = false) {
    instrument = normInstrument(instrument);
    const notes = ctx.notes;
    const classic = minor ? OPEN_MINOR_KEY_PCS : OPEN_KEY_PCS;
    if (!notes || tuningShift(instrument, ctx) !== 0 || instrument === 'baritone' || sameNotes(notes, referenceNotes(instrument) ?? [])) return classic;
    if (tuningKind(notes, instrument) === 'derived') return classic;
    switch (effectiveStyle(instrument, ctx)) {
      case 'barre': return new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      case 'drone': return droneOpenKeys(notes, minor);
      default: return Voicer.openKeys(notes, minor);
    }
  }

  /** Drone style works where the drones are root or fifth of the tonic (third too in minor). */
  function droneOpenKeys(notes, minor) {
    const drones = [...dronePcs(notes)].map((pc) => (pc + 3) % 12);
    const out = new Set();
    for (let key = 0; key < 12; key++) {
      const allowed = new Set(minor ? [key, (key + 3) % 12, (key + 7) % 12] : [key, (key + 7) % 12]);
      if (drones.includes((key + 5) % 12)) continue;
      if (drones.some((d) => allowed.has(d))) out.add(key);
    }
    return out;
  }

  /**
   * Fret shape for a chord (low→high) or null. capo: with a capo the SHAPE
   * you play is the chord transposed down (guitar family only).
   */
  function shape(chord, { instrument = 'guitar', capo = 0, notes = null, style = 'auto' } = {}) {
    instrument = normInstrument(instrument);
    const p = parse(chord);
    if (!p) return null;
    const ctx = { notes, style };
    if (notes && !isKeyboard(instrument) && !isNumbers(instrument)) {
      const root = mod12(p.pc - (takesCapo(instrument) ? capo : 0));
      const guitarFamily = instrument === 'guitar' || instrument === 'baritone';
      const kind = tuningKind(notes, instrument);
      if (guitarFamily && kind === 'standard') return GUITAR_SHAPES[sharpName(root, p.minor)] ?? null;
      if (guitarFamily && kind === 'uniform') {
        const d = derivedBase(notes, instrument);
        if (d) return GUITAR_SHAPES[sharpName(root - d.shift, p.minor)] ?? null;
      }
      if (guitarFamily && kind === 'derived') {
        const d = derivedBase(notes, instrument);
        const base = d && GUITAR_SHAPES[sharpName(root - d.shift, p.minor)];
        if (base) return Voicer.derived(base, d.map, root, p.minor, notes);
      }
      const st = effectiveStyle(instrument, ctx);
      if (st === 'barre') {
        const triad = openTriad(notes);
        const b = triad && Voicer.barre(root, p.minor, triad.root, triad.minor, notes);
        if (b) return b;
      }
      return Voicer.shape(root, p.minor, notes, instrument, st === 'drone' && dronePcs(notes).size > 0);
    }
    switch (instrument) {
      case 'bass': return bassShape(p.pc);
      case 'guitar': return GUITAR_SHAPES[sharpName(p.pc - capo, p.minor)] ?? null;
      // Baritone in B: the shape for X is the guitar shape for X up a fourth.
      case 'baritone': return GUITAR_SHAPES[sharpName(p.pc + 5 - capo, p.minor)] ?? null;
      case 'ukulele': return UKE_SHAPES[sharpName(p.pc, p.minor)] ?? null;
      // Baritone uke is the top four guitar strings (D G B E).
      case 'baritoneUke': { const g = GUITAR_SHAPES[sharpName(p.pc, p.minor)]; return g ? g.slice(-4) : null; }
      case 'mandolin': return mandolinShape(p.pc, p.minor);
      case 'banjo': return banjoShape(p.pc, p.minor);
      default: return null;
    }
  }

  /** Triad pitch classes (A = 0) for the piano diagram. */
  function triad(chord) {
    const p = parse(chord);
    if (!p) return null;
    return [p.pc, (p.pc + (p.minor ? 3 : 4)) % 12, (p.pc + 7) % 12];
  }

  // -------------------------------------------------------------- the solver
  // Lowest-position shape that sounds root, third and fifth, root in the
  // bass when it can, muted strings only at the bottom, at most four
  // fingers (a barre on the lowest fret counts as one). Cached per tuning.
  // Recursion prunes candidates the scorer would reject (non-chord tones)
  // before descending; enumeration order is Swift's, so ties resolve alike.
  const Voicer = (() => {
    const cache = new Map();
    const easeCache = new Map();

    function shapeFor(root, minor, notes, instrument, drone = false) {
      const key = `${notes.join(',')}|${root}${minor ? 'm' : ''}|${instrument}|${drone}`;
      if (cache.has(key)) return cache.get(key);
      let open = notes.map(pitch);
      // Banjo: the short fifth string is a drone; the diagram draws the other four.
      if (instrument === 'banjo' && open.length === 5) open = open.slice(1);
      const rootC = toC(root);
      const tones = new Set([rootC, (rootC + (minor ? 3 : 4)) % 12, (rootC + 7) % 12]);
      let result;
      if (instrument === 'bass') result = bassBox(rootC, open);
      else if (drone) {
        const drones = new Set([...new Set(open.map((p) => p % 12))].filter((pc) => open.filter((p) => p % 12 === pc).length >= 2));
        result = solveDrone(rootC, (rootC + (minor ? 3 : 4)) % 12, tones, drones, open) ?? solve(rootC, tones, open);
      } else result = solve(rootC, tones, open);
      if (result) cache.set(key, result);
      return result ?? null;
    }

    /** Pop / Celtic drone style: outer strings never fretted, fingers slide on the middle strings. */
    function solveDrone(root, third, tones, drones, open) {
      const n = open.length;
      let best = null;
      for (let base = 0; base <= 11; base++) {
        const current = new Array(n).fill(0);
        const consider = (shape) => {
          const sounding = [];
          shape.forEach((f, i) => { if (f !== null) sounding.push([i, f]); });
          if (sounding.length < 3) return;
          const have = new Set();
          let colour = 0;
          for (const [i, f] of sounding) {
            const pc = mod12(open[i] + f);
            if (f > 0) { if (!tones.has(pc)) return; }
            else if (!tones.has(pc)) {
              if (!drones.has(pc)) return;
              const interval = mod12(pc - root);
              colour += interval === 2 ? 0.3 : interval === 5 ? 2.0 : 1.0;
            }
            have.add(pc);
          }
          if (!have.has(root) || !have.has(third)) return;
          const fretted = sounding.filter(([, f]) => f > 0);
          if (fretted.length > 3) return;
          const frets = fretted.map(([, f]) => f);
          const minFret = frets.length ? Math.min(...frets) : 0, maxFret = frets.length ? Math.max(...frets) : 0;
          if (maxFret - minFret > 3) return;
          const opens = sounding.length - fretted.length;
          const muted = n - sounding.length;
          const fifth = have.has((root + 7) % 12);
          let lowest = null;
          for (const x of fretted) if (!lowest || x[0] < lowest[0]) lowest = x;
          const rootUnderFinger = lowest ? mod12(open[lowest[0]] + lowest[1]) === root : false;
          let score = 0;
          score += fretted.length * 1.5;
          score -= opens * 0.6;
          score += colour;
          score += muted * 3.0;
          score += (maxFret - minFret) * 0.8;
          score += minFret * 0.9;
          score += fifth ? -1.5 : 0;
          score += rootUnderFinger ? -2.5 : 0;
          const idx = fretted.map(([i]) => i).sort((a, b) => a - b);
          if (idx.length === 2 && idx[1] - idx[0] !== 1) score += 2;
          if (!best || score < best.score) best = { shape: shape.slice(), score };
        };
        const okOpen = (s) => { const pc = mod12(open[s]); return tones.has(pc) || drones.has(pc); };
        const recurse = (s) => {
          if (s === n) { consider(current); return; }
          current[s] = null; recurse(s + 1);
          if (okOpen(s)) { current[s] = 0; recurse(s + 1); }
          if (s === 0 || s === n - 1) return;
          for (let f = Math.max(1, base); f <= base + 3; f++) {
            if (!tones.has(mod12(open[s] + f))) continue;
            current[s] = f; recurse(s + 1);
          }
        };
        recurse(0);
      }
      return best?.shape ?? null;
    }

    /** Drop tunings: keep the standard shape on unmoved strings; retuned ones take a chord tone in reach. */
    function derived(base, map, root, minor, notes) {
      const open = notes.map(pitch);
      const rootC = toC(root);
      const tones = [rootC, (rootC + 7) % 12, (rootC + (minor ? 3 : 4)) % 12];
      const out = new Array(open.length).fill(null);
      for (const [cur, ref] of map) out[cur] = base[ref];
      const fretted = out.filter((f) => f !== null && f > 0);
      const lo = fretted.length ? Math.min(...fretted) : 0, hi = fretted.length ? Math.max(...fretted) : 0;
      const reachLo = Math.max(0, hi - 3), reachHi = Math.max(3, lo + 3);
      for (let i = 0; i < open.length; i++) {
        if (map.has(i)) continue;
        let pick = null;
        const candidates = i === 0 ? [rootC] : tones;
        for (const t of candidates) {
          const f = mod12(t - (open[i] % 12));
          if (f >= reachLo && f <= reachHi && f <= 5) { pick = f; break; }
        }
        if (pick === null) {
          const openPc = mod12(open[i]);
          const allowed = i === 0 ? [rootC, (rootC + 7) % 12] : tones;
          if (allowed.includes(openPc)) pick = 0;
        }
        out[i] = pick;
      }
      const firstSounding = out.findIndex((f) => f !== null);
      if (firstSounding >= 0) {
        for (let i = firstSounding + 1; i < out.length; i++) {
          if (out[i] !== null) continue;
          if (tones.includes(mod12(open[i]))) out[i] = 0;
          else { for (let j = 0; j < i; j++) out[j] = null; break; }
        }
      }
      return out;
    }

    /** Open tunings, slide/blues: one finger across the root fret; the other quality moves the third strings. */
    function barre(root, minor, tuningRoot, tuningMinor, notes) {
      const f = mod12(root - tuningRoot);
      if (f > 9) return null;
      const open = notes.map(pitch);
      const thirdC = toC(tuningRoot + (tuningMinor ? 3 : 4));
      const out = new Array(open.length).fill(f);
      if (minor !== tuningMinor) {
        const delta = tuningMinor ? 1 : -1;
        for (let i = 0; i < open.length; i++) {
          if (open[i] % 12 !== thirdC) continue;
          const nf = f + delta;
          if (nf < 0) return null;
          out[i] = nf;
        }
      }
      return out;
    }

    function bassBox(root, open) {
      if (open.length < 3) return null;
      for (let i = 0; i < open.length - 2; i++) {
        const f = mod12(root - open[i]);
        if (f > 7) continue;
        const rootPitch = open[i] + f;
        const fifth = rootPitch + 7 - open[i + 1];
        const octave = rootPitch + 12 - open[i + 2];
        if (fifth < 0 || fifth > 12 || octave < 0 || octave > 12) continue;
        const out = new Array(open.length).fill(null);
        out[i] = f; out[i + 1] = fifth; out[i + 2] = octave;
        return out;
      }
      const out = new Array(open.length).fill(null);
      out[0] = mod12(root - open[0]);
      return out;
    }

    /** How comfortable a key is: best-shape effort of I IV V vi (minor: i iv v VI III). Lower is easier. */
    function ease(keyPc, notes, minorKey = false) {
      const key = `${notes.join(',')}|${keyPc}${minorKey ? 'm' : ''}`;
      if (easeCache.has(key)) return easeCache.get(key);
      const open = notes.map(pitch);
      let total = 0;
      const degrees = minorKey ? [[0, true], [5, true], [7, true], [8, false], [3, false]] : [[0, false], [5, false], [7, false], [9, true]];
      for (const [offset, minor] of degrees) {
        const rootC = toC(keyPc + offset);
        const tones = new Set([rootC, (rootC + (minor ? 3 : 4)) % 12, (rootC + 7) % 12]);
        const sh = solveScored(rootC, tones, open)?.shape;
        if (!sh) { total += 12; continue; }
        const fretted = sh.filter((f) => f !== null && f > 0);
        const opens = sh.filter((f) => f === 0).length;
        const minFret = fretted.length ? Math.min(...fretted) : 0;
        const maxFret = fretted.length ? Math.max(...fretted) : 0;
        const atMin = fretted.filter((f) => f === minFret).length;
        const isBarre = atMin >= 3;
        const fingers = fretted.length ? fretted.filter((f) => f > minFret).length + (isBarre ? 1 : atMin) : 0;
        total += fingers + (isBarre ? 2.5 : 0) + (maxFret - minFret) * 0.5 + minFret * 0.3 - opens * 0.5;
      }
      easeCache.set(key, total);
      return total;
    }

    function openKeys(notes, minor = false) {
      const eases = Array.from({ length: 12 }, (_, k) => ease(k, notes, minor));
      const best = Math.min(...eases);
      return new Set(eases.map((e, k) => [e, k]).filter(([e]) => e <= best + (minor ? 6 : 7)).map(([, k]) => k));
    }

    const solve = (root, tones, open) => solveScored(root, tones, open)?.shape ?? null;

    function solveScored(root, tones, open) {
      const n = open.length;
      let best = null;
      const reentrant = open.some((p, i) => i > 0 && open[i - 1] > p);
      for (let base = 0; base <= 9; base++) {
        const current = new Array(n).fill(null);
        const consider = (shape) => {
          const sounding = [];
          shape.forEach((f, i) => { if (f !== null) sounding.push([i, f]); });
          if (sounding.length < 3) return;
          const have = new Set();
          for (const [i, f] of sounding) {
            const pc = mod12(open[i] + f);
            if (!tones.has(pc)) return;
            have.add(pc);
          }
          if (have.size !== tones.size) return;
          const fretted = sounding.map(([, f]) => f).filter((f) => f > 0);
          const minFret = fretted.length ? Math.min(...fretted) : 0;
          const maxFret = fretted.length ? Math.max(...fretted) : 0;
          const fingers = fretted.length ? fretted.filter((f) => f > minFret).length + 1 : 0;
          if (fingers > 4) return;
          let low = Infinity;
          for (const [i, f] of sounding) low = Math.min(low, open[i] + f);
          const bassPc = mod12(low);
          let score = 0;
          score += fretted.length * 0.7;
          score -= (sounding.length - fretted.length) * 0.6;
          score += minFret * 1.4;
          score += (maxFret - minFret) * 2.5;
          score += Math.max(0, new Set(fretted).size - 2) * 1.0;
          score += (n - sounding.length) * (20.0 / n);
          if (!reentrant) score += bassPc === root ? -6 : (bassPc === (root + 7) % 12 ? -1 : 3);
          if (maxFret >= 3) {
            const first = sounding[0][0], last = sounding[sounding.length - 1][0];
            for (const [i, f] of sounding) if (f === 0 && i > first && i < last) score += 2.5;
          }
          if (!best || score < best.score) best = { shape: shape.slice(), score };
        };
        const recurse = (s) => {
          if (s === n) { consider(current); return; }
          if (s === 0 || current[s - 1] === null) { current[s] = null; recurse(s + 1); }
          if (tones.has(mod12(open[s]))) { current[s] = 0; recurse(s + 1); }
          for (let f = Math.max(1, base); f <= base + 3; f++) {
            if (!tones.has(mod12(open[s] + f))) continue;
            current[s] = f; recurse(s + 1);
          }
          current[s] = null;
        };
        recurse(0);
        if (best && best.score < base * 1.4 - 8) break;
      }
      return best;
    }

    return { shape: shapeFor, derived, barre, ease, openKeys, clear() { cache.clear(); easeCache.clear(); } };
  })();

  // ------------------------------------------------------------ capo advisor
  const keyRoot = (keyLabel) => String(keyLabel ?? '').split(' ')[0];
  /** Smallest capo (0–6) that lands the key on this tuning's open keys; 0 = none. */
  function advise(keyLabel, instrument, ctx = {}) {
    instrument = normInstrument(instrument);
    if (!takesCapo(instrument) || !keyLabel) return 0;
    const p = parse(keyRoot(keyLabel));
    if (!p) return 0;
    const pc = p.pc - tuningShift(instrument, ctx);
    const open = openKeyPcs(instrument, ctx, /minor$/.test(keyLabel));
    for (let n = 0; n <= 6; n++) if (open.has(mod12(pc - n))) return n;
    return 0;
  }
  /** "G" for a song in B with capo 4 (tuning shift folded in). */
  function shapesKey(keyLabel, capo, instrument = 'guitar', ctx = {}) {
    const p = keyLabel ? parse(keyRoot(keyLabel)) : null;
    if (!p) return null;
    return sharpName(p.pc - tuningShift(instrument, ctx) - capo, false);
  }
  /** " · play in G" when capo n lands the shapes in an open key of this tuning; "" otherwise. */
  function playKey(keyLabel, n, instrument, ctx = {}) {
    const root = shapesKey(keyLabel, n, instrument, ctx);
    const p = root && parse(root);
    if (!p) return '';
    const minor = /minor$/.test(keyLabel ?? '');
    return openKeyPcs(instrument, ctx, minor).has(p.pc) ? ` · play in ${root}${minor ? 'm' : ''}` : '';
  }

  // --------------------------------------------------- settings → tuning
  /**
   * Resolve settings.tuningId for an instrument (ChartSettings.diagramTuningNotes
   * + tuningLabel). customTunings = the `customTunings` storage array.
   * Returns { id, label, notes } — notes null means the instrument's standard
   * tuning (hand-made shapes). A tuning that doesn't belong to the instrument
   * (a uke tuning left over while the chart forces guitar) is ignored.
   */
  function resolveTuning(settings = {}, customTunings = [], instrument = settings.instrument) {
    instrument = normInstrument(instrument);
    const std = standardTuning(instrument);
    const none = { id: null, label: std?.label ?? 'Standard', notes: null };
    const id = settings.tuningId;
    if (!id || !std) return none;
    if (id.startsWith('custom:')) {
      const t = customList(settings, customTunings).find((c) => c.key === id);
      if (!t || t.notes.length !== std.notes.length) return none;
      return { id, label: t.name, notes: t.notes };
    }
    const t = TUNINGS[id];
    if (!t || !(OPTIONS[instrument] ?? []).includes(id) || t === std) return none;
    return { id, label: t.label, notes: t.notes };
  }
  /** Every custom tuning: [{ key: "custom:…", name, notes, source: 'app' | 'tuner' }]. */
  function customList(settings = {}, customTunings = []) {
    const out = [];
    for (const t of Array.isArray(customTunings) ? customTunings : []) {
      if (t && t.id && Array.isArray(t.notes) && t.notes.length) out.push({ key: `custom:${t.id}`, name: t.name || t.notes.join(' '), notes: t.notes, source: 'app' });
    }
    for (const t of Array.isArray(settings.tunerSavedTunings) ? settings.tunerSavedTunings : []) {
      if (t && Array.isArray(t.notes) && t.notes.length) out.push({ key: `custom:tuner:${t.name || t.notes.join(' ')}`, name: t.name || t.notes.join(' '), notes: t.notes, source: 'tuner' });
    }
    return out;
  }

  return {
    INSTRUMENTS, TUNINGS, TUNING_LIST, OPTIONS, VOICING_STYLES,
    normInstrument, isNumbers, isKeyboard, takesCapo,
    tuningOptions, standardTuning, referenceNotes, activeNotes,
    parse, pitch, sharpName, shape, triad,
    tuningKind, derivedBase, openTriad, dronePcs, effectiveStyle, styleSuffix, tuningShift, openKeyPcs,
    advise, shapesKey, playKey, resolveTuning, customList,
    Voicer,
  };
})();
