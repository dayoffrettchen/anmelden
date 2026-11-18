import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

// Fixed production target. No credentials, cookies, POSTs or database mutations.
const origin = 'https://anmelden.dayoffrettchen.workers.dev';
const results = [];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function get(path, headers = {}) {
  try {
    return await fetch(origin + path, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'Cache-Control': 'no-cache', ...headers },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error('GET ' + path + ' failed: ' + (error.cause?.code ?? error.name));
  }
}

async function check(name, run) {
  try {
    await run();
    results.push({ name, passed: true });
    console.log('PASS: ' + name);
  } catch (error) {
    // Do not print response bodies: a failed access check could expose private data.
    const message = String(error.message).replace(/[\r\n]+/g, ' ');
    results.push({ name, passed: false, message });
    console.error('FAIL: ' + name + ': ' + message);
  }
}

async function jsonResponse(path, expectedStatus, headers = {}) {
  const response = await get(path, headers);
  assert.ok(response.status === expectedStatus,
    'GET ' + path + ': HTTP ' + response.status + ', expected ' + expectedStatus);
  assert.ok(response.headers.get('content-type')?.includes('application/json'), 'Expected JSON');
  assert.ok(response.headers.get('cache-control')?.includes('no-store'), 'Missing no-store');
  return response.json();
}

for (const [path, file, mime] of [
  ['/', 'index.html', 'text/html'],
  ['/app.js', 'app.js', 'javascript'],
  ['/style.css', 'style.css', 'text/css'],
]) {
  await check('Deployed asset matches checkout: ' + path, async () => {
    const response = await get(path);
    assert.ok(response.status === 200, 'GET ' + path + ': HTTP ' + response.status);
    assert.ok(response.headers.get('content-type')?.includes(mime), 'Unexpected asset content type');
    const actual = Buffer.from(await response.arrayBuffer());
    const expected = readFileSync(new URL('../public/' + file, import.meta.url));
    assert.ok(digest(actual) === digest(expected), 'Deployed file differs from the checked-out version');
  });
}

await check('Anonymous session is not authenticated; local preview is disabled', async () => {
  const data = await jsonResponse('/api/auth/me', 200);
  assert.ok(data.user === null, 'Anonymous request unexpectedly returned a user');
  assert.ok(data.localPreview === false, 'Local preview must be disabled in production');
});

await check('Anonymous visitors cannot list trips', async () => {
  const data = await jsonResponse('/api/trips', 401);
  assert.ok(typeof data.error === 'string', 'Expected an authorization error');
});

await check('Preview identity header cannot authenticate in production', async () => {
  const data = await jsonResponse('/api/auth/me', 200, { 'X-Preview-User': 'mara' });
  assert.ok(data.user === null && data.localPreview === false, 'Preview identity was unexpectedly accepted');
});

await check('Preview identity header cannot list trips', async () => {
  await jsonResponse('/api/trips', 401, { 'X-Preview-User': 'mara' });
});

await check('Organizer endpoint rejects anonymous visitors', async () => {
  await jsonResponse('/api/trips/smoke-test-no-real-trip/manage', 401);
});

const failed = results.filter(result => !result.passed).length;
const report = {
  checkedAt: new Date().toISOString(),
  origin,
  commit: process.env.GITHUB_SHA ?? null,
  mode: 'read-only; no credentials; no email; no data modifications',
  passed: results.length - failed,
  failed,
  results,
  notCovered: [
    'Authenticated user and organizer actions against production D1',
    'Delivery of invitations or login emails through Resend',
    'Rendering and interactions in a live production browser',
  ],
};
writeFileSync('production-smoke-result.json', JSON.stringify(report, null, 2) + '\n');
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '# Read-only production checks\n\n' +
    'Passed: ' + report.passed + '/' + results.length + '. Failed: ' + failed + '.\n\n' +
    results.map(result => '- ' + (result.passed ? 'PASS' : 'FAIL') + ': ' + result.name +
      (result.message ? ' — ' + result.message : '')).join('\n') +
    '\n\nNo production data was created or changed. No email was sent.\n' +
    'Authenticated production workflows and real email delivery remain separate checks.\n');
}
console.log('Result: ' + report.passed + '/' + results.length + ' checks passed.');
if (failed) process.exitCode = 1;
