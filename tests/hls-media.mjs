import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createFixture, probe } from './hls-fixture.mjs';

const directory = await mkdtemp(join(tmpdir(), 'downloadany-hls-'));
try {
  const { prepareHls } = await import('../extension/hls.ts');
  const { writeHlsMp4 } = await import('../extension/remux.ts');
  for (const kind of ['mpegts', 'fmp4']) {
    const fixture = join(directory, kind);
    createFixture(fixture, kind);
    const options = { fetcher: async (url) => new Response(await readFile(join(fixture, basename(new URL(url).pathname)))) };
    const playlist = await prepareHls('https://example.test/media.m3u8', options);
    assert.equal(playlist.segments.length, 3);
    const path = join(directory, kind + '.mp4');
    const handle = await open(path, 'w');
    try {
      await writeHlsMp4(playlist, (chunk) => handle.write(chunk), options);
    } finally {
      await handle.close();
    }
    const output = probe(path);
    assert.equal(output.streams.find((stream) => stream.codec_type === 'video')?.codec_name, 'h264');
    assert.equal(output.streams.find((stream) => stream.codec_type === 'audio')?.codec_name, 'aac');
    assert.ok(Number(output.format.duration) > 4.9 && Number(output.format.duration) < 5.5, output.format.duration);
    console.log(kind + ': three segments saved as playable H.264/AAC MP4 (' + output.format.duration + 's)');
  }
  const ac3 = join(directory, 'ac3');
  createFixture(ac3, 'mpegts', 'ac3');
  const options = { fetcher: async (url) => new Response(await readFile(join(ac3, basename(new URL(url).pathname)))) };
  const playlist = await prepareHls('https://example.test/media.m3u8', options);
  let written = 0;
  await assert.rejects(writeHlsMp4(playlist, async (chunk) => { written += chunk.byteLength; }, options), { code: 'media' });
  assert.equal(written, 0, 'the unsupported audio must not produce a silent MP4');
  console.log('mpegts with AC-3: rejected without producing a silent video');
} finally {
  await rm(directory, { recursive: true, force: true });
}
