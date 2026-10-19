// Tests for the hard-lock hook (.claude/hooks/protect_paths.js).
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, check, done } = require('./helpers');

const HOOK = path.join(ROOT, '.claude', 'hooks', 'protect_paths.js');

function run(input, { remote = false } = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: ROOT, CLAUDE_CODE_REMOTE: remote ? 'true' : '' };
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: ROOT, ...input }), env });
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
done();
