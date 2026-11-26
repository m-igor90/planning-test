// Vérifie les règles principales du générateur : node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const P = require('../planner.js');

const staff = [
  { id: 'a', nom: 'A', taux: 90, role: 'soins' }, { id: 'b', nom: 'B', taux: 80, role: 'soins', joursInterdits: [3] },
  { id: 'c', nom: 'C', taux: 80, role: 'soins' }, { id: 'd', nom: 'D', taux: 80, role: 'soins', tutorat: true },
  { id: 'e', nom: 'E', taux: 80, role: 'soins' }, { id: 'f', nom: 'F', taux: 70, role: 'soins' },
  { id: 'g', nom: 'G', taux: 70, role: 'soins' }, { id: 'h', nom: 'H', taux: 70, role: 'soins' },
  { id: 'i', nom: 'I', taux: 50, role: 'soins', maxSuite: 3 }, { id: 'j', nom: 'J', taux: 60, role: 'admin' }
];
const rules = { maxConsecutive: 5, tutoratMax: 2, fillHours: true, renfort: 'D2', restarts: 2, iterations: 12000 };

test('janvier 2027 : couverture complète et règles dures respectées', () => {
  const holidays = P.holidaysDefault(2027, 1);
  assert.deepStrictEqual(holidays, [1, 2]);
  const cells = { a: { 5: '!X', 6: '!X' }, c: { 12: '!V', 13: '!V' } };
  const res = P.generate({ staff, rules, year: 2027, month: 1, holidays, cells, seed: 1 });
  const ev = P.evaluate({ staff, rules, year: 2027, month: 1, holidays, cells: res.cells });
  assert.strictEqual(ev.missing, 0, 'C1, M5 et M1 couverts chaque jour');
  assert.strictEqual(ev.issues.filter(i => i.lvl === 'err').length, 0);
  assert.strictEqual(res.cells.a[5], '!X', 'les désirs sont gardés');
  assert.strictEqual(res.cells.c[12], '!V', 'les vacances sont gardées');
  for (let d = 1; d <= 31; d++) {
    if (new Date(2027, 0, d).getDay() === 3) assert.ok(!P.isWork(P.parseCell(res.cells.b[d]).c), 'B ne travaille pas le mercredi');
  }
  for (const id of Object.keys(res.cells)) {
    let d2 = 0;
    for (let d = 1; d <= 31; d++) {
      const c = P.parseCell(res.cells[id][d]).c;
      if (!P.isWork(c)) d2 = 0; else if (c === 'D2') { d2++; assert.ok(d2 <= 1, id + ' : deux D2 dans la même série'); }
    }
  }
  let run = 0;
  for (let d = 1; d <= 31; d++) { run = P.isWork(P.parseCell(res.cells.i[d]).c) ? run + 1 : 0; assert.ok(run <= 3, 'I : 3 jours de suite au maximum'); }
});

test('désirs : le ponctuel remplace l’hebdomadaire, le rôle administratif n’est pas concerné', () => {
  const s = { id: 'a', role: 'soins', desirs: { 2: { non: ['C1'] } } };
  assert.deepStrictEqual(P.wishFor(s, {}, 5, 2), { non: ['C1'], souple: false, ponctuel: false });
  assert.deepStrictEqual(P.wishFor(s, { a: { 5: { non: [] } } }, 5, 2), { non: [], souple: false, ponctuel: true });
  assert.strictEqual(P.wishFor(s, {}, 6, 3), null);
  assert.strictEqual(P.wishFor({ ...s, role: 'admin' }, {}, 5, 2), null);
  const matin = { non: ['C1', 'D2'] };
  assert.strictEqual(P.describeWish(matin.non), 'matin seulement');
  assert.deepStrictEqual(['M1', 'M5', 'T', 'C1', 'D2', 'N', ''].map(c => P.allows(matin, c)), [true, true, true, false, false, false, true]);
});

test('désirs fermes : jamais enfreints par le générateur', () => {
  const team = staff.map(s => s.id === 'a' ? { ...s, desirs: { 2: { non: ['C1'] } } } : s.id === 'c' ? { ...s, rythme: 'condense' } : s.id === 'e' ? { ...s, rythme: 'lisse' } : s);
  const wishes = { f: { 12: { non: ['C1', 'D2'] } }, g: { 14: { non: ['C1', 'M5', 'M1', 'D2'] } } };
  const o = { staff: team, rules, year: 2027, month: 1, holidays: P.holidaysDefault(2027, 1), cells: {}, wishes };
  for (const seed of [1, 2, 3]) {
    const res = P.generate({ ...o, seed });
    const ev = P.evaluate({ ...o, cells: res.cells });
    assert.deepStrictEqual(Object.values(ev.wishes.cells).filter(k => k === 'hard'), [], 'tirage ' + seed);
    for (const d of [5, 12, 19, 26]) assert.notStrictEqual(P.parseCell(res.cells.a[d]).c, 'C1');
    assert.ok(['', 'M1', 'M5', 'T'].includes(P.parseCell(res.cells.f[12]).c));
    assert.ok(!P.isWork(P.parseCell(res.cells.g[14]).c));
  }
});

test('désirs : alertes selon le niveau et la saisie manuelle', () => {
  const o = { staff, rules, year: 2027, month: 1, holidays: [], cells: { a: { 5: 'C1' }, c: { 5: '!C1' }, e: { 5: 'C1' } },
    wishes: { a: { 5: { non: ['C1'] } }, c: { 5: { non: ['C1'] } }, e: { 5: { non: ['C1'], souple: true } } } };
  const ev = P.evaluate(o);
  assert.deepStrictEqual(ev.wishes.cells, { 'a:5': 'hard', 'c:5': 'lock', 'e:5': 'soft' });
  assert.deepStrictEqual(ev.issues.filter(i => i.wish).map(i => i.lvl).sort(), ['err', 'warn', 'warn']);
});

test('désir impossible à couvrir : l’alerte en donne la raison', () => {
  const team = staff.map(s => ({ ...s, desirs: { 2: { non: ['C1'] } } }));
  const o = { staff: team, rules, year: 2027, month: 1, holidays: [], cells: {} };
  const ev = P.evaluate({ ...o, cells: P.generate({ ...o, seed: 1 }).cells });
  assert.ok(ev.issues.some(i => i.d === 5 && /^C1 non couvert — exclu par un désir ferme/.test(i.txt)));
});

test('week-ends : répartition équitable, volontaire et vacances', () => {
  const holidays = P.holidaysDefault(2027, 1);
  const vac = {}; for (let d = 4; d <= 17; d++) vac[d] = '!V';
  const team = staff.map(s => s.id === 'b' ? { ...s, weekendsPlus: true } : s);
  for (const seed of [1, 2]) {
    const o = { staff: team, rules, year: 2027, month: 1, holidays, cells: { c: vac } };
    const ev = P.evaluate({ ...o, cells: P.generate({ ...o, seed }).cells });
    const p = id => ev.people.find(x => x.id === id);
    for (const x of ev.people.filter(x => x.id !== 'j')) {
      assert.ok(x.we >= x.weLo && x.we <= x.weHi, x.id + ' : ' + x.we + ' WE, attendu ' + x.weLo + '-' + x.weHi);
      assert.ok(x.we >= 1, x.id + ' : au moins un week-end');
    }
    assert.ok(p('b').we >= 2, 'la volontaire en fait au moins 2');
    assert.ok(p('c').weHi <= 1, 'les vacances réduisent la part');
    assert.strictEqual(ev.weOff, 0);
  }
});

test('jours fériés selon la région', () => {
  assert.deepStrictEqual(P.holidaysDefault(2027, 1, 'CH-JU'), [1, 2]);
  assert.deepStrictEqual(P.holidaysDefault(2027, 5, 'FR'), [1, 6, 8, 17]);
  assert.deepStrictEqual(P.holidaysDefault(2027, 9, 'CH-VD'), [20], 'lundi du Jeûne fédéral');
  assert.deepStrictEqual(P.holidaysDefault(2027, 9, 'CH-GE'), [9], 'Jeûne genevois');
  assert.deepStrictEqual(P.holidaysDefault(2027, 1, 'AUCUN'), []);
});

test('continuité avec le mois précédent : séries, C1 et week-end coupé', () => {
  // août 2027 commence un dimanche (samedi 31 juillet au mois précédent)
  const prev = { year: 2027, month: 7, holidays: [], cells: {
    a: { 27: 'M1', 28: 'M5', 29: 'M1', 30: 'M5' },   // 4 jours de suite, jusqu'au vendredi 30
    c: { 30: 'M5', 31: 'C1' },                      // C1 le samedi
    e: { 31: 'M1' }, f: { 31: 'M5' } } };
  const o = { staff, rules, year: 2027, month: 8, holidays: P.holidaysDefault(2027, 8), cells: {}, prev };
  const cells = P.generate({ ...o, seed: 1 }).cells, w = (id, d) => P.isWork(P.parseCell((cells[id] || {})[d]).c);
  assert.ok(!w('a', 1), 'A ne prolonge pas sa série de 4 jours');
  assert.ok(['c', 'e', 'f'].every(id => w(id, 1)), 'le dimanche 1 suit le samedi travaillé');
  assert.ok(['b', 'd', 'g', 'h', 'i'].every(id => !w(id, 1)), 'dimanche 1 réservé à celles du samedi');
  const ev = P.evaluate({ ...o, cells });
  assert.deepStrictEqual(ev.issues.filter(i => i.lvl === 'err' && i.d === 1 && i.sid), []);
  // sans le mois précédent, le dimanche isolé n'est pas compté comme un week-end du mois
  assert.strictEqual(P.monthInfo(2027, 8, []).weekends, 4);
});

test('rattrapage du solde reporté', () => {
  const o = { staff, rules: { ...rules, rattrapage: 2, hpd: 8 }, year: 2027, month: 1, holidays: P.holidaysDefault(2027, 1), cells: {}, seed: 1 };
  const base = P.evaluate({ ...o, cells: P.generate(o).cells }).people.find(p => p.id === 'f').worked;
  const plus = P.evaluate({ ...o, cells: P.generate({ ...o, carry: { f: 40 } }).cells }).people.find(p => p.id === 'f').worked;
  assert.ok(plus <= base - 1, '40 h en plus : moins de jours (' + base + ' → ' + plus + ')');
});
