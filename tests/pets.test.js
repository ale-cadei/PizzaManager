// renderer/pets.js: movimento, inseguimento e stati degli animaletti
const assert = require('node:assert');
const { test: ok } = require('node:test');
const Pets = require('../renderer/pets');
const { createPets, recast, step, moodOf, frameIndex, petWidth, SLEEP_AFTER_MS, SAD_AFTER_MS, FRAME_MS } = Pets;

const SIZE = 32;
const WIDTH = 800;
/** Numeri "casuali" ripetibili: stessi test, stessi percorsi. */
function seeded(seed = 1) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
const never = () => 0.999; // nessun cambio di direzione a caso
const center = (p) => p.x + petWidth(p.kind, SIZE) / 2;
const byKind = (state, kind) => state.pets.find((p) => p.kind === kind);
const deepFreeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };

function run(state, n, opts) {
  let s = state;
  for (let i = 0; i < n; i += 1) s = step(s, { dt: 16, width: WIDTH, ...opts });
  return s;
}
/** Numeri "casuali" in fila, poi sempre l'ultimo. */
function queue(values, then = 0.999) {
  const left = [...values];
  return () => (left.length ? left.shift() : then);
}
/** Un cast già in scena: senza l'entrata iniziale, per provare quello che viene dopo. */
function onStage(cast, random = () => 0.5) {
  const state = createPets({ cast, width: WIDTH, size: SIZE, random });
  return { ...state, pets: state.pets.map((p) => ({ ...p, act: null, pose: 'walk' })) };
}
const stillFor = (state, ms, opts) => run(state, Math.ceil(ms / 16), { random: never, ...opts });

ok('pets: createPets mette un pet per personaggio del cast, dentro la striscia', () => {
  const state = createPets({ cast: ['inseguimento', 'lumaca'], width: WIDTH, size: SIZE, random: seeded() });
  assert.deepStrictEqual(state.pets.map((p) => p.kind), ['pescatore', 'medusa', 'lumaca']);
  for (const p of state.pets) {
    assert.ok(p.x >= 0 && p.x <= WIDTH - petWidth(p.kind, SIZE), `${p.kind} fuori: ${p.x}`);
    assert.strictEqual(p.pose, 'walk');
  }
  const sponge = byKind(state, 'pescatore');
  const jelly = byKind(state, 'medusa');
  assert.strictEqual(sponge.mate, jelly.key);
  assert.strictEqual(jelly.mate, sponge.key);
  assert.ok(Math.abs(center(jelly) - center(sponge)) >= SIZE, 'la medusa nasce già sotto il retino');
});

ok('pets: step non tocca lo stato che riceve', () => {
  const state = deepFreeze(createPets({ cast: ['inseguimento', 'gatto'], width: WIDTH, size: SIZE, random: seeded() }));
  const next = step(state, { dt: 16, width: WIDTH, mood: 'busy', random: seeded(2) });
  assert.notStrictEqual(next, state);
  assert.notStrictEqual(next.pets[0], state.pets[0]);
});

ok('pets: nessuno esce dalla striscia, nemmeno quando la finestra si stringe', () => {
  let state = createPets({ cast: ['gatto', 'pizza', 'inseguimento', 'stella'], width: WIDTH, size: SIZE, random: seeded(3) });
  const random = seeded(4);
  for (let i = 0; i < 2000; i += 1) {
    const width = i < 1000 ? WIDTH : 300;
    state = step(state, { dt: 16, width, mood: 'busy', random });
    for (const p of state.pets) {
      assert.ok(p.x >= 0 && p.x <= width - petWidth(p.kind, SIZE) + 1e-9, `${p.kind} a ${p.x} con larghezza ${width}`);
    }
  }
});

ok('pets: fit rimette dentro chi è rimasto fuori, senza muovere né cambiare posa agli altri', () => {
  const state = deepFreeze(run(createPets({ cast: ['inseguimento', 'gatto'], width: WIDTH, size: SIZE, random: seeded(5) }), 100, { mood: 'sleep' }));
  const narrow = 200;
  const next = Pets.fit(state, narrow);
  next.pets.forEach((p, i) => {
    const was = state.pets[i];
    assert.strictEqual(p.x, Math.min(was.x, narrow - petWidth(p.kind, SIZE)), `${p.kind} spostato male`);
    assert.strictEqual(p.pose, 'sleep');
    assert.strictEqual(p.anim, was.anim);
  });
});

ok('pets: un dt enorme (scheda tornata in primo piano) non teletrasporta', () => {
  const state = createPets({ cast: ['gatto'], width: WIDTH, size: SIZE, random: () => 0.5 });
  const next = step(state, { dt: 60000, width: WIDTH, mood: 'idle', random: never });
  assert.ok(Math.abs(next.pets[0].x - state.pets[0].x) < SIZE, 'spostamento limitato a MAX_DT');
});

ok('pets: con un agente al lavoro corrono il doppio', () => {
  const state = createPets({ cast: ['gatto'], width: WIDTH, size: SIZE, random: () => 0.5 });
  const moved = (mood) => Math.abs(step(state, { dt: 50, width: WIDTH, mood, random: never }).pets[0].x - state.pets[0].x);
  assert.ok(moved('idle') > 0);
  assert.ok(Math.abs(moved('busy') - 2 * moved('idle')) < 1e-9);
});

ok('pets: la velocità scelta nelle impostazioni moltiplica lo spostamento', () => {
  const state = createPets({ cast: ['gatto'], width: WIDTH, size: SIZE, random: () => 0.5 });
  const moved = (speed) => Math.abs(step(state, { dt: 50, width: WIDTH, mood: 'idle', speed, random: never }).pets[0].x - state.pets[0].x);
  assert.ok(Math.abs(moved(0.5) - moved(1) / 2) < 1e-9);
});

ok('pets: tutto fermo da tanto → dormono, fermi', () => {
  const state = createPets({ cast: ['inseguimento', 'stella'], width: WIDTH, size: SIZE, random: seeded() });
  const next = run(state, 30, { mood: 'sleep', random: never });
  next.pets.forEach((p, i) => {
    assert.strictEqual(p.pose, 'sleep');
    assert.strictEqual(p.x, state.pets[i].x);
  });
});

ok('pets: una sessione aspetta → il più vicino al centro (mai la medusa) si ferma e chiama', () => {
  const state = {
    size: SIZE,
    pets: [
      { ...createPets({ cast: ['gatto'], width: WIDTH, size: SIZE, random: never }).pets[0], key: 'a', x: 100 },
      { ...createPets({ cast: ['pizza'], width: WIDTH, size: SIZE, random: never }).pets[0], key: 'b', x: 380 },
    ],
  };
  const next = step(state, { dt: 16, width: WIDTH, mood: 'attention', random: never });
  const [a, b] = next.pets;
  assert.strictEqual(b.pose, 'call');
  assert.strictEqual(b.x, 380);
  assert.strictEqual(a.pose, 'walk');
  assert.notStrictEqual(a.x, 100);

  const pair = createPets({ cast: ['inseguimento'], width: WIDTH, size: SIZE, random: seeded() });
  const moved = { ...pair, pets: pair.pets.map((p) => (p.kind === 'medusa' ? { ...p, x: 384 } : { ...p, x: 50 })) };
  const called = step(moved, { dt: 16, width: WIDTH, mood: 'attention', random: never });
  assert.strictEqual(byKind(called, 'pescatore').pose, 'call');
  assert.notStrictEqual(byKind(called, 'medusa').pose, 'call');
});

ok('pets: Il pescatore va sempre verso la medusa', () => {
  const base = createPets({ cast: ['inseguimento'], width: WIDTH, size: SIZE, random: seeded() });
  for (const [sx, jx] of [[100, 600], [600, 100]]) {
    const state = { ...base, pets: base.pets.map((p) => ({ ...p, x: p.kind === 'pescatore' ? sx : jx })) };
    const next = step(state, { dt: 16, width: WIDTH, mood: 'idle', random: never });
    const before = Math.abs(jx - sx);
    const sponge = byKind(next, 'pescatore');
    assert.ok(Math.abs(jx - sponge.x) < before, 'il pescatore si allontana');
    assert.strictEqual(sponge.dir, Math.sign(jx - sx));
  }
});

ok('pets: da vicino il pescatore dà il colpo di retino e la medusa scappa', () => {
  const base = createPets({ cast: ['inseguimento'], width: WIDTH, size: SIZE, random: seeded() });
  // Centri a una misura di distanza: sotto la soglia del colpo, qualunque larghezza abbiano i disegni
  const jellyX = 300 + petWidth('pescatore', SIZE) / 2 - petWidth('medusa', SIZE) / 2 + SIZE;
  const state = { ...base, pets: base.pets.map((p) => ({ ...p, x: p.kind === 'pescatore' ? 300 : jellyX })) };
  const next = step(state, { dt: 16, width: WIDTH, mood: 'idle', random: never });
  assert.strictEqual(byKind(next, 'pescatore').pose, 'swing');
  const jelly = byKind(next, 'medusa');
  assert.strictEqual(jelly.pose, 'flee');
  assert.strictEqual(jelly.dir, 1, 'scappa dalla parte opposta al pescatore');
});

ok('pets: messa all angolo la medusa gli passa sopra', () => {
  const base = createPets({ cast: ['inseguimento'], width: WIDTH, size: SIZE, random: seeded() });
  const jw = petWidth('medusa', SIZE);
  const state = { ...base, pets: base.pets.map((p) => ({ ...p, x: p.kind === 'pescatore' ? WIDTH - jw - SIZE * 1.5 : WIDTH - jw })) };
  const next = step(state, { dt: 16, width: WIDTH, mood: 'busy', random: never });
  const jelly = byKind(next, 'medusa');
  assert.strictEqual(jelly.passing, true);
  assert.strictEqual(jelly.dir, -1);
  assert.ok(jelly.lift >= SIZE / 2);
});

ok('pets: il retino non la prende mai (3000 passi, a ogni velocità e larghezza)', () => {
  for (const [mood, width, seed] of [['idle', WIDTH, 5], ['busy', WIDTH, 6], ['busy', 260, 7], ['attention', 500, 8]]) {
    let state = createPets({ cast: ['inseguimento'], width, size: SIZE, random: seeded(seed) });
    const random = seeded(seed + 100);
    let flights = 0;
    for (let i = 0; i < 3000; i += 1) {
      state = step(state, { dt: 16 + (i % 5) * 20, width, mood, random });
      const jelly = byKind(state, 'medusa');
      const dist = Math.abs(center(jelly) - center(byKind(state, 'pescatore')));
      assert.ok(dist >= SIZE / 2 || jelly.lift >= SIZE / 2, `${mood}/${width} passo ${i}: presa a distanza ${dist}`);
      if (jelly.pose === 'flee') flights += 1;
    }
    // Altrimenti il test passerebbe anche con i due che non si incontrano mai
    assert.ok(flights > 0, `${mood}/${width}: la medusa non è mai scappata`);
  }
});

ok('pets: la rana salta, e avanza solo mentre è in aria', () => {
  let state = createPets({ cast: ['rana'], width: WIDTH, size: SIZE, random: () => 0.5 });
  let jumps = 0;
  let top = 0;
  for (let i = 0; i < 500; i += 1) {
    const next = step(state, { dt: 16, width: WIDTH, random: never });
    const [before, frog] = [state.pets[0], next.pets[0]];
    assert.ok(frog.y >= 0, `sotto terra: ${frog.y}`);
    if (frog.pose === 'jump') { jumps += 1; top = Math.max(top, frog.y); }
    else assert.strictEqual(frog.x, before.x, 'seduta non si sposta');
    state = next;
  }
  assert.ok(jumps > 50 && jumps < 450, `salti: ${jumps} su 500`);
  assert.ok(top > SIZE / 3, `salti troppo bassi: ${top}`);
});

ok('pets: l uccellino vola sopra la striscia, e per dormire o chiamare si posa', () => {
  let state = createPets({ cast: ['uccellino'], width: WIDTH, size: SIZE, random: () => 0.5 });
  const heights = new Set();
  for (let i = 0; i < 300; i += 1) {
    state = step(state, { dt: 16, width: WIDTH, random: never });
    const bird = state.pets[0];
    assert.ok(bird.y >= SIZE / 2 && bird.y <= SIZE * 1.5, `quota fuori: ${bird.y}`);
    heights.add(Math.round(bird.y));
  }
  assert.ok(heights.size > 5, 'vola sempre alla stessa quota');
  const asleep = step(state, { dt: 16, width: WIDTH, mood: 'sleep', random: never }).pets[0];
  assert.deepStrictEqual([asleep.y, asleep.pose], [0, 'sleep']);
  const calling = step(state, { dt: 16, width: WIDTH, mood: 'attention', random: never }).pets[0];
  assert.deepStrictEqual([calling.y, calling.pose], [0, 'call']);
});

ok('pets: il pesce nuota ondeggiando appena sopra il fondo', () => {
  let state = createPets({ cast: ['pesce'], width: WIDTH, size: SIZE, random: () => 0.5 });
  const heights = new Set();
  for (let i = 0; i < 300; i += 1) {
    const next = step(state, { dt: 16, width: WIDTH, random: never });
    const fish = next.pets[0];
    assert.ok(fish.y >= 0 && fish.y <= SIZE / 2, `quota fuori: ${fish.y}`);
    assert.notStrictEqual(fish.x, state.pets[0].x, 'fermo');
    heights.add(Math.round(fish.y));
    state = next;
  }
  assert.ok(heights.size > 3, 'nuota piatto');
});

ok('pets: moodOf, chi aspetta vince su chi lavora, e il sonno arriva dopo SLEEP_AFTER_MS', () => {
  assert.strictEqual(moodOf({ running: true, attention: true, idleMs: 0 }), 'attention');
  assert.strictEqual(moodOf({ running: true, attention: false, idleMs: SLEEP_AFTER_MS * 2 }), 'busy');
  assert.strictEqual(moodOf({ running: false, attention: false, idleMs: SLEEP_AFTER_MS }), 'sleep');
  assert.strictEqual(moodOf({ running: false, attention: false, idleMs: SLEEP_AFTER_MS - 1 }), 'idle');
});

ok('pets: chi ha la posa idle ogni tanto si ferma, per un po\', poi riparte', () => {
  const state = onStage(['zucca']);
  // Primo numero: sotto la soglia della pausa; secondo: la durata (a metà fra min e max)
  const paused = step(state, { dt: 16, width: WIDTH, random: queue([0, 0.5]) });
  assert.strictEqual(paused.pets[0].pose, 'idle');
  assert.strictEqual(paused.pets[0].x, state.pets[0].x);
  const middle = Pets.PAUSE_MS.min + (Pets.PAUSE_MS.max - Pets.PAUSE_MS.min) / 2;
  const still = stillFor(paused, middle - 200);
  assert.strictEqual(still.pets[0].pose, 'idle');
  assert.strictEqual(still.pets[0].x, state.pets[0].x, 'in pausa si è mosso');
  const again = stillFor(still, 400);
  assert.strictEqual(again.pets[0].pose, 'walk');
  assert.notStrictEqual(again.pets[0].x, state.pets[0].x, 'dopo la pausa non riparte');
});

ok('pets: chi non ha la posa idle non si ferma mai, anche col caso dalla sua', () => {
  let state = onStage(['gatto']);
  for (let i = 0; i < 200; i += 1) {
    const next = step(state, { dt: 16, width: WIDTH, random: () => 0 });
    assert.notStrictEqual(next.pets[0].pose, 'idle');
    assert.notStrictEqual(next.pets[0].x, state.pets[0].x, 'fermo');
    state = next;
  }
});

ok('pets: al bordo il fantasmino si gira con la posa turn, il gatto solo di verso', () => {
  for (const [kind, pose] of [['fantasmino', 'turn'], ['gatto', 'walk']]) {
    const base = onStage([kind]);
    const edge = { ...base, pets: base.pets.map((p) => ({ ...p, x: WIDTH - petWidth(kind, SIZE) - 1, dir: 1 })) };
    const turned = step(edge, { dt: 50, width: WIDTH, random: never });
    assert.strictEqual(turned.pets[0].dir, -1, `${kind} non si è girato`);
    assert.strictEqual(turned.pets[0].pose, pose);
    if (pose !== 'turn') continue;
    const after = stillFor(turned, 2 * FRAME_MS + 50);
    assert.strictEqual(after.pets[0].pose, 'walk');
    assert.ok(after.pets[0].x < turned.pets[0].x, 'dopo essersi girato non torna indietro');
  }
});

ok('pets: quando si comincia a lavorare chi ha la posa si spaventa, una volta sola', () => {
  const state = onStage(['pizza', 'gatto']);
  const scared = step(state, { dt: 16, width: WIDTH, mood: 'busy', random: never });
  const [pizza, cat] = scared.pets;
  assert.strictEqual(pizza.pose, 'startle');
  assert.strictEqual(pizza.x, state.pets[0].x, 'spaventato si muove');
  assert.strictEqual(cat.pose, 'walk');
  assert.notStrictEqual(cat.x, state.pets[1].x);
  const calm = stillFor(scared, 6 * FRAME_MS + 50, { mood: 'busy' });
  assert.strictEqual(calm.pets[0].pose, 'walk');
  assert.ok(Math.abs(calm.pets[0].x - pizza.x) > 0, 'passato lo spavento resta fermo');
  const stillBusy = step(calm, { dt: 16, width: WIDTH, mood: 'busy', random: never });
  assert.strictEqual(stillBusy.pets[0].pose, 'walk', 'si rispaventa senza che sia cambiato niente');
});

ok('pets: finita l attesa chi chiamava ride, se sa farlo', () => {
  const state = onStage(['fantasmino']);
  const calling = step(state, { dt: 16, width: WIDTH, mood: 'attention', random: never });
  assert.strictEqual(calling.pets[0].pose, 'call');
  const laughing = step(calling, { dt: 16, width: WIDTH, mood: 'idle', random: never });
  assert.strictEqual(laughing.pets[0].pose, 'laugh');
  assert.strictEqual(laughing.pets[0].x, calling.pets[0].x);
  const done = stillFor(laughing, 6 * FRAME_MS + 50);
  assert.strictEqual(done.pets[0].pose, 'walk');

  const cat = step(onStage(['gatto']), { dt: 16, width: WIDTH, mood: 'attention', random: never });
  assert.strictEqual(step(cat, { dt: 16, width: WIDTH, mood: 'idle', random: never }).pets[0].pose, 'walk');
});

ok('pets: un attesa lunga rende triste chi chiama, se ha la posa', () => {
  const steps = Math.ceil(SAD_AFTER_MS / 100);
  let ghost = onStage(['fantasmino']);
  for (let i = 0; i < steps - 1; i += 1) {
    ghost = step(ghost, { dt: 100, width: WIDTH, mood: 'attention', random: never });
    assert.strictEqual(ghost.pets[0].pose, 'call', `triste già al passo ${i}`);
  }
  ghost = step(ghost, { dt: 100, width: WIDTH, mood: 'attention', random: never });
  assert.strictEqual(ghost.pets[0].pose, 'sad');
  const relieved = step(ghost, { dt: 100, width: WIDTH, mood: 'idle', random: never });
  assert.strictEqual(relieved.pets[0].pose, 'laugh');
  assert.strictEqual(relieved.attentionMs, 0);

  let cat = onStage(['gatto']);
  for (let i = 0; i < steps + 1; i += 1) cat = step(cat, { dt: 100, width: WIDTH, mood: 'attention', random: never });
  assert.strictEqual(cat.pets[0].pose, 'call');
});

ok('pets: chi ha la posa appear entra in scena apparendo, fermo, poi va', () => {
  const state = createPets({ cast: ['fantasmino', 'gatto'], width: WIDTH, size: SIZE, random: () => 0.5 });
  const [ghost, cat] = state.pets;
  assert.strictEqual(ghost.pose, 'appear');
  assert.strictEqual(cat.pose, 'walk');
  const during = stillFor(state, 2 * FRAME_MS);
  assert.strictEqual(during.pets[0].pose, 'appear');
  assert.strictEqual(during.pets[0].x, ghost.x);
  const after = stillFor(during, 3 * FRAME_MS + 50);
  assert.strictEqual(after.pets[0].pose, 'walk');
});

ok('pets: recast tiene chi resta dov\'è, fa svanire chi esce e fa apparire chi entra', () => {
  const state = deepFreeze(stillFor(onStage(['fantasmino', 'gatto']), 500));
  const [ghost, cat] = state.pets;
  const next = recast(state, { cast: ['gatto', 'zucca'], width: WIDTH, random: never });
  assert.deepStrictEqual(next.pets.map((p) => p.kind), ['gatto', 'fantasmino', 'zucca']);
  assert.strictEqual(next.pets[0].key, cat.key);
  assert.strictEqual(next.pets[0].x, cat.x);
  assert.strictEqual(next.pets[1].pose, 'vanish');
  assert.strictEqual(next.pets[1].key, ghost.key);
  assert.notStrictEqual(next.pets[2].key, ghost.key, 'chiave riusata mentre l\'altro sta ancora svanendo');
  const gone = stillFor(next, 5 * FRAME_MS + 50);
  assert.deepStrictEqual(gone.pets.map((p) => p.kind), ['gatto', 'zucca']);
  assert.strictEqual(gone.pets[1].pose, 'walk');
});

ok('pets: recast, chi non sa svanire sparisce subito; una coppia esce intera; le chiavi restano uniche', () => {
  const state = onStage(['inseguimento', 'gatto', 'gatto']);
  const next = recast(state, { cast: ['gatto'], width: WIDTH, random: never });
  assert.deepStrictEqual(next.pets.map((p) => p.kind), ['gatto']);
  assert.strictEqual(next.pets[0].key, state.pets[2].key, 'tiene il primo dei due gatti');
  const more = recast(next, { cast: ['gatto', 'inseguimento', 'gatto'], width: WIDTH, random: never });
  assert.deepStrictEqual(more.pets.map((p) => p.kind).sort(), ['gatto', 'gatto', 'medusa', 'pescatore']);
  assert.strictEqual(more.pets[0].key, next.pets[0].key, 'il gatto di prima non è più il primo');
  assert.strictEqual(new Set(more.pets.map((p) => p.key)).size, 4);
  const sponge = byKind(more, 'pescatore');
  assert.strictEqual(byKind(more, 'medusa').mate, sponge.key);
  assert.strictEqual(recast(more, { cast: [], width: WIDTH, random: never }).pets.length, 0);
});

ok('pets: durante il sonno le azioni si interrompono, tranne lo svanire', () => {
  const paused = step(onStage(['zucca']), { dt: 16, width: WIDTH, random: queue([0, 0.5]) });
  assert.strictEqual(paused.pets[0].pose, 'idle');
  const asleep = step(paused, { dt: 16, width: WIDTH, mood: 'sleep', random: never });
  assert.strictEqual(asleep.pets[0].pose, 'sleep');
  assert.strictEqual(asleep.pets[0].act, null);
  const leaving = recast(onStage(['fantasmino']), { cast: [], width: WIDTH, random: never });
  const gone = stillFor(leaving, 5 * FRAME_MS + 50, { mood: 'sleep' });
  assert.strictEqual(gone.pets.length, 0);
});

ok('pets: frameIndex avanza col tempo animato e gira sui frame', () => {
  assert.strictEqual(frameIndex({ anim: 0 }, 2), 0);
  assert.strictEqual(frameIndex({ anim: Pets.FRAME_MS }, 2), 1);
  assert.strictEqual(frameIndex({ anim: Pets.FRAME_MS * 2 }, 2), 0);
  assert.strictEqual(frameIndex({ anim: 999 }, 1), 0);
});

ok('pets: chi ha più aspetti ne riceve uno a sorte alla nascita, gli altri sempre il primo', () => {
  const { looks } = require('../renderer/pets-sprites');
  assert.ok(looks('pesce') > 1 && looks('uccellino') > 1, 'pesce e uccellino senza varianti');
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed += 1) {
    const state = createPets({ cast: ['pesce', 'uccellino', 'gatto'], width: WIDTH, size: SIZE, random: seeded(seed) });
    for (const pet of state.pets) {
      assert.ok(Number.isInteger(pet.variant) && pet.variant >= 0 && pet.variant < looks(pet.kind), `${pet.kind}: aspetto ${pet.variant}`);
      if (pet.kind === 'pesce') seen.add(pet.variant);
    }
    assert.strictEqual(byKind(state, 'gatto').variant, 0);
  }
  assert.strictEqual(seen.size, looks('pesce'), 'in 40 nascite non sono usciti tutti i pesci');
});

ok('pets: l aspetto non cambia camminando, e chi entra col recast ne riceve uno suo', () => {
  let state = createPets({ cast: ['pesce'], width: WIDTH, size: SIZE, random: () => 0.9 });
  const { variant } = state.pets[0];
  state = run(state, 200, { random: seeded(2) });
  assert.strictEqual(state.pets[0].variant, variant);
  state = recast(state, { cast: ['pesce', 'uccellino'], width: WIDTH, random: () => 0.1 });
  assert.strictEqual(byKind(state, 'uccellino').variant, 0);
  assert.strictEqual(byKind(state, 'pesce').variant, variant);
});

ok('pets: un random che tocca 1 non produce un aspetto fuori misura', () => {
  const { looks } = require('../renderer/pets-sprites');
  const state = createPets({ cast: ['pesce', 'gatto'], width: WIDTH, size: SIZE, random: () => 1 });
  assert.strictEqual(byKind(state, 'pesce').variant, looks('pesce') - 1);
  assert.strictEqual(byKind(state, 'gatto').variant, 0);
});

ok('pets: la medusa da sola è una voce del cast: senza il pescatore gironzola ondeggiando, mai in fuga', () => {
  const { CAST, CAST_LABELS } = require('../renderer/pets-sprites');
  assert.deepStrictEqual(CAST.medusa, ['medusa']);
  assert.strictEqual(CAST_LABELS.medusa, 'Medusa');
  let state = onStage(['medusa']);
  assert.strictEqual(state.pets.length, 1);
  assert.strictEqual(state.pets[0].mate, null);
  const ys = new Set();
  const poses = new Set();
  for (let i = 0; i < 120; i += 1) {
    state = step(state, { dt: 16, width: WIDTH, random: seeded(i + 1) });
    ys.add(Math.round(state.pets[0].y * 10));
    poses.add(state.pets[0].pose);
  }
  assert.ok(ys.size > 3, 'la medusa da sola non ondeggia');
  assert.ok(!poses.has('flee'), 'scappa da nessuno');
  assert.ok(poses.has('walk'));
});

ok('pets: la medusa chiama solo se non c è nessun altro che possa farlo, e per farlo si posa', () => {
  let floating = onStage(['medusa']);
  for (let i = 0; i < 30 && floating.pets[0].y === 0; i += 1) floating = step(floating, { dt: 16, width: WIDTH, random: never });
  assert.notStrictEqual(floating.pets[0].y, 0, 'non ha ancora ondeggiato');
  const alone = step(floating, { dt: 16, width: WIDTH, mood: 'attention', random: never });
  assert.strictEqual(alone.pets[0].pose, 'call');
  assert.strictEqual(alone.pets[0].y, 0, 'per chiamare si posa');
  const asleep = step(floating, { dt: 16, width: WIDTH, mood: 'sleep', random: never });
  assert.strictEqual(asleep.pets[0].y, 0, 'per dormire si posa');
  const both = step(onStage(['medusa', 'gatto']), { dt: 16, width: WIDTH, mood: 'attention', random: never });
  assert.strictEqual(byKind(both, 'gatto').pose, 'call');
  assert.notStrictEqual(byKind(both, 'medusa').pose, 'call');
});
