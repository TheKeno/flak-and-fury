import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSheets, saveSheet, safeName, sheetPath } from '../tools/blueprints.mjs';

test('safeName strips directories and odd characters, keeps only image types', () => {
  assert.equal(safeName('../../etc/passwd.png'), 'passwd.png');
  assert.equal(safeName('C:\\x\\y\\P-38J sheet (v2).JPG'), 'P-38J sheet -v2.jpg');
  assert.equal(safeName('..png'), null);
  assert.equal(safeName('evil.html'), null);
  assert.equal(safeName('noext'), null);
  assert.equal(safeName('.png'), null);
  assert.equal(safeName(null), null);
  assert.ok(!safeName('a..b/../c.png').includes('..'));
});

test('sheetPath accepts only names already in safe form', () => {
  assert.equal(sheetPath('/lib', '../x.png'), null);
  assert.equal(sheetPath('/lib', 'a/b.png'), null);
  assert.equal(sheetPath('/lib', 'a b.png') !== null, true);
});

test('saveSheet writes inside the folder, never overwrites, limits size and type', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bp-'));
  try {
    const a = await saveSheet(dir, '../../up.png', Buffer.from('one'));
    const b = await saveSheet(dir, 'up.png', Buffer.from('two'));
    assert.equal(a, 'up.png');
    assert.equal(b, 'up-2.png');
    assert.equal(await readFile(join(dir, 'up.png'), 'utf8'), 'one');
    await assert.rejects(saveSheet(dir, 'x.exe', Buffer.from('x')));
    await assert.rejects(saveSheet(dir, 'x.png', Buffer.alloc(0)));
    assert.deepEqual((await readdir(dir)).sort(), ['up-2.png', 'up.png']);
    assert.deepEqual((await listSheets(dir)).map((s) => s.name), ['up-2.png', 'up.png']);
  } finally {
    await rm(dir, { recursive: true });
  }
});
