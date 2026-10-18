import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fetchWithRetry } from './upstream/packages/core/src/utils/fetchWithRetry.ts';

let requests = 0;
let openErrorResponses = 0;
let errorResponse;
const server = createServer((_request, response) => {
  if (++requests === 1) {
    errorResponse = response;
    openErrorResponses++;
    response.on('close', () => openErrorResponses--);
    response.writeHead(503, { 'Content-Type': 'text/plain' });
    response.write('temporarily unavailable');
    // Leave this body unfinished, as can happen with a slow streaming endpoint.
  } else {
    response.end('ok');
  }
});

const nativeFetch = globalThis.fetch;
let failedResponse;
globalThis.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  if (response.status === 503) failedResponse = response;
  return response;
};

let observedOpenErrors;
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const response = await fetchWithRetry(`http://127.0.0.1:${server.address().port}/asset`, {}, 2);
  assert.equal(await response.text(), 'ok');
  observedOpenErrors = openErrorResponses;
  console.log(JSON.stringify({ requests, openErrorResponses, failedBodyUsed: failedResponse.bodyUsed }));

  // Positive control: cancelling the ignored body releases the server response.
  if (!failedResponse.bodyUsed) {
    const closed = once(errorResponse, 'close');
    await failedResponse.body.cancel();
    await closed;
    console.log(JSON.stringify({ afterExplicitCancellation: openErrorResponses }));
  }
} finally {
  globalThis.fetch = nativeFetch;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

assert.equal(observedOpenErrors, 0, 'a discarded 503 response remained open after the retry succeeded');
