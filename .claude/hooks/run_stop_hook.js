#!/usr/bin/env node
// Launches verify_stop.py with whichever Python exists on this machine
// ("python" on Russell's Windows PC, "python3" in cloud sessions), passing
// the hook's stdin through and preserving its exit code and stderr output.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Resolve the repo root and the python script from THIS file's own location
// (.claude/hooks/run_stop_hook.js -> repo root), never from CLAUDE_PROJECT_DIR
// or the working directory. In cloud sessions CLAUDE_PROJECT_DIR is unset and
// the cwd is the repo's PARENT, which would make verify_stop.py's own
// git-from-cwd root detection miss the repo. We hand it the correct root by
// running it from HOOK_ROOT and exporting CLAUDE_PROJECT_DIR=HOOK_ROOT.
const HOOK_ROOT = path.resolve(__dirname, '..', '..');
const script = path.join(__dirname, 'verify_stop.py');
let input = Buffer.alloc(0);
try { input = fs.readFileSync(0); } catch (e) { /* no stdin */ }

const childEnv = { ...process.env, CLAUDE_PROJECT_DIR: HOOK_ROOT };
for (const exe of ['python3', 'python', 'py']) {
  const r = spawnSync(exe, [script], { input, cwd: HOOK_ROOT, env: childEnv, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.error || r.status === 9009) continue;           // not installed (9009 = Windows "not found")
  process.exit(r.status === null ? 0 : r.status);
}
process.stderr.write('[stop-hook] Python not found - skipping checks (allow).\n');
process.exit(0);
