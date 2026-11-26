# Changelog

`@sierragridteam/sdk` (TypeScript). Newest first.

## 0.13.0

API snapshot: sierra-data `59b3249` (`main`, deployed 2026-11-26).

- `roadSegment.beyond[]` on monitored-road events has `seasonal` and `severity`: a closure past a road's end (the Ebbetts Pass winter closure on `road:hwy4-arnold-bearvalley`) says it is a standing seasonal condition and rates itself `INFO`, as `road.beyond[]` on the `road_segment` map layer has since 0.9.0. Both are required: the Grid sends them on every revision, including those recorded before the fields existed. Until this release the SDK's response validation dropped them.
- `chainControl.seasonal` and `chainControl.closure` on the `chain_control` map layer: a closure point (`category: "closed"`) that is a gate of a named seasonal closure has `seasonal: true` and the closure's name, a headline that names it ("Highway 4: Ebbetts Pass winter closure") and severity `INFO` (was `MINOR`). Both are absent on every other feature, including closure points that are not a recognized gate. **Do not pick a pass gate out by `severity: "MINOR"` or by the headline "... road closed" any more; read `chainControl.seasonal`.**
- No new methods. `FIELDS_ADDED_SINCE_PREVIOUS_RELEASE` stays empty.

## 0.12.0

API snapshot: sierra-data `1ce4019` (`main`, deployed 2026-11-20).

- Weather samples. `getEventSamples` on a weather location's event (`weather:<location id>`, layer `WEATHER`, source `openweather`) returns its readings in `weather`: one `WeatherSamplePoint` per point, oldest first, with figures as OpenWeatherMap reported them (decimals, not the whole numbers `getConditions` serves), the min and max within a bucket, and `conditions` (each OpenWeatherMap condition in the point, with how many samples had it). A figure nobody reported is `null`, never 0 (no gust, no rain block). `event.weather` (`WeatherDetail`: `locationId`, `locationName`) is the detail on that event. These events and samples exist only while the Grid records weather (`grid.weather.record`); until then there are no `weather:` events.
- `weather` is required on every samples response (an empty list on a road's). Production already sends it.
- `getMeshPath({from, to, window})`: a route between two sets of mesh nodes over the observed relay links (`GET /api/v1/mesh/path`). `found: false` means no chain of observed links joins them, which is not "no path"; `path` and `alternate` are then `null`.
- `roadSegment.chains` (0.11.0) is now required: every supported Grid sends it. `FIELDS_ADDED_SINCE_PREVIOUS_RELEASE` is empty.
- The `/mcp` setup page (an HTML page, sierra-data #105) is left out of the generated SDK, as the MCP endpoint itself already was.
- Fixtures: the 404 for an event that keeps no samples now reads "(ROAD_SEGMENT and WEATHER events do)", as the API says.

## 0.11.0

API snapshot: the sierra-data commit pinned in `schema/source.json`.

- `roadSegment.chains` on monitored-road events: the chain requirements on the road as the Grid last read them, one `{level, eventId}` per chain-control stretch, highest level first. `eventId` is the stretch (`cc:hwy4:r2`): its `chain_control` map feature and its stored event. A road under chains stays `OPEN`: read `chains` beside `status`. The event's headline says it ("Hwy 4 Arnold to Bear Valley: open, chains required (R2)") and its `category` is `chains` while the road is open under a requirement, so **do not read `category: "open"` as "the road is open"; read `roadSegment.status`**. The event is revised when a requirement starts, ends or changes level, so `getEventHistory` is when the road went under chains and came out. Unlike `road.chains` on the map layer, the list is never absent for "unknown": while the chain-control read cannot say, the event keeps its last state.
- `chains` is optional in this release: against a Grid that does not send it yet it is `undefined`.
- `getEventTimeline` on a monitored road has entries with `field: "chains"` ("Chains R2", "Chains lifted"), and `listRelatedEvents` links a road and the chain-control stretches on it both ways under the rule `road-chains`. No type changes: both are strings.

## 0.10.0

API snapshot: the sierra-data commit pinned in `schema/source.json`.

- `road.chains` on the `road_segment` map layer: the chain requirements (R1, R2, R3) on a monitored road, each with `level`, `eventId` (the `chain_control` stretch and its stored event), `headline`, `from`, `to`, `since` and `inferred`. A road under a chain requirement stays `OPEN`; this is where it says so. `[]` means Caltrans reports no requirement on the road. The field is absent when that is not known (the chain-control read failed or was partial, or the road has no measured route yet): show "unknown", never "none".

## 0.9.0

API snapshot: the sierra-data commit pinned in `schema/source.json`.

- `road.beyond[].seasonal` on the `road_segment` map layer, and the entry's `severity` is now `INFO`: a named seasonal closure past a road's end (the Ebbetts Pass winter closure) is the road's yearly state. The place summary no longer lists it. A client that ranked it down or worded it specially can follow `seasonal` instead.
- `roadSegment.causes` is required again: every supported Grid sends it. No field is optional-because-new in this release.

## 0.8.0

API snapshot: the sierra-data commit pinned in `schema/source.json`.

- **Breaking: `getEventSamples` returns chart-shaped points.** The API changed this route's response on 2026-11-19 (it had shipped two days earlier). New query `maxPoints` (default 500, at most 2000). The response has `bucketSeconds` (0 for raw samples), `coverage` (`first`, `last`, `samples`), `gaps`, and `road` points of one shape: `at`, `samples`, `durationMinutes` (mean) with `durationMinutesMin`/`Max`, `delayMinutes` with `delayMinutesMax`, `status`, `congestion`. The travel-time figures are `null` while the road is closed. `getRoadHistory` is unchanged.
- `roadSegment.causes` on monitored-road events: what set a road's status (`status`, `source`, `eventId`, `text`). Optional in this release; `undefined` against a Grid that does not send it.
- `event.subhead` is required again: every supported Grid sends it.

## 0.7.0

API snapshot: the sierra-data commit pinned in `schema/source.json`.

- `event.subhead`: a short line saying what is particular to an event among events with the same headline, for example the elevation band and amounts of one of two "Winter Storm Warning" alerts. An empty string when there is nothing to add. Show it beside the headline in a list. On `weather_alert` map features it is `properties.subhead`, absent when empty.
- `subhead` is optional in this release: against a Grid that does not send it yet it is `undefined`.
- The fields that were optional in 0.6.0 because they were new (`Event.readings`, `Event.nature`, `EventRevision.kind`, `Stats.changes`, `Stats.readings`, `LayerStats.changes`, `LayerStats.readings`) are required again: every supported Grid sends them.

## 0.6.0

- `event.nature` (`OCCURRENCE` or `STATE`) on every event: what kind of thing it is, so a client needs no list of layers. Monitored-road events (`roadSegment`) carry status and seasonal closures only; congestion is in the samples.

API snapshot: the sierra-data commit pinned in `schema/source.json`.

- Revision kinds: `EventRevision.kind` (`CHANGE`, `READING`) and the `kind` query parameter of `getEventHistory` and `listHistory`; `Event.readings`; `changes` and `readings` in `getStats`, overall and per layer.
- Event layers `SOURCE_HEALTH`, `CHAIN_CONTROL`, `ROAD_SEGMENT` (and `WEATHER`) with `sourceHealth`, `chainControl` and `roadSegment` detail blocks; source kind `INTERNAL`; provenance source ids `grid`, `caltrans-cc`, `roads`; timeline kinds `TIMELINE_READ_PATH`, `TIMELINE_READING`; CAL FIRE burn status `CALFIRE_BURNING_ALLOWED`; `MeshTelemetry.readVia` and `MeshAdminTelemetry.via`.
- New facade method `getEventSamples(id, {from, to})`.
- Works against a Grid older than the snapshot: the response fields new in this release (`Event.readings`, `EventRevision.kind`, `Stats.changes`, `Stats.readings`, `LayerStats.changes`, `LayerStats.readings`) are optional and `undefined` when the server does not send them. They become required again in a later release.
- Fixtures: both history routes honour `kind`; the road incident has one synthetic `READING` revision (`FIXTURE_READING_EVENT_ID`, now `revision: 3`, `readings: 1`); an unknown `layer`, `status` or `kind` is a 400; `getEventSamples` answers the API's 404; the fixture source's `kind` is `FEED` instead of `SOURCE_KIND_UNSPECIFIED`.

## 0.5.0

Tolerant enums. Same API snapshot as 0.4.0.

- Enum fields of a response accept values this SDK does not know: an unknown string validates and is returned unchanged. Their types are the known values plus `UnknownEnumValue` (`string & {}`). Code that switches on an enum field needs a `default`.
- Request enums (query and path parameters) are unchanged and closed. A response enum value is no longer assignable to a request parameter without narrowing.
- Still strict in responses: the GeoJSON tags `MapFeature.type`, `MapFeatureCollection.type`, `MapGeometry.type`, and integer constants such as `schemaVersion`.
- A missing enum field is no longer filled with its `*_UNSPECIFIED` (or `INFO`) default: a required one fails validation, an optional one is `undefined`.
