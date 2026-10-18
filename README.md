# Mastra fetchWithRetry response-body cleanup reproduction

Minimal reproduction of discarded non-OK response bodies remaining open after `fetchWithRetry` retries or throws. The helper itself is imported from an unchanged, pinned upstream checkout; no implementation is copied into this repository.

## Requirements

- Git and Node.js 24.14.0 (tested; Mastra requires at least Node 24.11.0 on this line).
- No npm dependencies, package installation, LLM credentials, or paid APIs.
- GitHub access is needed only for the initial clones/fetch. The reproduction uses a temporary HTTP server bound to `127.0.0.1`; boundary checks mock fetch and make no network requests.

## Reproduce

```sh
git clone https://github.com/B1ackB/mastra-fetch-retry-repro.git
cd mastra-fetch-retry-repro
git clone --depth 1 --filter=blob:none --sparse https://github.com/mastra-ai/mastra.git upstream
git -C upstream fetch --depth 1 origin 0ee20403eceef39a8a142dca009c97877a9903bd
git -C upstream sparse-checkout set packages/core/src/utils
git -C upstream checkout --detach 0ee20403eceef39a8a142dca009c97877a9903bd
node repro.mjs
```

`repro.mjs` directly imports `upstream/packages/core/src/utils/fetchWithRetry.ts`. Node's native loader strips TypeScript types; the script does not extract or transform the upstream function. The pinned helper's Git blob is `2af393c8b29c502257af328b5c6b82dbaab6b161`.

The first local request returns 503 with an unfinished body; the second returns 200. The successful response is read by the caller. On the pinned upstream version, output is:

```text
{"requests":2,"openErrorResponses":1,"failedBodyUsed":false}
{"afterExplicitCancellation":0}
AssertionError: a discarded 503 response remained open after the retry succeeded
1 !== 0
```

**Exit code 1 is expected on the affected version.** It is the regression assertion exposing the bug. The explicit-cancel positive control releases the discarded error response. A `finally` block restores fetch and closes the local server/connections.

## Ownership and attempt-cap checks

```sh
node --test boundaries.test.mjs
```

On the pinned source, two expected regression assertions fail and the successful-response control passes:

| Case | Fetch attempts | Result | Discarded bodies cancelled |
| --- | ---: | --- | ---: |
| 503 then 503, `maxRetries=2` | 2 | Throws Error, no Response returned | 0 of 2 |
| 503, retry predicate false, `maxRetries=2` | 1 | Throws Error, no Response returned | 0 of 1 |
| 200 | 1 | Returns same unread Response; caller reads `ok` | Not applicable |

The attempt limit and predicate behave as configured. The defect concerns bodies the helper **discards**, not successful responses whose consumption belongs to the caller. Every test-created body is explicitly cancelled in cleanup if needed.

## Scope and environment

Executed on macOS 26.6.2, arm64, Node 24.14.0 / bundled Undici 7.21.0. The main reproduction was also executed on Node 25.8.1 / Undici 7.22.0. Upstream source package version: `@mastra/core` 1.79.0-alpha.3.

This tests the actual source helper, not an npm release or full Agent integration. Instrumentation retains failed responses for observation and the positive control; it does not measure garbage-collection duration. No production incident, permanent leak, or connection-pool exhaustion is claimed. No upstream fix is included.

The upstream helper is also called by prompt asset downloads: [downloadFromUrl](https://github.com/mastra-ai/mastra/blob/0ee20403eceef39a8a142dca009c97877a9903bd/packages/core/src/agent/message-list/prompt/download-assets.ts#L30-L58). [Undici documents why response bodies should be consumed or cancelled](https://github.com/nodejs/undici#garbage-collection).

## Provenance

Prepared with AI assistance and executed locally. The ignored `upstream/` checkout is not uploaded. Mastra source is maintained by its upstream authors under its [license mapping](https://github.com/mastra-ai/mastra/blob/0ee20403eceef39a8a142dca009c97877a9903bd/LICENSE.md); this repository imports the Apache-2.0 core helper from that checkout and does not redistribute its implementation.
