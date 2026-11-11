import test from 'node:test';
import assert from 'node:assert/strict';

test('shares accept one unique URL and preserve its signed query', async () => {
  const { parseInput } = await import('../src/worker/policy.ts');
  assert.equal(parseInput('请保存 https://media.example/test.mp4?sig=a%2Fb， 谢谢').href,
    'https://media.example/test.mp4?sig=a%2Fb');
  assert.equal(parseInput('https://media.example/test.mp4?sig=a!').href,
    'https://media.example/test.mp4?sig=a!');
  assert.throws(() => parseInput('https://a.example https://b.example'), { code: 'multiple_urls' });
});

test('source policy denies non-allowed hosts, literals, nonstandard ports and open redirects', async () => {
  const { createPolicy } = await import('../src/worker/policy.ts');
  const p = createPolicy('https://app.example', 'media.example');
  assert.equal(p.check(new URL('https://media.example/video')).href, 'https://media.example/video');
  assert.equal(p.check(new URL('https://app.example/demo/clips.html')).href, 'https://app.example/demo/clips.html');
  for (const url of ['https://media.example.bad.test/a', 'http://127.0.0.1/x',
    'https://media.example:8443/x', 'https://user@media.example/x', 'https://app.example/api/v1/inspect',
    'https://app.example/demo/other.mp4', 'https://www.youtube.com/watch?v=x']) {
    assert.throws(() => p.check(new URL(url)), url);
  }
});

test('routes the four disabled platforms without fetching', async () => {
  const { inspect } = await import('../src/worker/inspect.ts');
  for (const [host, source] of [
    ['b23.tv', 'bilibili'], ['v.douyin.com', 'douyin'], ['xhslink.com', 'xiaohongshu'], ['youtu.be', 'youtube'],
  ]) {
    await assert.rejects(inspect(`https://${host}/clip`, {
      origin: 'https://app.example', allowedHosts: host,
      fetcher() { throw new Error('upstream must not be called'); },
    }), { code: 'platform_disabled', source });
  }
});

test('revalidates redirect destinations before following', async () => {
  const { inspect } = await import('../src/worker/inspect.ts');
  let count = 0;
  await assert.rejects(inspect('https://media.example/clip.mp4', {
    origin: 'https://app.example', allowedHosts: 'media.example',
    fetcher() {
      count++;
      return Promise.resolve(new Response(null, { status: 302, headers: { location: 'https://other.example/file' } }));
    },
  }), { code: 'source_not_allowed' });
  assert.equal(count, 1);
});

test('probes the full GET for navigation and independently confirms the browser CORS origin', async () => {
  const { inspect } = await import('../src/worker/inspect.ts');
  const origins = [];
  const result = await inspect('https://media.example/clip.mp4?sig=a%2Fb', {
    origin: 'https://app.example', allowedHosts: 'media.example',
    fetcher(url, init) {
      assert.equal(init.method, 'GET');
      const headers = new Headers(init.headers);
      assert.equal(headers.get('range'), null);
      const origin = headers.get('origin');
      origins.push(origin);
      assert.match(url.href, /sig=a%2Fb$/);
      return Promise.resolve(new Response(null, { status: 200, headers: {
        'content-type': 'video/mp4', 'content-length': '25000',
        ...(origin ? { 'access-control-allow-origin': origin } : {}),
      }}));
    },
  });
  assert.deepEqual(origins, [null, 'https://app.example']);
  assert.equal(result.videos[0].delivery, 'browser');
  assert.equal(result.videos[0].size, 25000);
});

test('does not advertise a download for inline MP4 without CORS or above the browser limit', async () => {
  const { classifyMedia } = await import('../src/worker/media.ts');
  const classify = (extra, status = 200, mode = 'navigation') => classifyMedia(new Response(null, {
    status, headers: { 'content-type': 'video/mp4', ...extra },
  }), 'https://media.example/clip', 'https://app.example', undefined, mode);
  assert.equal(classify({ 'content-length': '42' }).delivery, 'open');
  assert.equal(classify({ 'access-control-allow-origin': '*', 'content-length': '26214401' }, 200, 'cors').delivery, 'open');
  assert.equal(classify({ 'content-disposition': 'attachment', 'content-length': '42' }).delivery, 'attachment');
  assert.equal(classify({ 'access-control-allow-origin': '*', 'content-length': '42' }, 200, 'cors').delivery, 'browser');
  assert.equal(classify({ 'access-control-allow-origin': '*', 'content-length': '1' }, 206).delivery, 'open');
  assert.equal(classify({ 'content-disposition': 'attachment', 'content-range': 'bytes 0-0/42' }, 206).delivery, 'open');
});

test('does not advertise an insecure download from an HTTPS app', async () => {
  const { inspect } = await import('../src/worker/inspect.ts');
  const result = await inspect('http://media.example/clip.mp4', {
    origin: 'https://app.example', allowedHosts: 'media.example',
    fetcher: () => Promise.resolve(new Response(null, { headers: {
      'content-type': 'video/mp4', 'content-disposition': 'attachment',
    }})),
  });
  assert.equal(result.videos[0].delivery, 'open');
});

test('rejects oversized JSON before inspecting a source', async () => {
  const { default: worker } = await import('../src/worker/index.ts');
  const request = new Request('https://app.example/api/v1/inspect', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://media.example/' + 'x'.repeat(8192) }),
  });
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_request');
});

test('cancels an incomplete JSON upload when the request aborts', async () => {
  const { default: worker } = await import('../src/worker/index.ts');
  const controller = new AbortController();
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const request = new Request('https://app.example/api/v1/inspect', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body, duplex: 'half', signal: controller.signal,
  });
  const pending = worker.fetch(request, {});
  controller.abort();
  const response = await pending;
  assert.equal(response.status, 504);
  assert.equal(cancelled, true);
});
