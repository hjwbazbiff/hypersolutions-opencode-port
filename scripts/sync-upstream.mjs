#!/usr/bin/env node
// Deterministic, counted translations and documented live-verification corrections.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const allowed = new Set(['--source', '--revision', '--write', '--check']);
let source;
let revision;
let write = false;
for (let i = 0; i < args.length; i++) {
  if (!allowed.has(args[i])) throw new Error(`Unknown argument: ${args[i]}`);
  if (args[i] === '--source' || args[i] === '--revision') {
    const key = args[i];
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value: ${key}`);
    if (key === '--source') source = resolve(args[++i]);
    else revision = args[++i];
  } else if (args[i] === '--write') write = true;
}
if (write && !source) throw new Error('--write requires --source <upstream checkout>');
if (revision && (!write || !/^[0-9a-f]{40}$/.test(revision))) {
  throw new Error('--revision requires --write and a full 40-character commit SHA');
}
const lockPath = resolve(root, 'provenance/upstream.json');
const rulesPath = resolve(root, 'scripts/upstream-transforms.json');
const rulesBytes = await readFile(rulesPath);
const rules = JSON.parse(rulesBytes);
const sha = (data) => createHash('sha256').update(data).digest('hex');
let lock;
try { lock = JSON.parse(await readFile(lockPath, 'utf8')); }
catch (error) { if (!write || error.code !== 'ENOENT') throw error; }
const git = (...values) => execFileSync('git', ['-C', source, ...values]);
const listFiles = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(relative(root, path).replaceAll('\\', '/'));
    else throw new Error(`Unexpected non-regular file: ${path}`);
  }
  return files.sort();
};

if (source) {
  const commit = revision ?? lock?.commit ?? git('rev-parse', 'HEAD').toString().trim();
  const resolvedCommit = git('rev-parse', `${commit}^{commit}`).toString().trim();
  if (resolvedCommit !== commit) throw new Error('Upstream revision must identify a full commit');
  const inventory = git('ls-tree', '-r', '--name-only', commit).toString().trim().split('\n');
  const content = new Map(inventory.map(path => [path, git('show', `${commit}:${path}`)]));
  const originals = new Map(content);
  const changes = [];
  for (const rule of rules) {
    let occurrences = 0;
    for (const path of rule.files) {
      if (!content.has(path)) throw new Error(`Missing transform target: ${path}`);
      const text = content.get(path).toString('utf8');
      occurrences += text.split(rule.before).length - 1;
      content.set(path, Buffer.from(text.replaceAll(rule.before, rule.after)));
    }
    if (occurrences !== rule.occurrences) throw new Error(`${rule.id}: expected ${rule.occurrences} replacements, got ${occurrences}; review upstream changes`);
    changes.push({ id: rule.id, occurrences });
  }
  const upstreamManifest = JSON.parse(originals.get('.codex-plugin/plugin.json'));
  const files = inventory.map(path => {
    const file = { path, upstreamSha256: sha(originals.get(path)), upstreamBytes: originals.get(path).length };
    if (path.startsWith('skills/')) {
      file.portPath = path;
      file.portSha256 = sha(content.get(path));
      file.portBytes = content.get(path).length;
      file.transformations = rules.filter(rule => rule.files.includes(path)).map(rule => rule.id);
    } else {
      const dispositions = {
        '.agents/plugins/marketplace.json': 'Replaced by npm package discovery and OpenCode plugin configuration; marketplace is Codex-specific.',
        '.codex-plugin/plugin.json': 'Replaced by package.json; upstream identity, version, license and repository recorded here.',
        '.gitignore': 'Repository-only ignore configuration; no runtime capability.',
        '.mcp.json': 'Both endpoints preserved in the adapter native OpenCode mcp defaults; original declarations recorded here.',
        'README.md': 'Installation, authentication, usage, development, links and public/server-side boundary translated in root README.md and provenance notices.'
      };
      if (!dispositions[path]) throw new Error(`Unclassified upstream file: ${path}; preserve or explicitly classify it`);
      file.disposition = dispositions[path];
    }
    return file;
  });
  const generated = {
    schemaVersion: 1,
    repository: 'https://github.com/Hyper-Solutions/hypersolutions-codex',
    commit,
    pluginVersion: upstreamManifest.version,
    author: upstreamManifest.author,
    declaredLicense: upstreamManifest.license,
    licenseEvidence: '.codex-plugin/plugin.json (no standalone LICENSE supplied)',
    mcpServers: JSON.parse(originals.get('.mcp.json')).mcpServers,
    transformationsSha256: sha(rulesBytes),
    transformations: changes,
    files,
  };
  if (write) {
    for (const file of files.filter(file => file.portPath)) {
      const target = resolve(root, file.portPath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content.get(file.path));
    }
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify(generated, null, 2)}\n`);
    lock = generated;
  } else if (JSON.stringify(generated) !== JSON.stringify(lock)) {
    throw new Error('Upstream source / transformation manifest mismatch');
  }
}
if (!lock) throw new Error('Missing provenance lock; initialize with --source <checkout> --write');
if (sha(rulesBytes) !== lock.transformationsSha256) throw new Error('Translation rules changed without an upstream sync');
const expected = lock.files.filter(file => file.portPath).map(file => file.portPath).sort();
const actual = await listFiles(resolve(root, 'skills'));
if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Bundled skills inventory differs from upstream provenance');
for (const file of lock.files.filter(file => file.portPath)) {
  const bytes = await readFile(resolve(root, file.portPath));
  if (sha(bytes) !== file.portSha256 || bytes.length !== file.portBytes) throw new Error(`Bundled content changed: ${file.portPath}`);
  if (file.portPath.endsWith('.md') && /\bcodex\b|mcp__|\.mcp\.json/i.test(bytes.toString())) throw new Error(`Stale platform instructions: ${file.portPath}`);
}
console.log(`Upstream content audit passed: ${expected.length} complete files, ${lock.files.length} upstream files accounted for, commit ${lock.commit}${source ? ', source bytes and exact translations verified' : ', locked SHA-256 bytes verified (use --source for full upstream comparison)'}.`);
