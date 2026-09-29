// renderer/pets.js: movimento, inseguimento e stati degli animaletti
const assert = require('node:assert');
const { test: ok } = require('node:test');
const Pets = require('../renderer/pets');
const { createPets, step, moodOf, frameIndex, petWidth, SLEEP_AFTER_MS } = Pets;

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

ok('pets: frameIndex avanza col tempo animato e gira sui frame', () => {
  assert.strictEqual(frameIndex({ anim: 0 }, 2), 0);
  assert.strictEqual(frameIndex({ anim: Pets.FRAME_MS }, 2), 1);
  assert.strictEqual(frameIndex({ anim: Pets.FRAME_MS * 2 }, 2), 0);
  assert.strictEqual(frameIndex({ anim: 999 }, 1), 0);
});
