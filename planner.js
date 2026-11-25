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
  function badC1(days, row, i) { // C1 le jour i puis horaire du matin le jour i+1, hors week-end
    return row[i] === 'C1' && i + 1 < row.length && isEarly(row[i + 1]) && !lightPair(days, i);
  }

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
  function buildState(staff, info, cells) {
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
      return { s: s, row: row, lock: lock, credit: credit, target: targetDays(s, info), forbid: forbid,
        maxRun: +s.maxSuite > 0 ? +s.maxSuite : 0 };
    });
  }

  function generate(opts) {
    var staff = opts.staff, rules = opts.rules || {};
    var info = monthInfo(opts.year, opts.month, opts.holidays);
    var D = info.D, days = info.days, blocks = info.blocks, blockOf = info.blockOf;
    var maxC = rules.maxConsecutive || 5;
    // Compléter les heures : un horaire de renfort en plus en semaine pour atteindre le taux de chacune
    var fill = !!rules.fillHours, RF = rules.renfort || 'D2';
    var seed = opts.seed || (Date.now() & 0x7fffffff);
    var all = buildState(staff, info, opts.cells);

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
    P.forEach(function (a) { a.exp = a.lockedWork + a.cap * f; a.maxDays = a.target - a.credit; a.maxRun = a.maxRun || maxC; });

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
    var EQW = { C1: 30, M5: 14, M1: 14, D2: 14 };

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
          if (a.lock[x] || row[x] !== RF || days[x].we || days[x].hol || x - last < 5) continue;
          var others = 0;
          for (var y = 0; y < N; y++) if (y !== p && best[y][x] === RF) others++;
          if (!others) continue;
          row[x] = 'T'; have++; last = x;
        }
      }
      var cands = [];
      for (var i = 0; i < D; i++) {
        if (days[i].we || days[i].hol || a.lock[i] || row[i] || a.forbid[days[i].dow]) continue;
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
        row[i2] = 'T'; picked.push(i2); have++; worked++;
      }
    });

    var out = {};
    all.forEach(function (a) {
      var row = a.s.role === 'admin' ? a.row : best[P.indexOf(a)], o = {};
      for (var i = 0; i < D; i++) if (row[i]) o[i + 1] = (a.lock[i] ? '!' : '') + row[i];
      out[a.s.id] = o;
    });
    return { cells: out, score: bestScore, seed: seed };

    /* ---------- construction gloutonne ---------- */
    function runBefore(row, i) { var n = 0; for (var k = i - 1; k >= 0 && isWork(row[k]); k--) n++; return n; }
    function canTake(g, p, i, s) {
      var a = P[p];
      if (a.lock[i] || g[p][i]) return false;
      if (a.forbid[days[i].dow]) return false;
      if (isEarly(s) && i > 0 && g[p][i - 1] === 'C1' && !lightPair(days, i - 1)) return false;
      if (s === 'C1' && i + 1 < D && isEarly(g[p][i + 1]) && !lightPair(days, i)) return false;
      return true;
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
            if (run >= a.maxRun) sc -= 50;
            if (assigned[p] >= a.maxDays) sc -= 30;
            if (run === 1 || run === 2) sc += 1.2; else if (run >= 3) sc -= 1.5 * (run - 2);
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
          if (!cnt) sc += s === 'D2' ? 400 : 10000;
          else if (cnt > 1) sc += (fill && s === RF && !days[i].we && !days[i].hol) ? 5 + 300 * (cnt - 2) : 300 * (cnt - 1);
        }
        if (days[i].we || days[i].hol) for (p = 0; p < N; p++) if (g[p][i] === 'D2' && !P[p].lock[i]) sc += 300;
      }
      for (p = 0; p < N; p++) {
        var row = g[p], a = P[p], worked = 0, we = 0, prevBlock = false, cnt4 = { C1: 0, M5: 0, M1: 0, D2: 0 }, shiftDays = 0;
        var mr = a.maxRun, prevLen = -1, restLen = -1, segStart = 0;
        for (i = 0; i <= D; i++) {
          var w = i < D && isWork(row[i]);
          if (i < D) {
            if (w) worked++;
            if (cnt4[row[i]] !== undefined) { cnt4[row[i]]++; shiftDays++; }
            if (badC1(days, row, i)) sc += 5000;
            else if (row[i] === 'C1' && i + 1 < D && isEarly(row[i + 1])) sc += 10;
          }
          // séries : on évalue chaque série de travail et chaque pause à leur fin
          var prevW = i > 0 && isWork(row[i - 1]);
          if (i === D || (i > 0 && w !== prevW)) {
            var len = i - segStart, edge = segStart === 0 || i === D;
            if (i > 0 && prevW) {
              if (len > mr) sc += 3000 * (len - mr);
              else if (len === 1 && !edge) sc += 70;
              else if (len === 3) sc += mr <= 3 ? 25 : 4;
              else if (len === 4) sc += 40;
              else if (len === 5) sc += 120;
              else if (len >= 6) sc += 250;
              if (restLen === 1 && prevLen >= 0) {
                var around = prevLen + len;
                sc += around >= 7 ? 140 : around >= 6 ? 70 : around >= 5 ? 30 : 10;
              }
              prevLen = len;
            } else if (i > 0) {
              restLen = edge ? -1 : len;
              if (!edge && len >= 6) sc += 12 * (len - 5);
            }
            segStart = i;
          }
        }
        var dev = worked - a.exp;
        sc += (fill && dev < 0 ? 110 : 40) * dev * dev;
        if (worked > a.maxDays) sc += 200 * (worked - a.maxDays);
        for (var k = 0; k < blocks.length; k++) {
          var b = blocks[k], cntB = 0;
          for (var j = 0; j < b.length; j++) if (isWork(row[b[j]])) cntB++;
          var on = cntB > 0;
          if (on) {
            we++;
            if (b.length === 2 && cntB === 1) sc += 80;
            if (prevBlock) sc += 120;
            if (b.length === 2 && cntB === 2 && row[b[0]] === row[b[1]]) sc += row[b[0]] === 'C1' ? 400 : 90;
          }
          prevBlock = on;
        }
        var wd = we - a.weDesired; sc += 150 * wd * wd;
        for (var q = 0; q < 4; q++) {
          var sh = SHIFTS[q], ed = cnt4[sh] - shiftDays * shareOf[sh];
          sc += EQW[sh] * ed * ed;
        }
      }
      return sc;
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
          if (!okCell(pp, ii) || !okPair(g[pp], ii - 1)) valid = false;
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
    var all = buildState(opts.staff, info, opts.cells);
    var issues = [];
    var cover = days.map(function () { return {}; });
    var people = all.map(function (a) {
      var worked = 0, c1 = 0, run = 0, we = 0, shifts = {};
      for (var i = 0; i < D; i++) {
        var c = a.row[i];
        if (c) cover[i][c] = (cover[i][c] || 0) + 1;
        if (isWork(c)) {
          worked++; run++;
          shifts[c] = (shifts[c] || 0) + 1;
          var mr = a.maxRun || maxC;
          if (run === mr + 1) issues.push({ lvl: 'warn', d: i + 1, sid: a.s.id, txt: 'plus de ' + mr + ' jours de suite' });
          if (a.forbid[days[i].dow]) issues.push({ lvl: 'err', d: i + 1, sid: a.s.id, txt: 'travaille un jour exclu' });
        } else run = 0;
        if (c === 'C1') { c1++; if (badC1(days, a.row, i)) issues.push({ lvl: 'err', d: i + 1, sid: a.s.id, txt: 'C1 suivi d’un horaire du matin' }); }
      }
      info.blocks.forEach(function (b) { if (b.some(function (i) { return isWork(a.row[i]); })) we++; });
      var dueH = (a.s.taux || 0) / 100 * info.workingDays * hpd;
      var doneH = (worked + a.credit) * hpd;
      return { id: a.s.id, worked: worked, credit: a.credit, target: a.target, we: we, c1: c1, shifts: shifts, dueH: dueH, doneH: doneH, balance: doneH - dueH };
    });
    var missing = 0, missingD2 = 0;
    days.forEach(function (dd, i) {
      dd.needs.forEach(function (s) {
        var n = cover[i][s] || 0;
        if (!n) {
          if (s === 'D2') missingD2++; else missing++;
          issues.push({ lvl: s === 'D2' ? 'info' : 'err', d: i + 1, txt: s + ' non couvert' });
        } else if (n > 1 && !(rules.fillHours && s === (rules.renfort || 'D2') && n === 2 && !dd.we && !dd.hol)) issues.push({ lvl: 'warn', d: i + 1, txt: n + ' personnes en ' + s });
      });
    });
    issues.sort(function (x, y) { var o = { err: 0, warn: 1, info: 2 }; return o[x.lvl] - o[y.lvl] || x.d - y.d; });
    return { info: info, people: people, cover: cover, issues: issues, missing: missing, missingD2: missingD2 };
  }

  var api = { SHIFTS: SHIFTS, isWork: isWork, isEarly: isEarly, monthInfo: monthInfo, holidaysDefault: holidaysDefault,
    parseCell: parseCell, generate: generate, evaluate: evaluate, targetDays: targetDays };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Planner = api;
})(typeof window !== 'undefined' ? window : this);
