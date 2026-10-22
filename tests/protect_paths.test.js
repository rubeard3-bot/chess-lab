// Tests for the hard-lock hook (.claude/hooks/protect_paths.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, check, done } = require('./helpers');

const HOOK = path.join(ROOT, '.claude', 'hooks', 'protect_paths.js');

function run(input, { remote = false } = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: ROOT, CLAUDE_CODE_REMOTE: remote ? 'true' : '' };
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: ROOT, ...input }), env });
  return r.status === 2 ? 'BLOCK' : 'ALLOW';
}

// A variant that controls the working directory the hook sees (both the spawned
// process cwd and the input.cwd) and whether CLAUDE_PROJECT_DIR is set. The
// default run() hardcodes both to ROOT; these cases prove the hook anchors on
// its own file location regardless of where the session started.
function runAt(input, { remote = false, cwd = ROOT, projectDir = undefined, spawnCwd = cwd } = {}) {
  const env = { ...process.env, CLAUDE_CODE_REMOTE: remote ? 'true' : '' };
  if (projectDir === undefined) delete env.CLAUDE_PROJECT_DIR;
  else env.CLAUDE_PROJECT_DIR = projectDir;
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd, ...input }), env, cwd: spawnCwd });
  return r.status === 2 ? 'BLOCK' : 'ALLOW';
}
const edit = (file, agent) => ({ tool_name: 'Edit', tool_input: { file_path: file }, ...(agent ? { agent_type: agent } : {}) });
const bash = (command, agent) => ({ tool_name: 'Bash', tool_input: { command }, ...(agent ? { agent_type: agent } : {}) });

console.log('protect_paths hook');
// Russell's own local main session is never restricted
check('local main session may edit memory.js', run(edit('js/memory.js')), 'ALLOW');
// Agents (subagents anywhere, or anything in the cloud) are restricted
check('builder may not edit memory.js', run(edit('js/memory.js', 'builder')), 'BLOCK');
check('builder may not edit storage.js (absolute path)', run(edit(path.join(ROOT, 'js', 'storage.js'), 'builder')), 'BLOCK');
check('builder may not edit server/', run(edit('server/index.js', 'builder')), 'BLOCK');
check('builder may not edit agent files', run(edit('.claude/agents/builder.md', 'builder')), 'BLOCK');
check('builder may not edit the golden fixture', run(edit('tests/fixtures/lichess_LAPlrQCB.pgn', 'builder')), 'BLOCK');
check('builder may edit app code', run(edit('js/openings.js', 'builder')), 'ALLOW');
check('cloud Lead may not edit analysis.js', run(edit('js/analysis.js'), { remote: true }), 'BLOCK');
check('cloud Lead may edit CLAUDE.md', run(edit('CLAUDE.md'), { remote: true }), 'ALLOW');
// Memory folders: each agent writes only its own
check('builder may write its own memory', run(edit('.claude/agent-memory/builder/MEMORY.md', 'builder')), 'ALLOW');
check('builder may not write chess-reviewer memory', run(edit('.claude/agent-memory/chess-reviewer/MEMORY.md', 'builder')), 'BLOCK');
check('cloud Lead may write lead memory', run(edit('.claude/agent-memory/lead/MEMORY.md'), { remote: true }), 'ALLOW');
check('cloud Lead may not write builder memory', run(edit('.claude/agent-memory/builder/MEMORY.md'), { remote: true }), 'BLOCK');
// Bash writes, reads, deletes
check('reading a protected file is fine', run(bash('cat js/memory.js | head -20', 'code-reviewer')), 'ALLOW');
check('diffing to /tmp is fine', run(bash('git diff main...HEAD -- js/analysis.js > /tmp/d.txt', 'code-reviewer')), 'ALLOW');
check('sed -i on a protected file is blocked', run(bash("sed -i 's/a/b/' js/memory.js", 'builder')), 'BLOCK');
check('redirecting into a protected file is blocked', run(bash('echo x > js/storage.js', 'builder')), 'BLOCK');
check('copying over a protected file is blocked', run(bash('cp /tmp/x.js js/analysis.js', 'builder')), 'BLOCK');
check('git checkout -- protected is blocked', run(bash('git checkout main -- js/memory.js', 'builder')), 'BLOCK');
check('subagent rm of a repo file is blocked', run(bash('rm js/openings.js', 'builder')), 'BLOCK');
check('subagent rm under /tmp is fine', run(bash('rm -rf /tmp/scratch', 'tester')), 'ALLOW');
// git push
check('push to main is blocked', run(bash('git push origin main', 'builder')), 'BLOCK');
check('push HEAD:main is blocked', run(bash('git push origin HEAD:main'), { remote: true }), 'BLOCK');
check('force push is blocked', run(bash('git push --force origin agent/x'), { remote: true }), 'BLOCK');
check('deleting a remote branch is blocked', run(bash('git push origin --delete agent/x'), { remote: true }), 'BLOCK');
check('push of an agent branch is fine', run(bash('git push -u origin agent/opening-teacher'), { remote: true }), 'ALLOW');
check('local push to main by Russell is not restricted', run(bash('git push origin main')), 'ALLOW');
// Read-only agents stay read-only even though memory grants them edit tools
check('code-reviewer may not edit app code', run(edit('js/openings.js', 'code-reviewer')), 'BLOCK');
check('chess-reviewer may not edit app code', run(edit('js/app.js', 'chess-reviewer')), 'BLOCK');
check('tester may not edit app code via bash', run(bash('echo x >> js/ui.js', 'tester')), 'BLOCK');
check('code-reviewer may write its own memory', run(edit('.claude/agent-memory/code-reviewer/MEMORY.md', 'code-reviewer')), 'ALLOW');
check('tester may write screenshots outside the repo', run(bash('cp shot.png /tmp/evidence-x/screenshots/01.png', 'tester')), 'ALLOW');
check('builder may not weaken the test harness', run(edit('tests/helpers.js', 'builder')), 'BLOCK');
check('builder may add a new test', run(edit('tests/openings_retry.test.js', 'builder')), 'ALLOW');
check('cd into js then editing memory.js is blocked', run(bash("cd js && sed -i 's/a/b/' memory.js", 'builder')), 'BLOCK');

// Repo-root resolution: the hook must anchor on its OWN file location, not on
// CLAUDE_PROJECT_DIR / cwd. These absolute-path edits of js/analysis.js must be
// blocked no matter where the session started. (They ALLOW on the pre-fix code.)
const ABS_ANALYSIS = path.join(ROOT, 'js', 'analysis.js');
const PARENT = path.dirname(ROOT);
const SUBFOLDER = path.join(ROOT, 'js');
check('builder edit blocked when cwd is the repo parent (CLAUDE_PROJECT_DIR unset)',
  runAt(edit(ABS_ANALYSIS, 'builder'), { remote: true, cwd: PARENT }), 'BLOCK');
check('builder edit blocked when cwd is a repo subfolder (CLAUDE_PROJECT_DIR unset)',
  runAt(edit(ABS_ANALYSIS, 'builder'), { remote: true, cwd: SUBFOLDER }), 'BLOCK');
check('builder edit blocked when CLAUDE_PROJECT_DIR points at the parent',
  runAt(edit(ABS_ANALYSIS, 'builder'), { remote: true, cwd: ROOT, projectDir: PARENT }), 'BLOCK');

// Second checkout / clone: a target owned by ANOTHER checkout (its own
// .claude/protected-paths.txt up the tree) must also be blocked.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'protcheck-'));
try {
  fs.mkdirSync(path.join(tmpRoot, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'js'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.claude', 'protected-paths.txt'),
                  path.join(tmpRoot, '.claude', 'protected-paths.txt'));
  fs.writeFileSync(path.join(tmpRoot, 'js', 'analysis.js'), '// second checkout\n');
  check('builder edit of js/analysis.js in a SECOND checkout is blocked',
    runAt(edit(path.join(tmpRoot, 'js', 'analysis.js'), 'builder'), { remote: true, cwd: ROOT }), 'BLOCK');
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

// A target owned by no checkout (plain /tmp) stays allowed for the tester.
check('tester Edit of a /tmp screenshot is allowed', runAt(edit('/tmp/shot.png', 'tester'), { remote: true }), 'ALLOW');
check('tester Write of a /tmp screenshot is allowed',
  runAt({ tool_name: 'Write', tool_input: { file_path: '/tmp/shot.png' }, agent_type: 'tester' }, { remote: true }), 'ALLOW');

done();
