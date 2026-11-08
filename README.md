# SIERRA SDK

Public, read-only clients for the [SIERRA Grid API](https://data.sierragridteam.org/api/openapi.json). TypeScript is available first; Python and Go will share the same versioned OpenAPI and fixture contracts in this repository. All rights reserved; public source visibility is not a license grant.

```ts
import {createSierraClient, paginate} from '@sierragridteam/sdk';
const grid = createSierraClient();
const nodes = await grid.listEvents({layer:['MESH'], pageSize:50});
if (!nodes.notModified) console.log(nodes.data.events);
const topology = await grid.listMeshLinks({window:'72h'});
const archive = await grid.getMeshTelemetry({node:'1'.repeat(64),
  from:'2026-11-06T00:00:00Z', to:'2026-11-07T00:00:00Z'});
for await (const page of paginate(pageToken => grid.listHistory({
  from:'2026-11-06T00:00:00Z',to:'2026-11-07T00:00:00Z',pageToken
}))) console.log(page.revisions, page.nextPageToken);
```

Install with `pnpm add @sierragridteam/sdk`. ESM; modern browsers and Node 22+. Consumers choose their own rendering and chart libraries. No framework hooks or shared UI are included.

The facade includes `listEvents`, `getEvent(id)`, `getEventHistory(id, query)`, `listHistory(query)`, `listPlaces`, `getPlace(place)`, `resolvePlace(query)`, `getPlaceSummary(place)`, `getConditions`, `listCameras`, `listScanners`, `listSources`, `getMapLayer(place, layer, query)`, `listMeshLinks`, and `getMeshTelemetry(query)`. Query fields and response fields follow the API. Every response is Zod-validated. `@sierragridteam/sdk/generated` exposes the lower-level generated fetch SDK; `/schemas` exposes generated Zod schemas.

`createSierraClient({baseUrl, fetch, timeoutMs})` supports injected transports. The last argument of each method accepts `{signal, etag, timeoutMs}`. Default deadline is 20 seconds, covering body consumption. No requests retry automatically. `ApiResult` discriminates 304 (`notModified: true`, no data) from a validated body. `SierraApiError` preserves HTTP status, codeName, retryAfter and error body, including plain-text deployment failures. Schema validation errors remain Zod errors. Raw generated functions have their own Hey API result/error conventions; use the facade for consistent 304/deadline handling.

Geometry defaults to OBJECT; decimal int64 counters remain strings and nullable gauges remain null. Convert counters deliberately for charts. Event revisions use their declared numeric wire type. Event detail blocks are optional; narrow on layer and check the matching block. Missing, stale and unavailable data must not be presented as zero or an all-clear. Keep provenance/official-source links visible.

History requires explicit `from < to`. Pagination ends only at an empty continuation token. `paginate` yields at most 100 pages by default; if the final yielded page has a nonempty token, results are incomplete. It does not download unlimited archives. A short page is not the end. Telemetry is separately capped by the server: retain `coverage`, `truncated`, `cadenceSeconds` and `reboots` in analysis. History describes revisions, not continuously refreshed radio liveness; current liveness is lastRelayedAt/lastHeardAt.

## Shared synthetic fixtures

```ts
import {createSierraClient} from '@sierragridteam/sdk';
import {createFixtureFetch, FIXTURE_NOW, FIXTURE_LABEL, fixtureNodes} from '@sierragridteam/sdk/fixtures';
const grid = createSierraClient({fetch:createFixtureFetch({scenario:'partial'})});
// Display FIXTURE_LABEL prominently. Use FIXTURE_NOW as the demo chart clock.
```

Scenarios: `normal`, `empty`, `stale`, `partial`, `unavailable`. Six synthetic nodes include zero/null batteries, a sampling gap, reboot counter reset, unmonitored node and truncated archive. Links include an outside endpoint. A synthetic road incident, places and source states support context. These are invented fixtures, never a saved production response. `/fixtures` is a separate import so ordinary clients do not bundle demo data.

Fixture event filters support place/layer/status/severityMin/since, pageSize and pageToken. History applies explicit time bounds and event filters; telemetry applies bounds and preserves overall coverage. Fixtures use indexed continuation tokens (not the server's opaque keyset implementation); do not reuse a token with changed filters. Partial scenarios deliberately produce short pages and telemetry truncation. Only OBJECT geometry is supported. Fixture topology durations support h/m/s units. Address resolution, other unimplemented endpoints and unsupported parameters return explicit errors. Fixtures are not a general replacement server; conditions/camera/scanner datasets are intentionally empty. They perform no network requests.

## Maintenance and provenance

- `schema/openapi.json` is the immutable upstream snapshot; `schema/source.json` records source commit and SHA256.
- `scripts/prepare-schema.mjs` creates the generation-only overlay: public data GETs only; URI annotations become strings because protobuf defaults allow empty strings; int64/uint64 formats retain declared JSON type rather than Hey API's default BigInt coercion (decimal strings gain a pattern). No upstream file is rewritten.
- Hey API `0.99.0` and Zod `4.6.7` are pinned. Generated imports are normalized to explicit ESM extensions. `fixtures/scenarios.json` is the language-neutral synthetic data source.
- `pnpm install --frozen-lockfile`, `pnpm verify`, `pnpm drift`; optional `pnpm smoke` performs three small public GETs. CI never needs API credentials.
- Update the spec and source manifest together, regenerate, run the example/fixture/transport checks and review drift before releasing. Upstream schema fixes belong in sierra-data; generation accommodations are documented here.
- Future Python and Go packages belong under `packages/python` and `packages/go`, each with its own release workflow. They must preserve these same wire/nullability, pagination and coverage semantics. No placeholder package claims those implementations exist.

Build/package only includes `dist` plus package metadata/readme. No credentials, live captures, servers, or internal workspace files belong in this repository or the npm tarball. Releases require review. `.github/workflows/publish-typescript.yml` publishes only an explicit `typescript-vX.Y.Z` tag (or manual dispatch selecting that existing tag), validates package/tag equality, and uses npm trusted publishing with provenance. Configure the `npm` GitHub environment and npm trusted publisher for this exact workflow before a release. Python/Go will use separate tag namespaces and workflows. No long-lived npm credential is stored.
