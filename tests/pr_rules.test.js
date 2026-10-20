// Tests for tests/pr_rules.js (the GitHub-side protected-file and task-file rules).
const fs = require('fs');
const path = require('path');
const { ROOT, check, done } = require('./helpers');
const R = require('./pr_rules');

console.log('pr_rules: GitHub-side PR rules');

const entries = R.parseProtected(fs.readFileSync(path.join(ROOT, '.claude', 'protected-paths.txt'), 'utf8'));
check('protected list parses', entries.includes('js/analysis.js'), true);
check('comments are ignored', entries.some(e => e.startsWith('#')), false);
check('the PR rules are themselves protected', entries.includes('tests/pr_rules.js'), true);

check('exact file is protected', R.isProtected('js/memory.js', entries), true);
check('folder entry protects files inside', R.isProtected('server/index.js', entries), true);
check('workflow folder is protected', R.isProtected('.github/workflows/checks.yml', entries), true);
check('ordinary file is not protected', R.isProtected('js/ui.js', entries), false);
check('similar name is not protected', R.isProtected('js/analysis.js.bak', entries), false);

check('protected change without label fails', R.checkProtected(['js/ui.js', 'js/storage.js'], entries, []).ok, false);
check('protected change with label passes', R.checkProtected(['js/storage.js'], entries, ['protected-change']).ok, true);
check('unprotected change needs no label', R.checkProtected(['js/ui.js'], entries, []).ok, true);
check('a different label does not count', R.checkProtected(['server/index.js'], entries, ['approved']).ok, false);

check('agent/ branch is an agent branch', R.isAgentBranch('agent/time-control-sort'), true);
check('claude/ branch is an agent branch', R.isAgentBranch('claude/slack-session-d4gf2d'), true);
check('evidence branch is exempt', R.isAgentBranch('agent/x-evidence'), false);
check('Russell branch is not an agent branch', R.isAgentBranch('russell/safety-upgrade'), false);
check('template is not a task file', R.isTaskFile('tasks/TEMPLATE.md'), false);
check('dated plan is a task file', R.isTaskFile('tasks/2026-10-20-time-control-sort.md'), true);

const good = [
  '# Task', '## Impact map', '- js/archive.js: lists games', '## Approval',
  'APPROVED by Russell on 2026-10-20: "approved, build agent/x"',
  '## Verdicts', '- code-reviewer: PASS (commit abc1234)', '- chess-reviewer: N/A (no chess facts touched)',
  '- tester: PARTIAL (backend CANNOT TEST)', '## Log', '- done',
].join('\n');
check('complete task file has no problems', R.checkTaskContent(good).length, 0);
check('missing approval is caught', R.checkTaskContent(good.replace('APPROVED by Russell', 'approved')).length, 1);
check('missing impact map is caught', R.checkTaskContent(good.replace('## Impact map', '## Notes')).length, 1);
check('FAIL verdict is caught', R.checkTaskContent(good.replace('code-reviewer: PASS', 'code-reviewer: FAIL')).length, 1);
check('missing tester verdict is caught', R.checkTaskContent(good.replace('- tester: PARTIAL (backend CANNOT TEST)\n', '')).length, 1);
check('template placeholders do not pass', R.checkTaskContent(fs.readFileSync(path.join(ROOT, 'tasks', 'TEMPLATE.md'), 'utf8')).length > 0, true);

const read = f => (f === 'tasks/2026-10-20-x.md' ? good : '');
check('agent PR with complete task file passes', R.checkTaskFile('agent/x', ['js/ui.js', 'tasks/2026-10-20-x.md'], read).ok, true);
check('agent PR without task file fails', R.checkTaskFile('agent/x', ['js/ui.js'], read).ok, false);
check('Russell PR skips the task-file rule', R.checkTaskFile('russell/safety-upgrade', ['js/ui.js'], read).ok, true);

done();
