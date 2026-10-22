// PR rules, enforced by GitHub on every pull request (see .github/workflows/checks.yml).
//
// Rule 1: a pull request that changes any path in .claude/protected-paths.txt
//         fails unless it carries the "protected-change" label. Only Russell adds
//         that label; agents never add, remove, or change labels.
// Rule 2: a pull request from an agent branch (agent/... or claude/...) fails
//         unless it changes a task file tasks/<date>-<name>.md that records
//         Russell's approval, an impact map, and every reviewer's final verdict.
//
// The protected list is read from the BASE branch (main), so a pull request
// cannot escape Rule 1 by editing the list itself.
//
// Usage in CI:  BASE_SHA=<sha> HEAD_REF=<branch> LABELS='["a","b"]' node tests/pr_rules.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROTECTED_LABEL = 'protected-change';

function parseProtected(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

function isProtected(file, entries) {
  return entries.some(e => (e.endsWith('/') ? file.startsWith(e) : file === e));
}

function checkProtected(changed, entries, labels) {
  const hits = changed.filter(f => isProtected(f, entries));
  const labelled = labels.includes(PROTECTED_LABEL);
  return { ok: hits.length === 0 || labelled, hits, labelled };
}

function isAgentBranch(ref) {
  return /^(agent|claude)\//.test(ref || '') && !/-evidence$/.test(ref);
}

function isTaskFile(f) {
  return /^tasks\/.+\.md$/.test(f) && !/^tasks\/(TEMPLATE|README)\.md$/.test(f);
}

// Each verdict line looks like: "- code-reviewer: PASS (commit 1a2b3c4)"
const REQUIRED_VERDICTS = {
  'code-reviewer': ['PASS'],
  'chess-reviewer': ['PASS', 'N/A'],
  'tester': ['PASS', 'PARTIAL'],
};

function checkTaskContent(text) {
  const problems = [];
  // Require a REAL date (YYYY-MM-DD) right after "on"; the template placeholder
  // "APPROVED by Russell on <date>" must NOT count as approval.
  if (!/APPROVED by Russell on \d{4}-\d{2}-\d{2}/.test(text)) problems.push('missing a real "APPROVED by Russell on YYYY-MM-DD" line (the "<date>" placeholder does not count)');
  if (!/^## Impact map\s*$/m.test(text)) problems.push('missing the "## Impact map" section');
  const v = text.split(/^## Verdicts\s*$/m)[1];
  if (v === undefined) {
    problems.push('missing the "## Verdicts" section');
  } else {
    const section = v.split(/^## /m)[0];
    for (const [agent, allowed] of Object.entries(REQUIRED_VERDICTS)) {
      const m = section.match(new RegExp('^- ' + agent + ':\\s*(\\S+)', 'm'));
      if (!m) problems.push(`no verdict line for ${agent}`);
      else if (!allowed.includes(m[1])) problems.push(`${agent} verdict is ${m[1]} (needs ${allowed.join(' or ')})`);
    }
  }
  return problems;
}

function checkTaskFile(ref, changed, readFile) {
  if (!isAgentBranch(ref)) return { ok: true, skipped: true, problems: [] };
  const tasks = changed.filter(isTaskFile);
  if (!tasks.length) return { ok: false, problems: ['no task file (tasks/<date>-<name>.md) in this pull request'] };
  const results = tasks.map(f => ({ file: f, problems: checkTaskContent(readFile(f)) }));
  const good = results.find(r => r.problems.length === 0);
  return good
    ? { ok: true, file: good.file, problems: [] }
    : { ok: false, problems: results.flatMap(r => r.problems.map(p => `${r.file}: ${p}`)) };
}

function main() {
  const base = process.env.BASE_SHA;
  const ref = process.env.HEAD_REF || '';
  let labels = [];
  try { labels = JSON.parse(process.env.LABELS || '[]') || []; } catch (e) { labels = []; }
  if (!base) { console.log('PR rules: no BASE_SHA (not a pull request), skipping.'); return 0; }

  const git = cmd => execSync(cmd, { encoding: 'utf8' });
  const changed = git(`git diff --name-only ${base}...HEAD`).split('\n').filter(Boolean);
  const entries = parseProtected(git(`git show ${base}:.claude/protected-paths.txt`));
  const root = process.cwd();   // the checked-out pull request (this script may run from a temp copy)
  let failed = false;

  const p = checkProtected(changed, entries, labels);
  if (p.hits.length === 0) console.log('  PASS  no protected files changed');
  else if (p.ok) console.log(`  PASS  protected files changed WITH the "${PROTECTED_LABEL}" label: ${p.hits.join(', ')}`);
  else {
    failed = true;
    console.log(`  FAIL  protected files changed without the "${PROTECTED_LABEL}" label: ${p.hits.join(', ')}`);
    console.log(`        Only Russell may approve this, by adding the "${PROTECTED_LABEL}" label to the pull request.`);
  }

  const t = checkTaskFile(ref, changed, f => fs.readFileSync(path.join(root, f), 'utf8'));
  if (t.skipped) console.log(`  PASS  not an agent branch (${ref}); task-file rule does not apply`);
  else if (t.ok) console.log(`  PASS  task file complete: ${t.file}`);
  else {
    failed = true;
    console.log('  FAIL  agent pull request has no complete task file:');
    t.problems.forEach(x => console.log('        - ' + x));
  }
  return failed ? 1 : 0;
}

module.exports = { parseProtected, isProtected, checkProtected, isAgentBranch, isTaskFile, checkTaskContent, checkTaskFile, PROTECTED_LABEL };

if (require.main === module) process.exit(main());
