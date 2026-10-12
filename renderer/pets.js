/* Motore degli animaletti (docs/plans/33-animaletti.md): dove sta ognuno,
 * in che direzione va, che posa ha. Niente DOM: la vista (pets-view.js)
 * chiama step() a ogni frame e disegna quello che trova.
 *
 * Unità: x in pixel dal bordo sinistro della striscia, dt in millisecondi,
 * velocità in "misure al secondo" (una misura = size, l'altezza di
 * riferimento), così un personaggio grande non sembra più lento.
 *
 * Chi non cammina (MOVES): la medusa galleggia ondeggiando (float), la rana
 * salta e avanza solo in aria, l'uccellino
 * vola sopra la striscia e si posa per dormire o chiamare, il pesce nuota
 * ondeggiando appena sopra il fondo. Chi fuma (la tazzina, trail) lascia sbuffi che restano dove nascono e salgono: sono
 * nello stato del personaggio (puffs), la vista li disegna a parte.
 *
 * Le azioni (act): una posa temporanea durante la quale il personaggio sta
 * fermo, solo per chi ha quel frame (pets-sprites.js OPTIONAL_POSES). Le
 * sequenze girano una volta (turn, startle, laugh, appear, vanish), idle
 * per la durata della pausa. Chi finisce di svanire esce dallo stato.
 *
 * Stato immutabile: step() restituisce oggetti nuovi.
 *
 * Wrapper UMD come gli altri moduli del renderer. */
(function (root, factory) {
  const api = factory(root ? root.AisessPetsSprites : require('./pets-sprites'));
  if (root) root.AisessPets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (Sprites) {
  /** Oltre questo dt (scheda tornata in primo piano) il passo si tronca. */
  const MAX_DT = 100;
  const FRAME_MS = 180;
  const BUSY_FACTOR = 2;
  const SLEEP_AFTER_MS = 5 * 60 * 1000;
  /** Probabilità al secondo che un personaggio libero cambi direzione. */
  const TURN_PER_S = 0.08;
  /** Pausa a passeggio, per chi ha la posa idle: probabilità al secondo e durata. */
  const PAUSE_PER_S = 0.06;
  const PAUSE_MS = { min: 1500, max: 3500 };
  /** Oltre questa attesa chi chiama, se ha la posa, si fa triste. */
  const SAD_AFTER_MS = 60 * 1000;
  /** Ondeggio della medusa: ampiezza in misure, giri al secondo. */
  const BOB_AMPL = 0.12;
  const BOB_HZ = 0.8;
  /** Rana: salti al secondo e altezza in misure. Sta in aria metà del tempo. */
  const HOP_HZ = 1.2;
  const HOP_HEIGHT = 0.6;
  /** Uccellino e pesce: quota media, ampiezza dell'ondeggio (misure), giri al secondo. */
  const FLY = { base: 1, ampl: 0.3, hz: 0.5 };
  const SWIM = { base: 0.22, ampl: 0.15, hz: 0.6 };
  /** Fumo (la tazzina): uno sbuffo ogni tanto, quanto vive, quanto sale (misure al secondo), quanti al massimo. */
  const PUFF_EVERY_MS = 450;
  const PUFF_LIFE_MS = 2200;
  const PUFF_RISE = 0.3;
  const MAX_PUFFS = 6;

  const spriteOf = (kind) => Sprites.SPRITES[kind];
  const has = (kind, pose) => Boolean(spriteOf(kind).frames[pose]);

  /** Larghezza in pixel: le colonne del disegno per il lato del pixel (Sprites.pixel). */
  function petWidth(kind, size) {
    return Sprites.dims(kind).cols * Sprites.pixel(kind, size);
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const maxX = (kind, size, width) => Math.max(0, width - petWidth(kind, size));
  const centerOf = (p, size) => p.x + petWidth(p.kind, size) / 2;

  /** L'aspetto (pets-sprites.js variants) si tira a sorte solo per chi ne ha più d'uno. */
  const pickVariant = (kind, random) => Math.min(Sprites.looks(kind) - 1, Math.floor(random() * Sprites.looks(kind)));

  function newPet(key, kind, x, dir, random) {
    const smoke = spriteOf(kind).trail ? { puffs: [], steam: 0 } : {};
    return { key, kind, variant: pickVariant(kind, random), x, y: 0, dir, pose: 'walk', anim: 0, phase: random() * Math.PI * 2, act: null, ...smoke };
  }

  /** Comincia un'azione: fermo con quella posa. Senza durata dura quanto la sequenza. */
  function act(pet, pose, ms) {
    if (!has(pet.kind, pose)) return pet;
    const left = ms === undefined ? spriteOf(pet.kind).frames[pose].length * FRAME_MS : ms;
    return { ...pet, anim: 0, pose, act: { pose, left } };
  }

  /** Un passo di un'azione in corso; finita, si torna a camminare o si esce (vanish). */
  function tickAct(pet, ctx) {
    const left = pet.act.left - ctx.s * 1000 * ctx.mult;
    if (left > 0) return { ...pet, act: { ...pet.act, left } };
    return pet.act.pose === 'vanish' ? { ...pet, act: null, gone: true } : { ...pet, act: null, pose: 'walk' };
  }

  const isVanishing = (p) => Boolean(p.act && p.act.pose === 'vanish');
  const enter = (p) => act(p, 'appear');

  /** I personaggi di una voce del cast; group li tiene insieme quando il cast cambia. */
  function spawn(id, group, width, size, random) {
    const kinds = Sprites.CAST[id] || [];
    const tag = (p) => ({ ...p, cast: id, group });
    return kinds.map((kind) => tag(newPet(`${group}`, kind, random() * maxX(kind, size, width), random() < 0.5 ? -1 : 1, random)));
  }

  /**
   * @param {{cast: string[], width: number, size: number, random?: () => number}} opts
   */
  function createPets({ cast, width, size, random = Math.random }) {
    const pets = cast.flatMap((id, i) => spawn(id, i, width, size, random).map(enter));
    return { size, seq: cast.length, pets };
  }

  /**
   * Il cast cambia a striscia accesa: chi resta continua da dov'è, chi esce
   * svanisce (se ha la posa, altrimenti sparisce subito) e chi entra appare.
   */
  function recast(state, { cast, width, random = Math.random }) {
    const wanted = cast.reduce((m, id) => ({ ...m, [id]: (m[id] || 0) + 1 }), {});
    const groups = [...new Set(state.pets.filter((p) => !isVanishing(p)).map((p) => p.group))];
    const { kept, leaving, taken } = groups.reduce((acc, g) => {
      const members = state.pets.filter((p) => p.group === g);
      const id = members[0].cast;
      const n = (acc.taken[id] || 0) + 1;
      const stays = n <= (wanted[id] || 0);
      return {
        kept: stays ? [...acc.kept, ...members] : acc.kept,
        leaving: stays ? acc.leaving : [...acc.leaving, ...members],
        taken: { ...acc.taken, [id]: n },
      };
    }, { kept: [], leaving: [], taken: {} });
    const adding = Object.entries(wanted).flatMap(([id, n]) => Array(Math.max(0, n - (taken[id] || 0))).fill(id));
    const entering = adding.flatMap((id, k) => spawn(id, state.seq + k, width, state.size, random).map(enter));
    const vanishing = [...state.pets.filter(isVanishing), ...leaving.map((p) => act(p, 'vanish')).filter(isVanishing)];
    return { ...state, seq: state.seq + adding.length, pets: [...kept, ...vanishing, ...entering] };
  }

  /** Quale stato mostrare: chi aspetta vince su chi lavora, il sonno viene per ultimo. */
  function moodOf({ running, attention, idleMs }) {
    if (attention) return 'attention';
    if (running) return 'busy';
    return idleMs >= SLEEP_AFTER_MS ? 'sleep' : 'idle';
  }

  const frameIndex = (pet, n) => Math.floor(pet.anim / FRAME_MS) % n;

  /** Si muove di v misure al secondo in pet.dir e rimbalza ai bordi. */
  function walk(pet, v, ctx) {
    const limit = maxX(pet.kind, ctx.size, ctx.width);
    const x = pet.x + pet.dir * v * ctx.size * ctx.mult * ctx.s;
    if (x <= 0) return { ...pet, x: 0, dir: 1 };
    if (x >= limit) return { ...pet, x: limit, dir: -1 };
    return { ...pet, x };
  }

  const advance = (pet, hz, ctx) => (pet.phase + ctx.s * ctx.mult * hz * Math.PI * 2) % (Math.PI * 2);
  const wave = ({ base, ampl, hz }) => (pet, ctx) => {
    const phase = advance(pet, hz, ctx);
    return { ...pet, phase, y: (base + Math.sin(phase) * ampl) * ctx.size };
  };

  /** Quota e posa secondo il modo di muoversi (pets-sprites.js MOTIONS). */
  const MOVES = {
    walk: (pet) => pet,
    hop(pet, ctx) {
      const phase = advance(pet, HOP_HZ, ctx);
      const up = Math.sin(phase);
      return up > 0
        ? { ...pet, phase, y: up * HOP_HEIGHT * ctx.size, pose: 'jump' }
        : { ...pet, phase, y: 0 };
    },
    fly: wave(FLY),
    swim: wave(SWIM),
  };

  /** A terra per dormire o chiamare: chi vola, salta o galleggia (la medusa) scende,
   *  e chi ha l'ombra (il fantasmino), che fluttua basso ma si posa. */
  const floats = (pet) => {
    const sprite = spriteOf(pet.kind);
    return ['hop', 'fly'].includes(sprite.motion) || Boolean(sprite.shadow) || pet.kind === 'medusa';
  };
  const landed = (pet) => (floats(pet) ? { ...pet, y: 0 } : pet);

  /** Chi soffia bolle (pets-sprites.js bubbles) chiama verso il lato dove
   *  c'è posto per le bolle: al bordo si gira, se dall'altra parte ce n'è di più. */
  function facingRoom(pet, ctx) {
    const { bubbles } = spriteOf(pet.kind);
    if (!bubbles) return pet;
    const right = ctx.width - pet.x - petWidth(pet.kind, ctx.size);
    const [ahead, behind] = pet.dir > 0 ? [right, pet.x] : [pet.x, right];
    // Senza posto da nessuna parte non si gira a ogni frame
    const turn = ahead < bubbles[0][0].length * Sprites.pixel(pet.kind, ctx.size) && behind > ahead;
    return turn ? { ...pet, dir: -pet.dir } : pet;
  }

  function wander(pet, ctx) {
    const sprite = spriteOf(pet.kind);
    if (has(pet.kind, 'idle') && ctx.random() < PAUSE_PER_S * ctx.s) {
      return act(pet, 'idle', PAUSE_MS.min + ctx.random() * (PAUSE_MS.max - PAUSE_MS.min));
    }
    const turned = ctx.random() < TURN_PER_S * ctx.s ? { ...pet, dir: -pet.dir } : pet;
    const moved = MOVES[sprite.motion]({ ...turned, pose: 'walk' }, ctx);
    // La rana seduta non avanza
    const v = sprite.motion === 'hop' && moved.pose !== 'jump' ? 0 : sprite.speed;
    const walked = walk(moved, v, ctx);
    return walked.dir !== pet.dir ? act(walked, 'turn') : walked;
  }

  /** Ondeggio: y è quanto sta sollevata da terra. */
  function float(jelly, ctx) {
    const phase = (jelly.phase + ctx.s * BOB_HZ * Math.PI * 2) % (Math.PI * 2);
    return { ...jelly, phase, y: (1 + Math.sin(phase)) * BOB_AMPL * ctx.size };
  }

  /** Il personaggio più vicino al centro che chiama quando una sessione
   *  aspetta. La medusa solo se non c'è nessun altro: per chiamare deve posarsi. */
  function callerOf(pets, ctx) {
    const mid = ctx.width / 2;
    const present = pets.filter((p) => !isVanishing(p));
    const others = present.filter((p) => p.kind !== 'medusa');
    return (others.length ? others : present)
      .reduce((best, p) => (!best || Math.abs(centerOf(p, ctx.size) - mid) < Math.abs(centerOf(best, ctx.size) - mid) ? p : best), null);
  }

  /** Il fumo (pets-sprites.js trail): gli sbuffi invecchiano e salgono, i
   *  vecchi svaniscono; ogni tanto ne nasce uno dal caffè, dietro rispetto a
   *  dove va, e resta dove è nato: camminando se li lascia dietro. Da fredda
   *  (dorme) non fuma; steam è il tempo dall'ultimo sbuffo. */
  function smoke(pet, ctx) {
    const { trail } = spriteOf(pet.kind);
    if (!trail) return pet;
    const ms = ctx.s * 1000;
    const alive = pet.puffs
      .map((p) => ({ ...p, age: p.age + ms, y: p.y + PUFF_RISE * ctx.size * ctx.s }))
      .filter((p) => p.age < PUFF_LIFE_MS);
    const cold = pet.pose === 'sleep' || isVanishing(pet);
    // Di fretta ne nascono di più, ma invecchiano a tempo reale: la scia si infittisce
    const steam = cold ? 0 : pet.steam + ms * ctx.mult;
    if (steam < PUFF_EVERY_MS) return { ...pet, puffs: alive, steam };
    const px = Sprites.pixel(pet.kind, ctx.size);
    const { cols, rows } = Sprites.dims(pet.kind);
    const col = pet.dir > 0 ? trail.at.col + 0.5 : cols - trail.at.col - 0.5;
    const puff = { x: pet.x + col * px, y: pet.y + (rows - trail.at.row) * px, age: 0 };
    return { ...pet, puffs: [...alive, puff].slice(-MAX_PUFFS), steam: 0 };
  }

  /** Nessuno resta fuori se la striscia si è stretta. */
  function inside(pet, ctx) {
    const limit = maxX(pet.kind, ctx.size, ctx.width);
    const puffs = pet.puffs ? { puffs: pet.puffs.map((p) => ({ ...p, x: clamp(p.x, 0, ctx.width) })) } : {};
    return { ...pet, ...puffs, x: clamp(pet.x, 0, limit) };
  }

  /** Solo il rientro nei bordi, per quando la striscia cambia misura a ciclo fermo. */
  const fit = (state, width) => ({ ...state, pets: state.pets.map((p) => inside(p, { size: state.size, width })) });

  /** Le azioni che partono al cambio di umore: spavento quando si comincia a
   *  lavorare, risata di chi chiamava quando l'attesa finisce. Non
   *  interrompono un'azione in corso. */
  function startActs(pet, state, mood) {
    if (pet.act) return pet;
    const prev = state.mood || 'idle';
    if (mood === 'busy' && prev !== 'busy') return act(pet, 'startle');
    if (prev === 'attention' && mood !== 'attention' && pet.key === state.caller) return act(pet, 'laugh');
    return pet;
  }

  /**
   * Un passo di simulazione.
   * @param {{size: number, pets: object[]}} state
   * @param {{dt: number, width: number, mood?: string, speed?: number, random?: () => number}} opts
   *   speed: moltiplicatore scelto nelle impostazioni (pets-config.js SPEEDS)
   */
  function step(state, { dt, width, mood = 'idle', speed = 1, random = Math.random }) {
    const s = Math.min(Math.max(dt, 0), MAX_DT) / 1000;
    const ctx = { size: state.size, width, s, random, mult: speed * (mood === 'busy' ? BUSY_FACTOR : 1) };
    const attentionMs = mood === 'attention' ? (state.attentionMs || 0) + s * 1000 : 0;
    const pets = state.pets.map((p) => ({ ...inside(p, ctx), anim: p.anim + s * 1000 * ctx.mult }));
    const caller = mood === 'attention' ? callerOf(pets, ctx) : null;
    const moved = pets.map((p0) => {
      const p = startActs(p0, state, mood);
      if (isVanishing(p)) return tickAct(p, ctx);
      const calling = caller && p.key === caller.key;
      const pose = mood === 'sleep' ? 'sleep' : calling && (attentionMs >= SAD_AFTER_MS && has(p.kind, 'sad') ? 'sad' : 'call');
      if (mood === 'sleep') return { ...landed(p), pose, anim: p0.anim - s * 1000 * ctx.mult, act: null };
      if (calling) return { ...facingRoom(landed(p), ctx), act: null, pose };
      if (p.act) return tickAct(p, ctx);
      if (p.kind === 'medusa') return float(wander(p, ctx), ctx);
      return wander(p, ctx);
    });
    return { ...state, mood, attentionMs, caller: caller ? caller.key : state.caller || null, pets: moved.filter((p) => !p.gone).map((p) => smoke(p, ctx)) };
  }

  return { createPets, recast, step, fit, moodOf, frameIndex, petWidth, FRAME_MS, MAX_DT, SLEEP_AFTER_MS, SAD_AFTER_MS, PAUSE_MS, PUFF_LIFE_MS, MAX_PUFFS };
});
