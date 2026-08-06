'use strict';

// Minden teszt futtatása: node test/run-all.js

const { spawnSync } = require('child_process');
const path = require('path');

const suites = ['auto-tests.js', 'employee-repo.test.js', 'schema.test.js', 'schema-from-xlsx.test.js'];
let failedSuites = 0;

for (const s of suites) {
  console.log(`\n${'═'.repeat(60)}\n▶ ${s}\n${'═'.repeat(60)}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' });
  if (r.status !== 0) failedSuites++;
}

console.log(`\n${'═'.repeat(60)}`);
if (failedSuites) {
  console.log(`${failedSuites} tesztkészlet hibás.`);
  process.exit(1);
}
console.log('Minden tesztkészlet sikeres ✓');
