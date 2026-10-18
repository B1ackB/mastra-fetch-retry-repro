import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWithRetry } from './upstream/packages/core/src/utils/fetchWithRetry.ts';

for (const retryAllowed of [true, false]) {
  test(`discarded terminal 503 is released (retryAllowed=${retryAllowed})`, async () => {
    const originalFetch = globalThis.fetch;
    const responses = [];
    let cancellations = 0;
    globalThis.fetch = async () => {
      const response = new Response(new ReadableStream({ cancel() { cancellations++; } }), { status: 503 });
      responses.push(response);
      return response;
    };
    let observedCancellations;
    try {
      await assert.rejects(
        fetchWithRetry('https://example.invalid/asset', {}, 2, { shouldRetryResponse: () => retryAllowed }),
        { name: 'Error', message: 'Request failed with status: 503 ' },
      );
      assert.equal(responses.length, retryAllowed ? 2 : 1, 'the configured attempt cap / retry predicate is respected');
      observedCancellations = cancellations;
      console.log(JSON.stringify({ retryAllowed, attempts: responses.length, cancellations,
        bodyUsed: responses.map(response => response.bodyUsed), result: 'rejected with Error, not Response' }));
    } finally {
      globalThis.fetch = originalFetch;
      for (const response of responses) if (!response.bodyUsed) await response.body.cancel();
    }
    assert.equal(observedCancellations, responses.length, 'all discarded error bodies should be released');
  });
}

test('a returned successful response remains readable by the caller', async () => {
  const originalFetch = globalThis.fetch;
  const response = new Response('ok');
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; return response; };
  try {
    const returned = await fetchWithRetry('https://example.invalid/asset', {}, 2);
    assert.equal(returned, response);
    assert.equal(returned.bodyUsed, false);
    assert.equal(attempts, 1);
    console.log(JSON.stringify({ status: returned.status, attempts, bodyUsedBeforeCallerRead: returned.bodyUsed }));
    assert.equal(await returned.text(), 'ok');
  } finally {
    globalThis.fetch = originalFetch;
    if (!response.bodyUsed) await response.body.cancel();
  }
});
