#!/usr/bin/env node
/**
 * Build-time art generation.
 *
 * Generates the manifest's images once and writes them into public/art/, which
 * is committed. The game itself never calls this — the browser has no network
 * at runtime, it just loads the files.
 *
 * The API key is read from ~/.config/meshy/env, OUTSIDE this repository, and is
 * never written into the tree, never logged, and never passed on a command line
 * where it would land in shell history or a process list.
 *
 *   node tools/genart.mjs               # generate anything missing
 *   node tools/genart.mjs --only m-     # only ids containing "m-"
 *   node tools/genart.mjs --force       # regenerate even if present
 *   node tools/genart.mjs --list        # show what would be done, spend nothing
 *
 * Already-present outputs are skipped, so re-running is free and cannot churn
 * art that has already been approved.
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ALL } from './art-manifest.js';

const API = 'https://api.meshy.ai/openapi/v1/text-to-image';
const MODEL = 'gpt-image-2';
const OUT_ROOT = path.resolve(import.meta.dirname, '..', 'public', 'art');
const CONCURRENCY = 3;
const POLL_MS = 6000;
const POLL_MAX = 60;

async function loadKey() {
  // Deliberately only from outside the repo. If someone later adds a .env here
  // it will not be picked up, and the pre-commit hook would refuse it anyway.
  const file = path.join(homedir(), '.config', 'meshy', 'env');
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    console.error(`[genart] no credentials at ${file}`);
    console.error('[genart] create it with:  MESHY_API_KEY=your_key');
    process.exit(2);
  }
  const m = text.match(/MESHY_API_KEY\s*=\s*(\S+)/);
  if (!m) {
    console.error(`[genart] ${file} has no MESHY_API_KEY=... line`);
    process.exit(2);
  }
  return m[1];
}

const exists = (p) => access(p).then(() => true, () => false);

async function submit(key, entry) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: entry.prompt,
      ai_model: entry.model ?? MODEL,
      aspect_ratio: entry.aspect ?? '1:1',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.result) {
    throw new Error(`submit failed (${res.status}): ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.result;
}

async function poll(key, id) {
  for (let i = 0; i < POLL_MAX; i++) {
    const res = await fetch(`${API}/${id}`, { headers: { Authorization: `Bearer ${key}` } });
    const body = await res.json().catch(() => ({}));
    if (body.status === 'SUCCEEDED') return body;
    if (body.status === 'FAILED' || body.status === 'CANCELED') {
      throw new Error(`generation ${body.status}: ${JSON.stringify(body.task_error ?? {}).slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error('timed out waiting for generation');
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return buf.length;
}

async function run() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const listOnly = argv.includes('--list');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;

  let work = ALL.filter((e) => !only || e.id.includes(only));
  if (!force) {
    const kept = [];
    for (const e of work) {
      if (await exists(path.join(OUT_ROOT, `${e.id}.png`))) continue;
      kept.push(e);
    }
    work = kept;
  }

  console.log(`[genart] ${work.length} to generate` +
    (work.length ? ` (~${work.length * 9} credits)` : ' — everything present'));
  if (listOnly || !work.length) {
    for (const e of work) console.log(`   ${e.id}`);
    return;
  }

  const key = await loadKey();
  let done = 0, failed = 0;
  const queue = [...work];

  const worker = async () => {
    for (;;) {
      const entry = queue.shift();
      if (!entry) return;
      const dest = path.join(OUT_ROOT, `${entry.id}.png`);
      try {
        const id = await submit(key, entry);
        const task = await poll(key, id);
        const url = task.image_urls?.[0];
        if (!url) throw new Error('no image url in completed task');
        const bytes = await download(url, dest);
        done++;
        console.log(`  ok  ${entry.id}  (${(bytes / 1024).toFixed(0)} KB, ${task.consumed_credits ?? '?'} credits)`);
      } catch (err) {
        failed++;
        // Never echo the key, even inside an error body.
        console.error(`  FAIL ${entry.id}: ${String(err.message).replace(/msy_[A-Za-z0-9]+/g, 'msy_***')}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, worker));
  console.log(`[genart] ${done} generated, ${failed} failed -> ${path.relative(process.cwd(), OUT_ROOT)}`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => {
  console.error(String(e.message).replace(/msy_[A-Za-z0-9]+/g, 'msy_***'));
  process.exit(1);
});
