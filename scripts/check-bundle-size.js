#!/usr/bin/env node
/**
 * Bundle size enforcement.
 * Fails if total gzipped JS exceeds 500 KB.
 * Reports entry and lazy chunks separately.
 */
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const BUDGET_BYTES = 500 * 1024; // 500 KB gzip
const distDir = join(process.cwd(), 'dist', 'assets');

try {
  readdirSync(distDir);
} catch {
  console.error('ERROR: dist/assets not found. Run `npm run build` first.');
  process.exit(1);
}

const jsFiles = readdirSync(distDir).filter((f) => f.endsWith('.js'));

if (jsFiles.length === 0) {
  console.error('ERROR: No JS files found in dist/assets.');
  process.exit(1);
}

let totalGzip = 0;
const chunks = [];

for (const file of jsFiles) {
  const filePath = join(distDir, file);
  const raw = statSync(filePath).size;
  // Use gzip -c to get gzipped size
  const gzipped = execSync(`gzip -c "${filePath}" | wc -c`, { encoding: 'utf-8' }).trim();
  const gzipSize = parseInt(gzipped, 10);
  totalGzip += gzipSize;

  const isEntry = file.startsWith('index');
  chunks.push({
    file,
    raw: raw,
    gzip: gzipSize,
    type: isEntry ? 'entry' : 'lazy',
  });
}

console.log('\n📦 Bundle Size Report');
console.log('━'.repeat(60));
console.log('');

// Entry chunks
const entryChunks = chunks.filter((c) => c.type === 'entry');
const lazyChunks = chunks.filter((c) => c.type === 'lazy');

if (entryChunks.length > 0) {
  console.log('Entry chunks:');
  for (const c of entryChunks) {
    console.log(
      `  ${c.file}: ${(c.raw / 1024).toFixed(2)} KB raw, ${(c.gzip / 1024).toFixed(2)} KB gzip`,
    );
  }
}

if (lazyChunks.length > 0) {
  console.log('\nLazy chunks:');
  for (const c of lazyChunks) {
    console.log(
      `  ${c.file}: ${(c.raw / 1024).toFixed(2)} KB raw, ${(c.gzip / 1024).toFixed(2)} KB gzip`,
    );
  }
}

console.log('');
console.log(`Total JS gzip: ${(totalGzip / 1024).toFixed(2)} KB`);
console.log(`Budget: ${(BUDGET_BYTES / 1024).toFixed(2)} KB`);
console.log('');

if (totalGzip > BUDGET_BYTES) {
  console.error(
    `❌ FAILED: Bundle exceeds budget by ${((totalGzip - BUDGET_BYTES) / 1024).toFixed(2)} KB`,
  );
  process.exit(1);
} else {
  const remaining = BUDGET_BYTES - totalGzip;
  console.log(`✅ PASSED: ${(remaining / 1024).toFixed(2)} KB remaining`);
}
