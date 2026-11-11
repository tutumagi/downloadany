import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const address = 'https://media.example/playback.mp4';

test('detects the current native MP4 source discovered after playback', async () => {
  const { candidatesFrom } = await import('../extension/detect.ts');
  assert.deepEqual(candidatesFrom([{ url: address, current: true }]), [{ url: address, kind: 'mp4', current: true }]);
  assert.deepEqual(candidatesFrom([{ url: address }]), []);
  assert.deepEqual(candidatesFrom([{ url: 'https://media.example/file', type: 'video/mp4' }]), [
    { url: 'https://media.example/file', kind: 'mp4' },
  ]);
});

test('streams a complete MP4 without credentials or redirects and preserves file bytes', async () => {
  const { writeProgressiveMp4 } = await import('../extension/progressive.ts');
  const file = await readFile(new URL('../public/demo/orbit.mp4', import.meta.url));
  const chunks = [];
  const progress = [];
  const count = await writeProgressiveMp4(address, async (data) => { chunks.push(Buffer.from(data)); }, {
    fetcher: async (url, init) => {
      assert.equal(url, address);
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      return new Response(new ReadableStream({ start(controller) {
        for (const chunk of [file.subarray(0, 3), file.subarray(3, 20), file.subarray(20)]) controller.enqueue(chunk);
        controller.close();
      } }), { headers: { 'content-type': 'video/mp4', 'content-length': String(file.length) } });
    },
    progress: (bytes, total) => progress.push([bytes, total]),
  });
  assert.equal(count, file.length);
  assert.deepEqual(Buffer.concat(chunks), file);
  assert.deepEqual(progress.at(-1), [file.length, file.length]);
});

test('refuses an access denial, HTML pretending to be MP4, and partial HTTP responses', async () => {
  const { writeProgressiveMp4 } = await import('../extension/progressive.ts');
  for (const [status, type, code] of [[403, 'text/html', 'access'], [200, 'video/mp4', 'media'], [206, 'video/mp4', 'media']]) {
    let written = 0;
    await assert.rejects(writeProgressiveMp4(address, async () => { written++; }, {
      fetcher: async () => new Response('<html>not a video</html>', { status, headers: { 'content-type': type } }),
    }), { code });
    assert.equal(written, 0);
  }
});
