/* Motore degli animaletti (docs/plans/33-animaletti.md): dove sta ognuno,
 * in che direzione va, che posa ha. Niente DOM: la vista (pets-view.js)
 * chiama step() a ogni frame e disegna quello che trova.
 *
 * Unità: x in pixel dal bordo sinistro della striscia, dt in millisecondi,
 * velocità in "misure al secondo" (una misura = size, l'altezza di
 * riferimento), così un personaggio grande non sembra più lento.
 *
 * L'inseguimento: SpongeBob punta la medusa; lei, quando lo sente vicino,
 * scappa più veloce di lui verso il lato con spazio. Messa all'angolo, o
 * se se lo trova addosso, si alza (lift) e gli passa sopra: il retino non la
 * prende mai, ed è una regola verificata nei test.
 *
 * Chi non cammina (MOVES): la rana salta e avanza solo in aria, l'uccellino
 * vola sopra la striscia e si posa per dormire o chiamare, il pesce nuota
 * ondeggiando appena sopra il fondo.
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
  // Distanze fra i centri, in misure
  const SWING_DIST = 1.2;
  const FLEE_DIST = 2.2;
  const TOO_CLOSE = 0.8;
  const START_GAP = 3;
  /** Spazio sotto il quale la medusa non può più scappare da quella parte. */
  const CORNER = 0.25;
  const FLEE_FACTOR = 2.6;
  const SWING_SLOWDOWN = 0.4;
  /** Ondeggio della medusa: ampiezza in misure, giri al secondo. */
  const BOB_AMPL = 0.12;
  const BOB_HZ = 0.8;
  /** Quanto in fretta la medusa ridiscende dopo il salto, misure al secondo. */
  const LIFT_FALL = 2;
  /** Rana: salti al secondo e altezza in misure. Sta in aria metà del tempo. */
  const HOP_HZ = 1.2;
  const HOP_HEIGHT = 0.6;
  /** Uccellino e pesce: quota media, ampiezza dell'ondeggio (misure), giri al secondo. */
  const FLY = { base: 1, ampl: 0.3, hz: 0.5 };
  const SWIM = { base: 0.22, ampl: 0.15, hz: 0.6 };

  /** Larghezza in pixel: le colonne del disegno per il lato del pixel (Sprites.pixel). */
  function petWidth(kind, size) {
    return Sprites.dims(kind).cols * Sprites.pixel(kind, size);
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const maxX = (kind, size, width) => Math.max(0, width - petWidth(kind, size));
  const centerOf = (p, size) => p.x + petWidth(p.kind, size) / 2;

  function newPet(key, kind, x, dir, random) {
    return { key, kind, x, y: 0, dir, pose: 'walk', anim: 0, lift: 0, passing: false, phase: random() * Math.PI * 2, mate: null };
  }

  /** La medusa nasce a qualche misura da SpongeBob, dalla parte con più spazio. */
  function placePair(sponge, jellyKey, width, size, random) {
    const limit = maxX('medusa', size, width);
    const side = sponge.x > limit / 2 ? -1 : 1;
    const x = clamp(sponge.x + side * START_GAP * size, 0, limit);
    return { ...newPet(jellyKey, 'medusa', x, side, random), mate: sponge.key };
  }

  /**
   * @param {{cast: string[], width: number, size: number, random?: () => number}} opts
   */
  function createPets({ cast, width, size, random = Math.random }) {
    const pets = cast.flatMap((id, i) => {
      const kinds = Sprites.CAST[id] || [];
      if (kinds.length === 2) {
        const [sKey, jKey] = [`${i}a`, `${i}b`];
        const sponge = { ...newPet(sKey, kinds[0], random() * maxX(kinds[0], size, width), 1, random), mate: jKey };
        return [sponge, placePair(sponge, jKey, width, size, random)];
      }
      return kinds.map((kind) => newPet(`${i}`, kind, random() * maxX(kind, size, width), random() < 0.5 ? -1 : 1, random));
    });
    return { size, pets };
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

  /** Chi salta o vola, per dormire o chiamare, scende a terra. */
  const landed = (pet) => (['hop', 'fly'].includes(Sprites.SPRITES[pet.kind].motion) ? { ...pet, y: 0 } : pet);

  function wander(pet, ctx) {
    const sprite = Sprites.SPRITES[pet.kind];
    const turned = ctx.random() < TURN_PER_S * ctx.s ? { ...pet, dir: -pet.dir } : pet;
    const moved = MOVES[sprite.motion]({ ...turned, pose: 'walk' }, ctx);
    // La rana seduta non avanza
    const v = sprite.motion === 'hop' && moved.pose !== 'jump' ? 0 : sprite.speed;
    return walk(moved, v, ctx);
  }

  function chase(sponge, jelly, ctx) {
    const dx = centerOf(jelly, ctx.size) - centerOf(sponge, ctx.size);
    const dir = Math.sign(dx) || sponge.dir;
    const close = Math.abs(dx) < SWING_DIST * ctx.size;
    const v = Sprites.SPRITES.spongebob.speed * (close ? SWING_SLOWDOWN : 1);
    const limit = maxX(sponge.kind, ctx.size, ctx.width);
    const x = clamp(sponge.x + dir * v * ctx.size * ctx.mult * ctx.s, 0, limit);
    return { ...sponge, x, dir, pose: close ? 'swing' : 'walk' };
  }

  /** Ondeggio e discesa dopo il salto: y è quanto sta sollevata da terra. */
  function float(jelly, ctx) {
    const phase = (jelly.phase + ctx.s * BOB_HZ * Math.PI * 2) % (Math.PI * 2);
    const lift = jelly.passing ? ctx.size : Math.max(0, jelly.lift - LIFT_FALL * ctx.size * ctx.s);
    return { ...jelly, phase, lift, y: lift + (1 + Math.sin(phase)) * BOB_AMPL * ctx.size };
  }

  function flee(jelly, sponge, ctx) {
    const { size } = ctx;
    const dx = centerOf(jelly, size) - centerOf(sponge, size);
    const dist = Math.abs(dx);
    const speed = Sprites.SPRITES.medusa.speed;
    if (jelly.passing) {
      const past = Math.sign(dx) === jelly.dir && dist > size;
      return float(walk({ ...jelly, pose: 'flee', passing: !past }, speed * FLEE_FACTOR, ctx), ctx);
    }
    if (dist >= FLEE_DIST * size) return float(wander(jelly, ctx), ctx);
    const away = Math.sign(dx) || jelly.dir;
    const limit = maxX('medusa', size, ctx.width);
    const room = away > 0 ? limit - jelly.x : jelly.x;
    const cornered = room < CORNER * size || dist < TOO_CLOSE * size;
    const next = { ...jelly, pose: 'flee', dir: cornered ? -away : away, passing: cornered };
    return float(walk(cornered ? { ...next, lift: size } : next, speed * FLEE_FACTOR, ctx), ctx);
  }

  /** Il personaggio più vicino al centro che chiama quando una sessione aspetta (mai la medusa). */
  function callerOf(pets, ctx) {
    const mid = ctx.width / 2;
    return pets
      .filter((p) => p.kind !== 'medusa')
      .reduce((best, p) => (!best || Math.abs(centerOf(p, ctx.size) - mid) < Math.abs(centerOf(best, ctx.size) - mid) ? p : best), null);
  }

  /** Nessuno resta fuori se la striscia si è stretta. */
  const inside = (pet, ctx) => ({ ...pet, x: clamp(pet.x, 0, maxX(pet.kind, ctx.size, ctx.width)) });

  /** Solo il rientro nei bordi, per quando la striscia cambia misura a ciclo fermo. */
  const fit = (state, width) => ({ ...state, pets: state.pets.map((p) => inside(p, { size: state.size, width })) });

  /**
   * Un passo di simulazione.
   * @param {{size: number, pets: object[]}} state
   * @param {{dt: number, width: number, mood?: string, speed?: number, random?: () => number}} opts
   *   speed: moltiplicatore scelto nelle impostazioni (pets-config.js SPEEDS)
   */
  function step(state, { dt, width, mood = 'idle', speed = 1, random = Math.random }) {
    const s = Math.min(Math.max(dt, 0), MAX_DT) / 1000;
    const ctx = { size: state.size, width, s, random, mult: speed * (mood === 'busy' ? BUSY_FACTOR : 1) };
    const pets = state.pets.map((p) => inside(p, ctx));
    if (mood === 'sleep') return { ...state, pets: pets.map((p) => ({ ...landed(p), pose: 'sleep' })) };

    const caller = mood === 'attention' ? callerOf(pets, ctx) : null;
    const byKey = new Map(pets.map((p) => [p.key, p]));
    const mateOf = (p) => (p.mate ? byKey.get(p.mate) : null);
    const moved = pets.map((p) => {
      const anim = p.anim + s * 1000 * ctx.mult;
      if (caller && p.key === caller.key) return { ...landed(p), anim, pose: 'call' };
      const mate = mateOf(p);
      if (p.kind === 'spongebob' && mate) return { ...chase(p, mate, ctx), anim };
      if (p.kind === 'medusa' && mate) return { ...flee(p, mate, ctx), anim };
      return { ...wander(p, ctx), anim };
    });
    return { ...state, pets: moved };
  }

  return { createPets, step, fit, moodOf, frameIndex, petWidth, FRAME_MS, MAX_DT, SLEEP_AFTER_MS };
});
