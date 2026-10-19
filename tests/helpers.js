// Shared test helpers. No dependencies, no build step.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Load a browser-style IIFE module from js/ (e.g. "const Analysis = (() => {...})();")
// without modifying it, by evaluating it with a minimal window shim.
function loadModule(file, globalName) {
  const src = fs.readFileSync(path.join(ROOT, 'js', file), 'utf8');
  const window = { location: { hostname: 'test' } };
  // eslint-disable-next-line no-new-func
  return new Function('window', src + '\nreturn ' + globalName + ';')(window);
}

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: got ${actual}, expected ${expected}`);
}
function done() {
  if (failures) { console.log(`  ${failures} check(s) failed`); process.exit(1); }
}

module.exports = { ROOT, loadModule, check, done };
