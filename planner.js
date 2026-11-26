/* Moteur de planification — planning infirmier.
   Utilisable dans la page (window.Planner) et dans Node (module.exports). */
(function (root) {
  'use strict';

  var SHIFTS = ['C1', 'M5', 'M1', 'D2'];
  var WORK = { C1: 1, M1: 1, M5: 1, D2: 1, CS: 1, T: 1, R: 1, F: 1, N: 1 };
  var EARLY = { M1: 1, M5: 1, D2: 1, CS: 1, T: 1, R: 1, F: 1 };
  var isWork = function (c) { return !!WORK[c]; };
  var isEarly = function (c) { return !!EARLY[c]; };

  function daysIn(y, m) { return new Date(y, m, 0).getDate(); }

  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }

  /* Jours fériés par défaut (modifiables dans l'application). */
  function holidaysDefault(y, m) {
    var e = easter(y), list = [];
    var add = function (date) { if (date.getMonth() + 1 === m) list.push(date.getDate()); };
    var rel = function (n) { var d = new Date(e); d.setDate(d.getDate() + n); return d; };
    [[1, 1], [1, 2], [5, 1], [6, 23], [8, 1], [8, 15], [11, 1], [12, 25], [12, 26]]
      .forEach(function (x) { add(new Date(y, x[0] - 1, x[1])); });
    [-2, 1, 39, 50, 60].forEach(function (n) { add(rel(n)); });
    return list.sort(function (a, b) { return a - b; });
  }

  function monthInfo(y, m, holidays) {
    var D = daysIn(y, m), hol = {}, days = [], blocks = [];
    (holidays || []).forEach(function (h) { hol[h] = 1; });
    for (var d = 1; d <= D; d++) {
      var dow = new Date(y, m - 1, d).getDay(), we = dow === 0 || dow === 6, h = !!hol[d];
      days.push({ d: d, dow: dow, we: we, hol: h, needs: (we || h) ? ['C1', 'M5', 'M1'] : ['C1', 'M5', 'M1', 'D2'] });
    }
    var blockOf = new Array(D).fill(-1);
    for (var i = 0; i < D; i++) {
      if (days[i].dow === 6) { var b = [i]; if (i + 1 < D) b.push(i + 1); blocks.push(b); }
      else if (i === 0 && days[i].dow === 0) blocks.push([0]);
    }
    blocks.forEach(function (b, k) { b.forEach(function (i) { blockOf[i] = k; }); });
    var workingDays = days.filter(function (x) { return !x.we && !x.hol; }).length;
    return { y: y, m: m, D: D, days: days, blocks: blocks, blockOf: blockOf, workingDays: workingDays };
  }

  /* Un C1 suivi d'un horaire du matin n'est accepté qu'entre deux jours de week-end / fériés
     (rotation du week-end : M1→M5, M5→C1, C1→M1). */
  function lightPair(days, i) {
    var a = days[i], b = days[i + 1];
    return !!(a && b && (a.we || a.hol) && (b.we || b.hol));
  }
  /* Un D2 (horaire coupé) au plus par série de jours travaillés d'affilée. */
  function shiftInRun(row, i, shift) {
    var k;
    for (k = i - 1; k >= 0 && isWork(row[k]); k--) if (row[k] === shift) return true;
    for (k = i + 1; k < row.length && isWork(row[k]); k++) if (row[k] === shift) return true;
    return false;
  }
  function badC1(days, row, i) { // C1 le jour i puis horaire du matin le jour i+1, hors week-end
    return row[i] === 'C1' && i + 1 < row.length && isEarly(row[i + 1]) && !lightPair(days, i);
  }

  /* ---------- désirs horaires ----------
     Hebdomadaire : personne.desirs[jourDeSemaine 0-6] = { non: ['C1'], souple: false }
     Ponctuel     : wishes[idPersonne][jourDuMois]     = { non: ['C1','D2'], souple: false }
     Le ponctuel remplace l'hebdomadaire ; non: [] = « exceptionnellement disponible pour tout ».
     Ferme (par défaut) : jamais enfreint par le générateur. Souple : respecté si possible. */
  var RHYTHMS = { lisse: 1, condense: 1 };

  function wishFor(s, wishes, d, dow) {
    if (s.role === 'admin') return null;
    var own = wishes && wishes[s.id] && wishes[s.id][d];
    var w = own || (s.desirs && s.desirs[dow]);
    if (!w) return null;
    var non = SHIFTS.filter(function (c) { return (w.non || []).indexOf(c) >= 0; });
    if (!own && !non.length) return null;
    return { non: non, souple: !!w.souple && non.length > 0, ponctuel: !!own };
  }

  /* Le code est-il compatible avec le désir ? CS, T, R, F comptent comme du matin, N comme du soir. */
  function allows(w, code) {
    if (!w || !w.non.length || !isWork(code)) return true;
    var no = function (c) { return w.non.indexOf(c) >= 0; };
    if (w.non.length === SHIFTS.length) return false;
    if (SHIFTS.indexOf(code) >= 0) return !no(code);
    if (code === 'N') return !no('C1');
    return !(no('M1') && no('M5'));
  }

  function describeWish(non) {
    var ok = SHIFTS.filter(function (c) { return (non || []).indexOf(c) < 0; }), k = ok.join(',');
    if (ok.length === 4) return 'disponible pour tout';
    if (!ok.length) return 'repos souhaité';
    if (k === 'M5,M1') return 'matin seulement';
    if (k === 'C1') return 'soir seulement';
    if (k === 'M5,M1,D2') return 'pas de soir';
    if (k === 'C1,M5,M1') return 'pas de coupé';
    if (k === 'C1,D2') return 'pas de matin';
    return 'uniquement ' + ok.join(' ou ');
  }

  function hardBlocked(a, i, code) { var w = a.wish[i]; return !!w && !w.souple && !allows(w, code); }
  function softMissed(a, i, code) { var w = a.wish[i]; return !!w && w.souple && !allows(w, code); }
  function hardRest(a, i) { var w = a.wish[i]; return !!w && !w.souple && w.non.length === SHIFTS.length; }

  function parseCell(v) {
    if (!v) return { c: '', l: false };
    if (v.charAt(0) === '!') return { c: v.slice(1), l: true };
    return { c: v, l: false };
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function targetDays(s, info) { return Math.round((s.taux || 0) / 100 * info.workingDays); }

  function baseWeekends(s) {
    if (s.weekends !== undefined && s.weekends !== null && s.weekends !== '') return { fixed: true, v: +s.weekends };
    var t = s.taux || 0;
    return { fixed: false, v: t >= 80 ? 2 : t >= 60 ? 1.3 : 1 };
  }

  /* Prépare l'état commun à la génération et à l'évaluation. */
  function buildState(staff, info, cells, wishes) {
    var D = info.D;
    return staff.map(function (s) {
      var row = new Array(D).fill(''), lock = new Array(D).fill(false), src = (cells && cells[s.id]) || {};
      Object.keys(src).forEach(function (k) {
        var p = parseCell(src[k]), i = +k - 1;
        if (i >= 0 && i < D && p.c) { row[i] = p.c; lock[i] = p.l; }
      });
      var credit = 0;
      row.forEach(function (c, i) { if (c === 'V' && !info.days[i].we && !info.days[i].hol) credit++; });
      var forbid = {};
      (s.joursInterdits || []).forEach(function (w) { forbid[w] = 1; });
      var wish = info.days.map(function (day) { return wishFor(s, wishes, day.d, day.dow); });
      return { s: s, row: row, lock: lock, credit: credit, target: targetDays(s, info), forbid: forbid,
        wish: wish, rythme: RHYTHMS[s.rythme] ? s.rythme : '',
        maxRun: Math.min((s.id === 'r' || /^rachel$/i.test(s.prenom || '') || +s.taux !== 90) ? 3 : 4, +s.maxSuite > 0 ? +s.maxSuite : 4) };
    });
  }

  // CONTRAINTE NON NEGOCIABLE : au plus deux blocs entre deux repos de 2 jours.
  function restViolation(row, max) {
    var blocks = 0, run = 0, rest = 2;
    for (var i = 0; i < row.length; i++) {
      if (isWork(row[i])) {
        if (!run) { if (rest >= 2) blocks = 0; blocks++; if (blocks > 2) return i; }
        run++; if (run > max) return i;
        if (run === 4 && (i >= 4 && isWork(row[i-4]) || i >= 5 && isWork(row[i-5]))) return i;
        if (run === 4 && (isWork(row[i+1]) || isWork(row[i+2]))) return i;
        rest = 0;
      } else { run = 0; rest++; }
    }
    return -1;
  }
  function generate(opts) {
    var staff = opts.staff, rules = opts.rules || {};
    var info = monthInfo(opts.year, opts.month, opts.holidays);
    var D = info.D, days = info.days, blocks = info.blocks, blockOf = info.blockOf;
    var maxC = rules.maxConsecutive || 5;
    // Compléter les heures : un horaire de renfort en plus en semaine pour atteindre le taux de chacune
    var fill = !!rules.fillHours, RF = rules.renfort || 'D2';
    var seed = opts.seed || (Date.now() & 0x7fffffff);
    var all = buildState(staff, info, opts.cells, opts.wishes);

    // Garder uniquement les cases fixées
    all.forEach(function (a) { for (var i = 0; i < D; i++) if (!a.lock[i]) a.row[i] = ''; });

    // Personnel administratif (CS) : journées administratives réparties sur les jours ouvrables
    all.filter(function (a) { return a.s.role === 'admin'; }).forEach(function (a) {
      var lockedWork = a.row.filter(isWork).length;
      var k = Math.max(0, a.target - a.credit - lockedWork);
      var free = [];
      for (var i = 0; i < D; i++) if (!days[i].we && !days[i].hol && !a.lock[i] && !a.forbid[days[i].dow]) free.push(i);
      for (var j = 0; j < k && j < free.length; j++) a.row[free[Math.floor((j + 0.5) * free.length / k)]] = 'CS';
    });

    var P = all.filter(function (a) { return a.s.role !== 'admin'; });
    var N = P.length;
    var adminCover = days.map(function (dd, i) {
      var o = {}; all.forEach(function (a) { if (a.s.role === 'admin' && a.row[i]) o[a.row[i]] = (o[a.row[i]] || 0) + 1; });
      return o;
    });

    // Objectifs individuels
    var freeNeed = 0;
    days.forEach(function (dd, i) {
      dd.needs.forEach(function (s) {
        var have = adminCover[i][s] || 0;
        P.forEach(function (a) { if (a.lock[i] && a.row[i] === s) have++; });
        if (!have) freeNeed++;
      });
    });
    var capSum = 0;
    P.forEach(function (a) {
      a.lockedWork = a.row.filter(isWork).length;
      a.cap = Math.max(0, a.target - a.credit - a.lockedWork);
      capSum += a.cap;
    });
    var f = fill ? 1 : capSum > 0 ? Math.min(1, freeNeed / capSum) : 0;
    P.forEach(function (a) { a.exp = a.lockedWork + a.cap * f; a.maxDays = a.target - a.credit; a.maxRun = Math.min(a.maxRun || maxC, maxC); });

    // Week-ends souhaités
    var S = blocks.length * 3, fixedSum = 0, autoSum = 0;
    P.forEach(function (a) { var b = baseWeekends(a.s); a.weBase = b; if (b.fixed) fixedSum += b.v; else autoSum += b.v; });
    var scale = autoSum > 0 ? Math.max(0, S - fixedSum) / autoSum : 0;
    P.forEach(function (a) { a.weDesired = a.weBase.fixed ? a.weBase.v : a.weBase.v * scale; });

    // Part de chaque horaire dans le mois, pour une répartition équitable entre toutes
    var totalNeedSlots = 0, shareOf = { C1: 0, M5: 0, M1: 0, D2: 0 };
    days.forEach(function (dd) { totalNeedSlots += dd.needs.length; dd.needs.forEach(function (s) { shareOf[s]++; }); });
    var extraSlots = fill ? Math.max(0, capSum - freeNeed) : 0;
    shareOf[RF] += extraSlots; totalNeedSlots += extraSlots;
    SHIFTS.forEach(function (s) { shareOf[s] /= Math.max(1, totalNeedSlots); });
    var EQW = { C1: 180, M5: 120, M1: 120, D2: 180 };

    var best = null, bestScore = Infinity;
    var restarts = rules.restarts || 8, iters = rules.iterations || 30000;
    for (var r = 0; r < restarts; r++) {
      var rnd = mulberry32(seed + r * 7919);
      var g = P.map(function (a) { return a.row.slice(); });
      construct(g, rnd);
      var res = anneal(g, rnd, iters);
      if (res.score < bestScore) { bestScore = res.score; best = res.g; }
    }

    // Tutorat (T) pour les personnes concernées, sans dépasser leur dû
    var tMax = rules.tutoratMax === undefined ? 2 : rules.tutoratMax;
    P.forEach(function (a, p) {
      if (!a.s.tutorat) return;
      var row = best[p], have = row.filter(function (c) { return c === 'T'; }).length;
      var worked = row.filter(isWork).length;
      if (fill) {
        // le tutorat remplace un horaire de renfort (jour où l'horaire est déjà couvert par une autre)
        var last = -9;
        for (var x = 0; x < D && have < tMax; x++) {
          if (a.lock[x] || !allows(a.wish[x], 'T') || row[x] !== RF || days[x].we || days[x].hol || x - last < 5) continue;
          var others = 0;
          for (var y = 0; y < N; y++) if (y !== p && best[y][x] === RF) others++;
          if (!others) continue;
          row[x] = 'T'; have++; last = x;
        }
      }
      var cands = [];
      for (var i = 0; i < D; i++) {
        if (days[i].we || days[i].hol || a.lock[i] || row[i] || a.forbid[days[i].dow] || !allows(a.wish[i], 'T')) continue;
        if (i > 0 && row[i - 1] === 'C1') continue;
        var before = 0, after = 0, k;
        for (k = i - 1; k >= 0 && isWork(row[k]); k--) before++;
        for (k = i + 1; k < D && isWork(row[k]); k++) after++;
        var L = before + after + 1;
        if (L > Math.min(a.maxRun, 3) || L === 1) continue;
        cands.push({ i: i, w: (L === 2 ? 4 : L === 3 ? 3 : L === 1 ? 0 : -2) + ((i * 7) % 5) / 10 });
      }
      cands.sort(function (x, y) { return y.w - x.w; });
      var picked = [];
      for (var c = 0; c < cands.length && have < tMax && worked < a.maxDays; c++) {
        var i2 = cands[c].i;
        if (picked.some(function (q) { return Math.abs(q - i2) < 5; })) continue;
        var trial = row.slice(); trial[i2] = 'T'; var seen = {}, invalid = false; trial.forEach(function(c){ if (!isWork(c)) seen = {}; else if(c === 'C1' || c === 'D2') { if(seen[c]) invalid = true; seen[c] = true; } }); if(invalid || restViolation(trial, a.maxRun) >= 0) continue;
        row[i2] = 'T'; picked.push(i2); have++; worked++;
      }
    });

    var out = {};
    all.forEach(function (a) {
      var row = a.s.role === 'admin' ? a.row : best[P.indexOf(a)], o = {};
      for (var i = 0; i < D; i++) if (row[i]) o[i + 1] = (a.lock[i] ? '!' : '') + row[i];
      out[a.s.id] = o;
    });
    all.forEach(function(a) {
      var row = a.s.role === 'admin' ? a.row : best[P.indexOf(a)];
      // Les violations résiduelles sont signalées par evaluate, sans bloquer l'affichage.
    });
    return { cells: out, score: bestScore, seed: seed };

    /* ---------- construction gloutonne ---------- */
    function runBefore(row, i) { var n = 0; for (var k = i - 1; k >= 0 && isWork(row[k]); k--) n++; return n; }
    function canTake(g, p, i, s) {
      var a = P[p];
      if (a.lock[i] || g[p][i]) return false;
      if (a.forbid[days[i].dow] || hardBlocked(a, i, s)) return false;
      var block = blocks[blockOf[i]];
      if (block && block.length === 2) { var other = block[0] === i ? block[1] : block[0]; if (a.forbid[days[other].dow] || (!a.lock[other] && hardRest(a, other)) || (a.lock[other] && !isWork(g[p][other]))) return false; }
      if (isEarly(s) && i > 0 && g[p][i - 1] === 'C1' && !lightPair(days, i - 1)) return false;
      if (s === 'C1' && i + 1 < D && isEarly(g[p][i + 1]) && !lightPair(days, i)) return false;
      if ((s === 'D2' || s === 'C1') && shiftInRun(g[p], i, s)) return false;
      var trial = g[p].slice(); trial[i] = s;
      return restViolation(trial, a.maxRun) < 0;
    }
    function construct(g, rnd) {
      var assigned = P.map(function (a, p) { return g[p].filter(isWork).length; });
      var weCount = P.map(function () { return 0; });
      var weWorked = P.map(function () { return {}; });
      for (var i = 0; i < D; i++) {
        var dd = days[i], bk = blockOf[i];
        dd.needs.forEach(function (s) {
          var have = adminCover[i][s] || 0;
          for (var p = 0; p < N; p++) if (g[p][i] === s) have++;
          if (have) return;
          var bestP = -1, bestSc = -Infinity;
          for (p = 0; p < N; p++) {
            if (!canTake(g, p, i, s)) continue;
            var a = P[p], run = runBefore(g[p], i);
            if (s === 'D2' && assigned[p] >= a.exp) continue;
            var sc = (a.exp - assigned[p]) / Math.max(1, a.exp) * 10 + rnd() * 2;
            if (run >= a.maxRun) continue;
            if (assigned[p] >= a.maxDays) sc -= 30;
            if (run === 1 || run === 2) sc += 1.2; else if (run >= 3) sc -= 1.5 * (run - 2);
            if (softMissed(a, i, s)) sc -= 12;
            if (a.rythme === 'condense' && (run === 1 || run === 2)) sc += 2;
            if (a.rythme === 'lisse' && run >= 2) sc -= 2;
            if (run === 0 && i > 0 && runBefore(g[p], i - 1) === 0 && i > 1 && isWork(g[p][i - 2])) sc -= 0.5;
            if (bk >= 0) {
              var b = blocks[bk], first = b[0] === i;
              if (!first) {
                if (weWorked[p][bk]) sc += 20 - (g[p][b[0]] === s ? (s === 'C1' ? 15 : 6) : 0); else sc -= 8;
              } else {
                sc += (a.weDesired - weCount[p]) * 6;
                if (bk > 0 && weWorked[p][bk - 1]) sc -= 6;
                if (b.length > 1 && (a.lock[b[1]] || a.forbid[days[b[1]].dow])) sc -= 10;
              }
            }
            if (sc > bestSc) { bestSc = sc; bestP = p; }
          }
          if (bestP >= 0) {
            g[bestP][i] = s; assigned[bestP]++;
            if (bk >= 0 && !weWorked[bestP][bk]) { weWorked[bestP][bk] = 1; weCount[bestP]++; }
          }
        });
      }
    }

    /* ---------- score (plus bas = meilleur) ---------- */
    function score(g) {
      var sc = 0, i, p, s;
      for (i = 0; i < D; i++) {
        var needs = days[i].needs;
        for (var n = 0; n < needs.length; n++) {
          s = needs[n];
          var cnt = adminCover[i][s] || 0;
          for (p = 0; p < N; p++) if (g[p][i] === s) cnt++;
          if (!cnt) sc += s === 'D2' ? 1800 : 10000;
          else if (cnt > 1) sc += (fill && s === RF && !days[i].we && !days[i].hol) ? 5 + 300 * (cnt - 2) : 300 * (cnt - 1);
        }
        if (days[i].we || days[i].hol) for (p = 0; p < N; p++) if (g[p][i] === 'D2' && !P[p].lock[i]) sc += 300;
      }
      for (p = 0; p < N; p++) {
        var row = g[p], a = P[p], worked = 0, we = 0, prevBlock = false, cnt4 = { C1: 0, M5: 0, M1: 0, D2: 0 }, shiftDays = 0;
        var isolatedOK = false;
        var mr = a.maxRun, prevLen = -1, restLen = -1, segStart = 0, d2run = false, c1run = false;
        for (i = 0; i <= D; i++) {
          var w = i < D && isWork(row[i]);
          if (i < D) {
            if (w) {
              worked++;
              if (row[i] === 'D2') { if (d2run) sc += 100000; d2run = true; }
              if (row[i] === 'C1') { if (c1run) sc += 100000; c1run = true; }
            } else { d2run = false; c1run = false; }
            if (cnt4[row[i]] !== undefined) { cnt4[row[i]]++; shiftDays++; }
            if (badC1(days, row, i)) sc += 5000;
            else if (row[i] === 'C1' && i + 1 < D && isEarly(row[i + 1])) sc += 10;
          }
          // séries : on évalue chaque série de travail et chaque pause à leur fin
          var prevW = i > 0 && isWork(row[i - 1]);
          if (i === D || (i > 0 && w !== prevW)) {
            var len = i - segStart, edge = segStart === 0 || i === D;
            if (i > 0 && prevW) {
              if (len > mr) sc += 200000 * (len - mr);
              else if (len === 1 && !edge && !isolatedOK) sc += row[segStart] === 'D2' ? 350 : 650;
              else if (len === 3) sc += 0;
              else if (len === 4) sc += 1800;
              else if (len === 5) sc += 400;
              else if (len >= 6) sc += 250;
              if (a.rythme === 'lisse') sc += len === 1 && !edge ? 600 : len === 3 ? 450 : len >= 4 ? 1500 : 0;
              else if (a.rythme === 'condense') sc += len === 2 ? 500 : len === 1 && !edge ? 500 : len === 4 ? -1500 : 0;
              if (restLen === 1 && prevLen >= 0) {
                var around = prevLen + len;
                sc += (prevLen >= 4 || len >= 4) ? 100000 : (around >= 6 ? 450 : around >= 4 ? 180 : isolatedOK ? 0 : 120);
              }
              prevLen = len;
            } else if (i > 0) {
              restLen = edge ? -1 : len;
              if (!edge && len >= 6) sc += 12 * (len - 5);
              if (!edge && a.rythme === 'lisse' && len >= 4) sc += 350 * (len - 3);
              if (!edge && a.rythme === 'condense') sc += len === 1 ? 700 : len === 2 ? 300 : 0;
            }
            segStart = i;
          }
        }
        // Répartir les horaires fatigants dans toute fenêtre glissante de sept jours.
        ['C1', 'D2'].forEach(function (sh) {
          for (var start = 0; start < D; start++) {
            if (row[start] !== sh) continue;
            for (var end = start + 1; end < Math.min(D, start + 7); end++) {
              if (row[end] === sh) sc += [0, 100000, 1800, 1000, 600, 300, 120][end - start];
            }
          }
        });
        // Éviter les longues périodes fragmentées par des repos isolés.
        for (var start = 0; start + 6 < D; start++) {
          var windowWork = row.slice(start, start + 7).filter(isWork).length;
          if (windowWork >= 6) sc += 600 * (windowWork - 5);
        }
        if (a.rythme === 'lisse') sc += weekImbalance(a, row);
        for (i = 0; i < D; i++) if (!a.lock[i] && softMissed(a, i, row[i])) sc += 900;
        var dev = worked - a.exp;
        sc += (fill && dev < 0 ? 110 : 40) * dev * dev;
        if (worked > a.maxDays) sc += 200 * (worked - a.maxDays);
        for (var k = 0; k < blocks.length; k++) {
          var b = blocks[k], cntB = 0;
          for (var j = 0; j < b.length; j++) if (isWork(row[b[j]])) cntB++;
          var on = cntB > 0;
          if (on) {
            we++;
            if (b.length === 2 && cntB === 1) sc += 100000;
            if (prevBlock) sc += 120;
            if (b.length === 2 && cntB === 2 && row[b[0]] === row[b[1]]) sc += row[b[0]] === 'C1' ? 400 : 90;
          }
          prevBlock = on;
        }
        var wd = we - a.weDesired; sc += 150 * wd * wd;
        for (var q = 0; q < 4; q++) {
          var sh = SHIFTS[q], ed = cnt4[sh] - a.exp * shareOf[sh];
          sc += EQW[sh] * ed * ed;
        }
      }
      return sc;
    }

    /* Charge lissée : chaque semaine reçoit sa part, au prorata des jours où la personne est disponible. */
    function weekImbalance(a, row) {
      var weeks = [], cur = null, total = 0, done = 0;
      for (var i = 0; i < D; i++) {
        if (!cur || days[i].dow === 1) { cur = { free: 0, work: 0 }; weeks.push(cur); }
        var work = isWork(row[i]), free = work || (!a.lock[i] && !a.forbid[days[i].dow] && !hardRest(a, i));
        if (free) { cur.free++; total++; }
        if (work) { cur.work++; done++; }
      }
      return weeks.reduce(function (sum, w) { var e = w.work - done * w.free / Math.max(1, total); return sum + 140 * e * e; }, 0);
    }

    /* ---------- recuit simulé ---------- */
    function okPair(row, i) {
      // vérifie les contraintes dures autour de la case i
      if (i < 0 || i >= D) return true;
      return !badC1(days, row, i) && !(i > 0 && badC1(days, row, i - 1));
    }
    function okCell(p, i) {
      var row = g2[p];
      if (row[i] && isWork(row[i]) && P[p].forbid[days[i].dow] && !P[p].lock[i]) return false;
      if (row[i] && !P[p].lock[i] && hardBlocked(P[p], i, row[i])) return false;
      return okPair(row, i);
    }
    var g2;
    function anneal(g, rnd, iters) {
      g2 = g;
      var cur = score(g), bestS = cur, bestG = g.map(function (r) { return r.slice(); });
      var T0 = 300, T1 = 0.5, changes = [];
      function set(p, i, v) { changes.push([p, i, g[p][i]]); g[p][i] = v; }
      function swap(a, b, i) { var t = g[a][i]; set(a, i, g[b][i]); set(b, i, t); }
      function free(p, i) { return !P[p].lock[i]; }
      for (var it = 0; it < iters; it++) {
        var T = T0 * Math.pow(T1 / T0, it / iters);
        changes.length = 0;
        var r = rnd(), i = Math.floor(rnd() * D), a = Math.floor(rnd() * N), b = Math.floor(rnd() * N);
        if (r < 0.45) {
          if (a === b || !free(a, i) || !free(b, i) || g[a][i] === g[b][i]) continue;
          swap(a, b, i);
        } else if (r < 0.7) {
          var i2 = Math.floor(rnd() * D);
          if (a === b || i2 === i || !free(a, i) || !free(b, i) || !free(a, i2) || !free(b, i2)) continue;
          if (g[a][i] === g[b][i] && g[a][i2] === g[b][i2]) continue;
          swap(a, b, i); swap(a, b, i2);
        } else if (r < 0.85) {
          if (!blocks.length || a === b) continue;
          var bl = blocks[Math.floor(rnd() * blocks.length)], ok = true;
          bl.forEach(function (x) { if (!free(a, x) || !free(b, x)) ok = false; });
          if (!ok) continue;
          bl.forEach(function (x) { swap(a, b, x); });
        } else {
          // compléter un horaire manquant ou retirer un D2
          var needs = days[i].needs, missing = [];
          needs.forEach(function (s) {
            var cnt = adminCover[i][s] || 0;
            for (var q = 0; q < N; q++) if (g[q][i] === s) cnt++;
            if (!cnt) missing.push(s);
          });
          if (missing.length) {
            if (!free(a, i) || g[a][i]) continue;
            set(a, i, missing[Math.floor(rnd() * missing.length)]);
          } else if (fill && !days[i].we && !days[i].hol && rnd() < 0.5) {
            if (!free(a, i) || g[a][i]) continue;
            set(a, i, RF);
          } else {
            var holders = [];
            for (var q2 = 0; q2 < N; q2++) if ((g[q2][i] === 'D2' || g[q2][i] === RF) && free(q2, i)) holders.push(q2);
            if (!holders.length) continue;
            set(holders[Math.floor(rnd() * holders.length)], i, '');
          }
        }
        var valid = true;
        for (var c = 0; c < changes.length && valid; c++) {
          var pp = changes[c][0], ii = changes[c][1];
          if (!okCell(pp, ii) || !okPair(g[pp], ii - 1) || restViolation(g[pp], P[pp].maxRun) >= 0) valid = false;
        }
        var ns = valid ? score(g) : Infinity;
        if (ns <= cur || (valid && rnd() < Math.exp((cur - ns) / T))) {
          cur = ns;
          if (cur < bestS) { bestS = cur; bestG = g.map(function (rw) { return rw.slice(); }); }
        } else {
          for (var u = changes.length - 1; u >= 0; u--) g[changes[u][0]][changes[u][1]] = changes[u][2];
        }
      }
      return { g: bestG, score: bestS };
    }
  }

  /* Évaluation pour l'affichage : soldes, couverture, alertes. */
  function evaluate(opts) {
    var info = monthInfo(opts.year, opts.month, opts.holidays), rules = opts.rules || {};
    var D = info.D, days = info.days, maxC = rules.maxConsecutive || 5, hpd = rules.hpd || (8 + 25 / 60);
    var all = buildState(opts.staff, info, opts.cells, opts.wishes);
    var issues = [], wishStats = { total: 0, missed: 0, cells: {} };
    var cover = days.map(function () { return {}; });
    var people = all.map(function (a) {
      var worked = 0, c1 = 0, run = 0, we = 0, shifts = {}, d2seen = false, c1seen = false;
      for (var i = 0; i < D; i++) {
        var c = a.row[i];
        if (c) cover[i][c] = (cover[i][c] || 0) + 1;
        if (isWork(c)) {
          worked++; run++;
          shifts[c] = (shifts[c] || 0) + 1;
          if (c === 'D2') { if (d2seen) issues.push({ lvl: 'err', d: i + 1, sid: a.s.id, txt: '2 D2 (coupés) dans la même série' }); d2seen = true; }
          if (c === 'C1') { if (c1seen) issues.push({ lvl: 'err', d: i + 1, sid: a.s.id, txt: '2 C1 dans la même série' }); c1seen = true; }
          var mr = Math.min(a.maxRun || maxC, maxC);
          if (run === mr + 1) issues.push({ lvl: 'err', d: i + 1, sid: a.s.id, txt: 'plus de ' + mr + ' jours de suite' });
          if (a.forbid[days[i].dow]) issues.push({ lvl: 'err', d: i + 1, sid: a.s.id, txt: 'travaille un jour exclu' });
        } else { run = 0; d2seen = false; c1seen = false; }
        var w = a.wish[i];
        if (w && w.non.length) {
          wishStats.total++;
          if (!allows(w, c)) {
            wishStats.missed++;
            var kind = a.lock[i] ? 'lock' : w.souple ? 'soft' : 'hard';
            wishStats.cells[a.s.id + ':' + (i + 1)] = kind;
            issues.push({ lvl: kind === 'hard' ? 'err' : 'warn', d: i + 1, sid: a.s.id, wish: true,
              txt: c + ' contraire au désir ' + (w.souple ? 'souple' : 'ferme') + ' « ' + describeWish(w.non) + ' »' + (a.lock[i] ? ' (saisie fixée à la main)' : '') });
          }
        }
        if (c === 'C1') { c1++; if (badC1(days, a.row, i)) issues.push({ lvl: 'err', d: i + 1, sid: a.s.id, txt: 'C1 suivi d’un horaire du matin' }); }
      }
      ['C1', 'D2'].forEach(function(sh) { for(var i=0;i<D;i++) { if(a.row[i]!==sh) continue; var count=a.row.slice(Math.max(0,i-6),i+1).filter(function(c){return c===sh;}).length; if(count>=3) issues.push({lvl:'warn',d:i+1,sid:a.s.id,txt:count+' '+sh+' sur 7 jours'}); } });
      info.blocks.forEach(function (b) { var n = b.filter(function (i) { return isWork(a.row[i]); }).length; if (n) we++; if (b.length === 2 && n === 1) issues.push({ lvl: 'err', d: b[0] + 1, sid: a.s.id, txt: 'Week-end incomplet : samedi et dimanche indissociables' }); });
      var violation = restViolation(a.row, Math.min(a.maxRun, maxC));
      if (violation >= 0) issues.push({lvl:'err',d:violation+1,sid:a.s.id,txt:'Repos obligatoire de deux jours ou durée maximale non respectés'});
      var dueH = (a.s.taux || 0) / 100 * info.workingDays * hpd;
      var doneH = (worked + a.credit) * hpd;
      var runs = [], len = 0;
      for (var j = 0; j <= D; j++) { if (j < D && isWork(a.row[j])) len++; else if (len) { runs.push(len); len = 0; } }
      return { id: a.s.id, runs: runs, avgRun: runs.length ? worked / runs.length : 0, worked: worked, credit: a.credit, target: a.target, we: we, c1: c1, shifts: shifts, dueH: dueH, doneH: doneH, balance: doneH - dueH };
    });
    var missing = 0, missingD2 = 0;
    days.forEach(function (dd, i) {
      dd.needs.forEach(function (s) {
        var n = cover[i][s] || 0;
        if (!n) {
          if (s === 'D2') missingD2++; else missing++;
          var held = all.filter(function (a) { return a.s.role !== 'admin' && !isWork(a.row[i]) && hardBlocked(a, i, s); }).length;
          issues.push({ lvl: s === 'D2' ? 'info' : 'err', d: i + 1, txt: s + ' non couvert' + (held ? ' — exclu par un désir ferme pour ' + held + ' personne' + (held > 1 ? 's' : '') : '') });
        } else if (n > 1 && !(rules.fillHours && s === (rules.renfort || 'D2') && n === 2 && !dd.we && !dd.hol)) issues.push({ lvl: 'warn', d: i + 1, txt: n + ' personnes en ' + s });
      });
    });
    issues.sort(function (x, y) { var o = { err: 0, warn: 1, info: 2 }; return o[x.lvl] - o[y.lvl] || x.d - y.d; });
    return { info: info, people: people, wishes: wishStats, cover: cover, issues: issues, missing: missing, missingD2: missingD2 };
  }

  var api = { restViolation: restViolation, SHIFTS: SHIFTS, isWork: isWork, isEarly: isEarly, monthInfo: monthInfo, holidaysDefault: holidaysDefault,
    parseCell: parseCell, wishFor: wishFor, allows: allows, describeWish: describeWish, generate: generate, evaluate: evaluate, targetDays: targetDays };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Planner = api;
})(typeof window !== 'undefined' ? window : this);
