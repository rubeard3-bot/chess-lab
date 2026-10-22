#!/usr/bin/env node
// Chess Lab hard lock (PreToolUse hook).
//
// WHAT IT ENFORCES (for agents only, see "WHO IT APPLIES TO"):
//   1. No edits to any path listed in .claude/protected-paths.txt
//      (Edit / Write / MultiEdit / NotebookEdit, and Bash commands that
//      write to, move, or delete a protected path).
//   2. Each agent may write only its OWN memory folder,
//      .claude/agent-memory/<agent-name>/. The main session (the Lead)
//      may write only .claude/agent-memory/lead/.
//   3. No git push to main or master, no force push, no deleting a remote
//      branch.
//   4. Subagents may not delete whole files with rm / git rm / unlink
//      inside the repo (temporary paths under /tmp are allowed).
//   5. Read-only agents (code-reviewer, chess-reviewer, tester) may not
//      change any file in the repo except their own memory folder. Agent
//      memory automatically grants them edit tools, so this hook is what
//      keeps them read-only.
//
// WHO IT APPLIES TO:
//   - Any subagent (the hook input carries agent_type), anywhere.
//   - Any session running in the cloud (CLAUDE_CODE_REMOTE=true), which is
//     where Slack-launched agent work happens.
//   Russell's own local main session is NOT restricted, so he can still
//   deliberately work on protected files on his own computer.
//
// HOW IT BLOCKS: exit code 2 with the reason on stderr. Anything that is not
// a violation exits 0 (no decision). If the hook itself errors, it blocks in
// the cloud (fail closed) and allows locally (fail open).

const fs = require('fs');
const path = require('path');

function readStdin() {
  try { return fs.readFileSync(0).toString('utf8').replace(/^\uFEFF/, ''); }
  catch (e) { return ''; }
}

function block(msg) {
  process.stderr.write('[protect-paths] BLOCKED: ' + msg +
    '\nIf this change is genuinely needed, stop and escalate to Russell ([NEEDS YOU]).\n');
  process.exit(2);
}

const isRemote = String(process.env.CLAUDE_CODE_REMOTE || '').toLowerCase() === 'true';

let input = {};
try { input = JSON.parse(readStdin() || '{}'); } catch (e) { input = {}; }

const agentType = input.agent_type ? String(input.agent_type) : '';
const restricted = isRemote || agentType !== '';
if (!restricted) process.exit(0);

try {
  // The repo root is derived from THIS hook file's own location
  // (.claude/hooks/protect_paths.js -> repo root), NOT from CLAUDE_PROJECT_DIR /
  // input.cwd / process.cwd(). In cloud sessions CLAUDE_PROJECT_DIR is unset and
  // the working directory is the repo's PARENT, which used to make absolute edit
  // targets normalize to "<repo>/js/..." and slip past the exact-string match.
  const HOOK_ROOT = path.resolve(__dirname, '..', '..');
  const norm = p => p.replace(/\\/g, '/').replace(/^\.\//, '');

  // Working directory for resolving relative paths; Bash "cd X && ..." moves it.
  let curDir = input.cwd || HOOK_ROOT;
  function absOf(p) {
    if (!p) return '';
    return path.isAbsolute(p) ? p : path.join(curDir, p);
  }
  function relToRoot(p) {
    const abs = absOf(p);
    if (!abs) return '';
    return norm(path.relative(HOOK_ROOT, abs));
  }

  // Full current protected list, used ONLY if protected-paths.txt can't be read.
  // (Kept in sync with .claude/protected-paths.txt; must NOT be the weak 5-entry
  // list, so a wrong/missing file can never silently degrade protection.)
  const FALLBACK_LIST = [
    'js/memory.js', 'js/storage.js', 'js/analysis.js', 'server/',
    'tests/fixtures/', 'tests/accuracy_golden.test.js', 'tests/helpers.js',
    'tests/run-all.js', 'tests/ci_checks.py', 'tests/protect_paths.test.js',
    'tests/pr_rules.js', 'tests/pr_rules.test.js',
    '.claude/protected-paths.txt', '.claude/hooks/', '.claude/settings.json',
    '.claude/agents/', '.claude/team/', '.github/workflows/',
  ];

  function readList(rootDir) {
    try {
      return fs.readFileSync(path.join(rootDir, '.claude', 'protected-paths.txt'), 'utf8')
        .split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(norm);
    } catch (e) { return null; }
  }

  // The HOOK_ROOT list (with the full fallback and a loud warning if it's used).
  let hookList = readList(HOOK_ROOT);
  if (!hookList) {
    hookList = FALLBACK_LIST;
    if (isRemote) {
      process.stderr.write('[protect-paths] WARN: protected-paths.txt not found at ' +
        path.join(HOOK_ROOT, '.claude', 'protected-paths.txt') + '; using built-in list\n');
    }
  }

  // Per-target checkout matching: for a target, walk UP to the nearest ancestor
  // that owns a .claude/protected-paths.txt and match against THAT checkout's
  // list too. This covers edits aimed at a second clone / worktree of the repo.
  const listCache = new Map();
  function listFor(rootDir) {
    if (!listCache.has(rootDir)) listCache.set(rootDir, readList(rootDir));
    return listCache.get(rootDir);
  }
  function findCheckoutRoot(absFile) {
    if (!absFile) return null;
    let dir = path.dirname(absFile);
    let prev = null;
    while (dir && dir !== prev) {
      try {
        if (fs.existsSync(path.join(dir, '.claude', 'protected-paths.txt'))) return dir;
      } catch (e) { /* ignore */ }
      prev = dir;
      dir = path.dirname(dir);
    }
    return null;
  }

  function matchList(rel, list) {
    if (!rel || rel.startsWith('..') || !list) return null;
    for (const p of list) {
      if (p.endsWith('/') ? (rel === p.slice(0, -1) || rel.startsWith(p)) : rel === p) return p;
    }
    return null;
  }

  // Returns {rel, entry} if the target is protected by EITHER the HOOK_ROOT list
  // or its own checkout's list; null (allowed) if neither matches.
  function protectedHit(p) {
    const hook = matchList(relToRoot(p), hookList);
    if (hook) return { rel: relToRoot(p), entry: hook };
    const abs = absOf(p);
    const coRoot = findCheckoutRoot(abs);
    if (coRoot) {
      const coRel = norm(path.relative(coRoot, abs));
      const co = matchList(coRel, listFor(coRoot));
      if (co) return { rel: coRel, entry: co };
    }
    return null;
  }

  function memoryViolation(rel) {
    const m = rel.match(/^\.claude\/agent-memory(?:-local)?\/([^/]+)\//);
    if (!m) return null;
    const owner = m[1];
    const me = agentType || 'lead';
    return owner === me ? null : `only the "${owner}" agent may write ${rel} (you are "${me}")`;
  }

  const READ_ONLY = ['code-reviewer', 'chess-reviewer', 'tester'];
  function readOnlyViolation(rel) {
    if (!READ_ONLY.includes(agentType) || !rel || rel.startsWith('..')) return null;
    const own = new RegExp('^\\.claude/agent-memory(-local)?/' + agentType + '/');
    return own.test(rel) ? null : `the ${agentType} is read-only and may not change "${rel}"`;
  }

  function checkPath(p) {
    const rel = relToRoot(p);
    const ro = readOnlyViolation(rel);
    if (ro) block(ro + '.');
    const hit = protectedHit(p);
    if (hit) block(`"${hit.rel}" is protected (listed in .claude/protected-paths.txt as "${hit.entry}").`);
    const mv = memoryViolation(rel);
    if (mv) block(mv + '.');
  }

  const tool = input.tool_name || '';
  const ti = input.tool_input || {};

  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    checkPath(ti.file_path || ti.notebook_path || ti.path || '');
    process.exit(0);
  }

  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = String(ti.command || '');

    // 3. git push rules
    for (const seg of cmd.split(/&&|\|\||;|\n/)) {
      const s = seg.trim();
      if (!/\bgit\b[^]*\bpush\b/.test(s)) continue;
      if (/(^|\s)(-f|--force|--force-with-lease)(\s|=|$)/.test(s) || /\s\+\S+/.test(s)) {
        block('force push is not allowed.');
      }
      if (/(^|\s)--delete(\s|$)|(^|\s)-d(\s|$)|\s:\S+/.test(s)) {
        block('deleting a remote branch is not allowed.');
      }
      if (/(^|[\s:])(main|master)(\s|$)/.test(s) || /:refs\/heads\/(main|master)\b/.test(s)) {
        block('pushing to main or master is not allowed; only Russell merges into main.');
      }
      if (/\bgit\s+push(\s+(-u|--set-upstream))?(\s+origin)?\s*$/.test(s)) {
        // A bare "git push" pushes the current branch; refuse if that is main.
        try {
          const headRef = fs.readFileSync(path.join(HOOK_ROOT, '.git', 'HEAD'), 'utf8');
          if (/refs\/heads\/(main|master)\s*$/.test(headRef)) block('you are on main; pushing from main is not allowed.');
        } catch (e) { /* ignore */ }
      }
    }

    // 1 + 4. writes, moves, and deletes that name a protected path.
    // Reads (cat, grep, git diff, node --check, redirecting OUTPUT elsewhere)
    // are allowed; only the paths a command would change are checked.
    const segments = cmd.split(/&&|\|\||;|\n|\|/);
    for (const raw of segments) {
      const seg = raw.trim();
      if (!seg) continue;
      const toks = seg.match(/[^\s'"`<>()]+/g) || [];
      if (toks[0] === 'cd' || toks[0] === 'pushd') {
        const dest = toks[1] || root;
        curDir = path.isAbsolute(dest) ? dest : path.join(curDir, dest);
        continue;
      }
      const targets = [];
      // Output redirection targets: > file, >> file
      for (const m of seg.matchAll(/(?:^|[^0-9&])>{1,2}\s*([^\s;&|]+)/g)) targets.push(m[1]);
      const head = toks[0] || '';
      const sub = toks[1] || '';
      if (head === 'tee') targets.push(...toks.slice(1).filter(t => !t.startsWith('-')));
      if ((head === 'sed' && toks.some(t => /^(-[a-zA-Z]*i|--in-place)/.test(t))) ||
          (head === 'perl' && toks.some(t => /^-[a-zA-Z]*i/.test(t))) ||
          ['truncate', 'chmod', 'chown', 'rm', 'unlink', 'mv', 'touch'].includes(head)) {
        targets.push(...toks.slice(1).filter(t => !t.startsWith('-')));
      }
      if (['cp', 'ln', 'install'].includes(head)) {
        const args = toks.slice(1).filter(t => !t.startsWith('-'));
        if (args.length) targets.push(args[args.length - 1]);
      }
      if (head === 'dd') for (const t of toks) if (t.startsWith('of=')) targets.push(t.slice(3));
      if (head === 'git' && ['rm', 'mv', 'restore', 'checkout', 'apply'].includes(sub)) {
        targets.push(...toks.slice(2).filter(t => !t.startsWith('-')));
      }
      if (/^(python3?|node)$/.test(head) && /\b(writeFile|appendFile|unlink|rmSync|open\([^)]*['"][wa+]['"])/.test(seg)) {
        targets.push(...toks.slice(1));
      }
      for (const t of targets) {
        const rel = relToRoot(t);
        const ro = readOnlyViolation(rel);
        if (ro) block(ro + '.');
        const hit = protectedHit(t);
        if (hit) block(`this command would change protected "${hit.rel}" (listed as "${hit.entry}").`);
        const mv = memoryViolation(rel);
        if (mv) block(mv + '.');
      }
      // 4. Subagents may not delete whole files inside the repo.
      if (agentType && (head === 'rm' || head === 'unlink' || (head === 'git' && sub === 'rm'))) {
        const args = toks.slice(head === 'git' ? 2 : 1).filter(t => !t.startsWith('-'));
        const inRepo = args.map(relToRoot).filter(r => r && !r.startsWith('..'));
        if (inRepo.length) block(`subagents may not delete files in the repo (${inRepo.join(', ')}). Escalate to the Lead.`);
      }
    }
    process.exit(0);
  }

  process.exit(0);
} catch (e) {
  if (isRemote) block('internal error in protect_paths.js (' + e.message + '); failing closed in the cloud.');
  process.exit(0);
}
