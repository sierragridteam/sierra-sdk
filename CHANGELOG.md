# Changelog

`@sierragridteam/sdk` (TypeScript). Newest first.

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
