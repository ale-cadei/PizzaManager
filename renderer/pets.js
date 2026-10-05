/* Motore degli animaletti (docs/plans/33-animaletti.md): dove sta ognuno,
 * in che direzione va, che posa ha. Niente DOM: la vista (pets-view.js)
 * chiama step() a ogni frame e disegna quello che trova.
 *
 * Unità: x in pixel dal bordo sinistro della striscia, dt in millisecondi,
 * velocità in "misure al secondo" (una misura = size, l'altezza di
 * riferimento), così un personaggio grande non sembra più lento.
 *
 * L'inseguimento: Il pescatore punta la medusa; lei, quando lo sente vicino,
 * scappa più veloce di lui verso il lato con spazio. Messa all'angolo, o
 * se se lo trova addosso, si alza (lift) e gli passa sopra: il retino non la
 * prende mai, ed è una regola verificata nei test.
 *
 * Chi non cammina (MOVES): la rana salta e avanza solo in aria, l'uccellino
 * vola sopra la striscia e si posa per dormire o chiamare, il pesce nuota
 * ondeggiando appena sopra il fondo. Chi ha un posatoio (l'ape col fiore,
 * pets-sprites.js perch) ce l'ha in un punto fisso, home: per dormire o
 * chiamare ci vola sopra e si siede all'altezza del disegno. Chi fuma (la
 * tazzina, trail) lascia sbuffi che restano dove nascono e salgono: sono
 * nello stato del personaggio (puffs), la vista li disegna a parte.
 *
 * In fila (una voce del cast con più personaggi, come la papera con gli
 * anatroccoli): ognuno ha un lead, quello davanti, e gli sta dietro
 * rispetto al verso in cui va; arrivato si ferma. Se il lead si gira, chi
 * si trova davanti lo aspetta e lo lascia passare. Chi segue non chiama.
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
  /** In fila: distanza fra i centri (misure) e quanto più svelto recupera chi segue. */
  const LINE_GAP = 0.9;
  const CATCH_UP = 1.6;
  /** Sotto questo spostamento (misure) chi segue è fermo: zampetta solo se si muove davvero. */
  const STILL = 0.001;
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
    return { key, kind, variant: pickVariant(kind, random), x, y: 0, dir, pose: 'walk', anim: 0, lift: 0, passing: false, phase: random() * Math.PI * 2, mate: null, act: null, ...smoke };
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

  /** La medusa nasce a qualche misura da il pescatore, dalla parte con più spazio. */
  function placePair(sponge, jellyKey, width, size, random) {
    const limit = maxX('medusa', size, width);
    const side = sponge.x > limit / 2 ? -1 : 1;
    const x = clamp(sponge.x + side * START_GAP * size, 0, limit);
    return { ...newPet(jellyKey, 'medusa', x, side, random), mate: sponge.key };
  }

  /** Il punto del posatoio, per chi ne ha uno: la x a cui si posa. */
  const withHome = (pet, width, size, random) => (spriteOf(pet.kind).perch ? { ...pet, home: random() * maxX(pet.kind, size, width) } : pet);

  /** In fila dietro al primo, ognuno col suo lead: quello davanti. */
  function placeLine([first, ...rest], group, width, size, random) {
    const lead = newPet(`${group}a`, first, random() * maxX(first, size, width), random() < 0.5 ? -1 : 1, random);
    return rest.reduce((line, kind, i) => {
      const ahead = line[line.length - 1];
      const x = clamp(centerOf(ahead, size) - ahead.dir * LINE_GAP * size - petWidth(kind, size) / 2, 0, maxX(kind, size, width));
      const key = `${group}${String.fromCharCode(98 + i)}`;
      return [...line, { ...newPet(key, kind, x, ahead.dir, random), lead: ahead.key }];
    }, [lead]);
  }

  /** I personaggi di una voce del cast; group li tiene insieme quando il cast cambia. */
  function spawn(id, group, width, size, random) {
    const kinds = Sprites.CAST[id] || [];
    const tag = (p) => ({ ...withHome(p, width, size, random), cast: id, group });
    if (kinds[0] === 'pescatore') {
      const [sKey, jKey] = [`${group}a`, `${group}b`];
      const sponge = { ...newPet(sKey, kinds[0], random() * maxX(kinds[0], size, width), 1, random), mate: jKey };
      return [sponge, placePair(sponge, jKey, width, size, random)].map(tag);
    }
    if (kinds.length > 1) return placeLine(kinds, group, width, size, random).map(tag);
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
  const landed = (pet) => (floats(pet) ? { ...pet, y: 0, lift: 0 } : pet);

  /** Verso il posatoio in volo; arrivato si siede sul disegno con quella posa
   *  (chi dorme non anima). */
  function perch(pet, pose, ctx) {
    const reach = spriteOf(pet.kind).speed * ctx.size * ctx.mult * ctx.s;
    const dx = pet.home - pet.x;
    if (Math.abs(dx) > reach) {
      const dir = Math.sign(dx);
      return MOVES[spriteOf(pet.kind).motion]({ ...pet, x: pet.x + dir * reach, dir, pose: 'walk', act: null }, ctx);
    }
    const y = spriteOf(pet.kind).perch.seat * Sprites.pixel(pet.kind, ctx.size);
    const anim = pose === 'sleep' ? pet.anim - ctx.s * 1000 * ctx.mult : pet.anim;
    return { ...pet, x: pet.home, y, lift: 0, pose, anim, act: null };
  }

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

  function chase(sponge, jelly, ctx) {
    const dx = centerOf(jelly, ctx.size) - centerOf(sponge, ctx.size);
    const dir = Math.sign(dx) || sponge.dir;
    const close = Math.abs(dx) < SWING_DIST * ctx.size;
    const v = Sprites.SPRITES.pescatore.speed * (close ? SWING_SLOWDOWN : 1);
    const limit = maxX(sponge.kind, ctx.size, ctx.width);
    const x = clamp(sponge.x + dir * v * ctx.size * ctx.mult * ctx.s, 0, limit);
    return { ...sponge, x, dir, pose: close ? 'swing' : 'walk' };
  }

  /** Fermo con la posa del passo: la zampettata non va avanti. */
  const standing = (pet, dir, ctx) => ({ ...pet, dir, pose: 'walk', anim: pet.anim - ctx.s * 1000 * ctx.mult });

  /** Dietro a lead, dalla parte opposta al suo verso; arrivato si ferma e guarda
   *  dove guarda lui. Se lead si gira e se lo trova davanti non gli passa
   *  attraverso: lo aspetta guardandolo, e quando è passato gli va dietro. */
  function follow(pet, lead, ctx) {
    const side = Math.sign(centerOf(pet, ctx.size) - centerOf(lead, ctx.size));
    if (side === lead.dir) return standing(pet, -lead.dir, ctx);
    const target = centerOf(lead, ctx.size) - lead.dir * LINE_GAP * ctx.size;
    const dx = target - centerOf(pet, ctx.size);
    const reach = spriteOf(pet.kind).speed * CATCH_UP * ctx.size * ctx.mult * ctx.s;
    const limit = maxX(pet.kind, ctx.size, ctx.width);
    if (Math.abs(dx) <= reach) {
      // Lead in cammino si sposta un po' ogni fotogramma: chi gli sta dietro lo segue zampettando
      const kept = { ...pet, x: clamp(pet.x + dx, 0, limit), dir: lead.dir, pose: 'walk' };
      return Math.abs(dx) > STILL * ctx.size ? kept : standing(kept, lead.dir, ctx);
    }
    const dir = Math.sign(dx);
    return { ...pet, x: clamp(pet.x + dir * reach, 0, limit), dir, pose: 'walk' };
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

  /** Il personaggio più vicino al centro che chiama quando una sessione
   *  aspetta. La medusa solo se non c'è nessun altro: in coppia tocca al pescatore.
   *  Chi sta in fila dietro a qualcuno mai: chiama il primo. */
  function callerOf(pets, ctx) {
    const mid = ctx.width / 2;
    const present = pets.filter((p) => !isVanishing(p) && !p.lead);
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
    const home = pet.home === undefined ? {} : { home: clamp(pet.home, 0, limit) };
    const puffs = pet.puffs ? { puffs: pet.puffs.map((p) => ({ ...p, x: clamp(p.x, 0, ctx.width) })) } : {};
    return { ...pet, ...home, ...puffs, x: clamp(pet.x, 0, limit) };
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
    const byKey = new Map(pets.map((p) => [p.key, p]));
    const mateOf = (p) => (p.mate ? byKey.get(p.mate) : null);
    const moved = pets.map((p0) => {
      const p = startActs(p0, state, mood);
      if (isVanishing(p)) return tickAct(p, ctx);
      const calling = caller && p.key === caller.key;
      const pose = mood === 'sleep' ? 'sleep' : calling && (attentionMs >= SAD_AFTER_MS && has(p.kind, 'sad') ? 'sad' : 'call');
      if (pose && p.home !== undefined) return perch(p, pose, ctx);
      if (mood === 'sleep') return { ...landed(p), pose, anim: p0.anim - s * 1000 * ctx.mult, act: null };
      if (calling) return { ...facingRoom(landed(p), ctx), act: null, pose };
      if (p.act) return tickAct(p, ctx);
      const lead = p.lead ? byKey.get(p.lead) : null;
      if (lead) return follow(p, lead, ctx);
      const mate = mateOf(p);
      if (p.kind === 'pescatore' && mate) return chase(p, mate, ctx);
      if (p.kind === 'medusa') return mate ? flee(p, mate, ctx) : float(wander(p, ctx), ctx);
      return wander(p, ctx);
    });
    return { ...state, mood, attentionMs, caller: caller ? caller.key : state.caller || null, pets: moved.filter((p) => !p.gone).map((p) => smoke(p, ctx)) };
  }

  return { createPets, recast, step, fit, moodOf, frameIndex, petWidth, FRAME_MS, MAX_DT, SLEEP_AFTER_MS, SAD_AFTER_MS, PAUSE_MS, LINE_GAP, PUFF_LIFE_MS, MAX_PUFFS };
});
