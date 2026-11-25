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
  let run = 0;
  for (let d = 1; d <= 31; d++) { run = P.isWork(P.parseCell(res.cells.i[d]).c) ? run + 1 : 0; assert.ok(run <= 3, 'I : 3 jours de suite au maximum'); }
});
