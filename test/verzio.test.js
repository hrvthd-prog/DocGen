'use strict';

// A verziókezelés tesztjei. Futtatás: node test/verzio.test.js
//
// A tét: ha a verzió-átírás félremegy, a böngésző a régi JS-t adja, és a
// felhasználók csendben a frissítés ELŐTTI kódot futtatják. Ez háromszor
// megtörtént a fejlesztés alatt, ezért van gép-ellenőrzés a mintaillesztésen.

const fs = require('fs');
const path = require('path');
const { verziok, atir, foResz } = require('../tools/verzio.js');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function section(n) { console.log(`\n[${n}]`); }

section('Verziók kiolvasása');

test('src és href hivatkozásból is olvas', () => {
  const html = '<link href="css/app.css?v=10"><script src="js/app.js?v=10">';
  assert(JSON.stringify(verziok(html)) === '["10","10"]', 'nem talált meg mindkettőt');
});

test('kétszintű verziót is felismer', () => {
  assert(verziok('<script src="js/app.js?v=10.27">')[0] === '10.27');
});

test('kommentben lévő ?v= NEM verzió', () => {
  // Ez valódi eset: az index.html fejlécében magyarázó komment említi a `?v=`-t.
  const html = '<!-- ne írd át kézzel a ?v=99 számokat --><script src="js/app.js?v=10">';
  assert(JSON.stringify(verziok(html)) === '["10"]', 'a kommentet is verziónak vette');
});

section('Átírás');

test('minden hivatkozást átír, a többit érintetlenül hagyja', () => {
  const html = '<link href="a.css?v=10"><p>?v=10</p><script src="b.js?v=9">';
  const { szoveg, db } = atir(html, '11.30');
  assert(db === 2, `2 hivatkozás helyett ${db}`);
  assert(szoveg.includes('a.css?v=11.30') && szoveg.includes('b.js?v=11.30'), 'nem írta át mindet');
  assert(szoveg.includes('<p>?v=10</p>'), 'a szöveges előfordulást is átírta');
});

test('vegyes verziókat egységesít', () => {
  const { szoveg } = atir('<script src="a.js?v=9"><script src="b.js?v=10.2">', '10.3');
  assert(verziok(szoveg).every(v => v === '10.3'));
});

section('Főverzió');

test('foResz levágja az alverziót', () => {
  assert(foResz('10.27') === 10 && foResz('10') === 10 && foResz('') === 0);
});

section('Élő lapok');

for (const lap of ['index.html', 'print.html']) {
  test(`${lap}: van hivatkozás, és mind ugyanazon a verzión`, () => {
    const html = fs.readFileSync(path.join(__dirname, '..', lap), 'utf8');
    const v = verziok(html);
    assert(v.length > 0, 'egyetlen ?v= hivatkozás sincs – eltűnt a gyorsítótár-védelem');
    assert(new Set(v).size === 1, `vegyes verziók: ${[...new Set(v)].join(', ')}`);
  });
}

test('a js/version.js egyezik az index.html verziójával', () => {
  const gyoker = path.join(__dirname, '..');
  const lapV = verziok(fs.readFileSync(path.join(gyoker, 'index.html'), 'utf8'))[0];
  const src  = fs.readFileSync(path.join(gyoker, 'js', 'version.js'), 'utf8');
  const m = /verzio: '([\d.]+)'/.exec(src);
  assert(m, 'a version.js-ből hiányzik a verzió');
  assert(m[1] === lapV, `version.js ${m[1]} ≠ index.html ${lapV}`);
});

console.log(`\n${passed} sikeres, ${failed} hibás`);
process.exit(failed ? 1 : 0);
