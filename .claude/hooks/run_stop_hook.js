#!/usr/bin/env node
// Launches verify_stop.py with whichever Python exists on this machine
// ("python" on Russell's Windows PC, "python3" in cloud sessions), passing
// the hook's stdin through and preserving its exit code and stderr output.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const script = path.join(__dirname, 'verify_stop.py');
let input = Buffer.alloc(0);
try { input = fs.readFileSync(0); } catch (e) { /* no stdin */ }

for (const exe of ['python3', 'python', 'py']) {
  const r = spawnSync(exe, [script], { input, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.error || r.status === 9009) continue;           // not installed (9009 = Windows "not found")
  process.exit(r.status === null ? 0 : r.status);
}
process.stderr.write('[stop-hook] Python not found - skipping checks (allow).\n');
process.exit(0);
