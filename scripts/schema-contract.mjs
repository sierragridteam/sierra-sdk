import {createHash} from 'node:crypto';

export function verifySource(bytes, manifest) {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== manifest.sha256) throw new Error(`OpenAPI provenance mismatch: source.json declares ${manifest.sha256}, actual SHA256 ${actual}`);
}

export function preserveWireTypes(schema) {
  if (!schema || typeof schema !== 'object') return;
  // Proto default strings may be empty even when annotated URI.
  if (schema.format === 'uri') delete schema.format;
  if (['int64', 'uint64'].includes(schema.format)) {
    if (schema.type === 'string' && schema.pattern === undefined) {
      schema.pattern = schema.format === 'uint64' ? '^[0-9]+$' : '^-?[0-9]+$';
    }
    delete schema.format;
  }
  for (const value of Object.values(schema)) preserveWireTypes(value);
}

// ---------------------------------------------------------------------------
// Tolerant response enums.
//
// The API adds enum values (a new event layer, source id, timeline kind...)
// without a breaking change, so a response enum must not be a closed set in
// this SDK: an unknown string has to validate and reach the caller unchanged.
//
// This is done on the generation-only overlay of the specification, not by
// rewriting Hey API's output, because the specification is the stable input:
// every string enum that a retained operation can RETURN is rewritten from
//   {type: 'string', enum: [...]}
// to
//   {anyOf: [{type: 'string', enum: [...]}, {$ref: '#/components/schemas/UnknownEnumValue'}]}
// where UnknownEnumValue is a plain string schema added to the overlay. Hey API
// renders that with its ordinary union support: Zod `z.union([z.enum([...]),
// zUnknownEnumValue])` (pass-through, no sentinel, a number still fails) and
// TypeScript `'A' | 'B' | UnknownEnumValue`. The only text edit of generated
// code is one line in finalize-generated.mjs that turns the alias
// `UnknownEnumValue = string` into `string & {}` so the known values keep
// their editor completion; that edit fails the build if Hey API ever stops
// emitting the line, rather than silently narrowing or widening anything.
//
// "Response" means reachable from a response body of a retained operation,
// through $refs. Both named enum schemas (v1Layer) and closed lists written on
// a plain string property (provenance.sourceId, severities, sourceStatus) are
// treated alike: the distinction is an accident of how the API is declared.
//
// What stays strict, deliberately:
//  - request parameters (query and path): the caller chooses those values, so
//    the types must reject a misspelling. Parameters are never walked, and a
//    component schema a parameter refers to is copied inline first so relaxing
//    the response side cannot loosen it;
//  - STRICT_RESPONSE_ENUMS below: GeoJSON structural tags fixed by RFC 7946,
//    where a different value means a different shape, not a new value;
//  - non-string enums (the integer schemaVersion/schema_version constants): a
//    new version is a new contract and must fail loudly;
//  - schemas no retained response reaches (ingest payloads, JSON-RPC).
//
// One more deliberate effect: a relaxed enum loses its protobuf zero-value
// `default`, so a missing enum field is reported as missing instead of being
// invented as `*_UNSPECIFIED` (see the comment where it is deleted).
// ---------------------------------------------------------------------------
export const UNKNOWN_ENUM_VALUE = 'UnknownEnumValue';
/** `Component.property[.property]` (array items add no segment). */
export const STRICT_RESPONSE_ENUMS = new Set(['MapFeature.type', 'MapFeatureCollection.type', 'MapGeometry.type']);

const SCHEMA_REF = '#/components/schemas/';
const clone = value => JSON.parse(JSON.stringify(value));
const isStringEnum = schema => Array.isArray(schema.enum) && (schema.type === 'string' || schema.type === undefined) && schema.enum.every(x => typeof x === 'string');

/** Visits the direct subschemas of a schema (schema keywords only, never examples or defaults). */
function subschemas(schema, label, visit) {
  for (const [name, child] of Object.entries(schema.properties ?? {})) visit(child, label ? `${label}.${name}` : name);
  if (schema.items && typeof schema.items === 'object') visit(schema.items, label);
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') visit(schema.additionalProperties, label);
  for (const key of ['allOf', 'anyOf', 'oneOf']) for (const child of schema[key] ?? []) visit(child, label);
  if (schema.not && typeof schema.not === 'object') visit(schema.not, label);
}

/** Replaces refs to component schemas with copies, so the copy's owner keeps its own (strict) enums. */
function inlineSchemaRefs(schema, schemas, seen = []) {
  if (!schema || typeof schema !== 'object') return schema;
  if (typeof schema.$ref === 'string' && schema.$ref.startsWith(SCHEMA_REF)) {
    const name = schema.$ref.slice(SCHEMA_REF.length);
    if (seen.includes(name)) throw new Error(`Request parameter refers to recursive schema ${name}`);
    if (!schemas[name]) throw new Error(`Unknown schema ${name}`);
    return inlineSchemaRefs(clone(schemas[name]), schemas, [...seen, name]);
  }
  for (const key of ['items', 'additionalProperties', 'not']) if (schema[key] && typeof schema[key] === 'object') schema[key] = inlineSchemaRefs(schema[key], schemas, seen);
  for (const key of ['allOf', 'anyOf', 'oneOf']) if (schema[key]) schema[key] = schema[key].map(x => inlineSchemaRefs(x, schemas, seen));
  for (const [name, child] of Object.entries(schema.properties ?? {})) schema.properties[name] = inlineSchemaRefs(child, schemas, seen);
  return schema;
}

/**
 * Rewrites every string enum reachable from a response body so unknown values
 * validate and pass through. Returns the labels it relaxed (for tests/logs).
 */
export function tolerateResponseEnums(doc, strict = STRICT_RESPONSE_ENUMS) {
  const components = doc.components ??= {};
  const schemas = components.schemas ??= {};
  if (schemas[UNKNOWN_ENUM_VALUE]) throw new Error(`The specification already defines ${UNKNOWN_ENUM_VALUE}`);
  const operations = Object.values(doc.paths ?? {}).flatMap(item => Object.entries(item).filter(([key]) => ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'].includes(key)).map(([, op]) => ({item, op})));

  // 1. Requests keep their own closed enums.
  const parameters = [...Object.values(components.parameters ?? {}), ...operations.flatMap(({item, op}) => [...(item.parameters ?? []), ...(op.parameters ?? [])])];
  for (const parameter of parameters) {
    if (parameter.schema) parameter.schema = inlineSchemaRefs(parameter.schema, schemas);
    for (const media of Object.values(parameter.content ?? {})) if (media.schema) media.schema = inlineSchemaRefs(media.schema, schemas);
  }
  const bodies = [...Object.values(components.requestBodies ?? {}), ...operations.map(({op}) => op.requestBody).filter(Boolean)];
  for (const body of bodies) for (const media of Object.values(body.content ?? {})) if (media.schema) media.schema = inlineSchemaRefs(media.schema, schemas);

  // 2. Everything a response body reaches becomes tolerant.
  const relaxed = [];
  const queue = [];
  const queued = new Set();
  const visit = (schema, label) => {
    if (!schema || typeof schema !== 'object') return;
    if (typeof schema.$ref === 'string') {
      if (!schema.$ref.startsWith(SCHEMA_REF)) throw new Error(`Unsupported schema reference ${schema.$ref}`);
      const name = schema.$ref.slice(SCHEMA_REF.length);
      if (name !== UNKNOWN_ENUM_VALUE && !queued.has(name)) { queued.add(name); queue.push(name); }
      return;
    }
    if (isStringEnum(schema)) {
      if (strict.has(label)) return;
      const known = {type: 'string', enum: schema.enum};
      // The protobuf zero-value `default` (LAYER_UNSPECIFIED, ...) is dropped on
      // purpose: the API always writes its enum fields, so a response that lacks
      // one is missing data. It must fail validation (or be `undefined` where the
      // field is optional), not be filled with a value the server never sent.
      delete schema.type; delete schema.enum; delete schema.default;
      schema.anyOf = [known, {$ref: SCHEMA_REF + UNKNOWN_ENUM_VALUE}];
      relaxed.push(label);
      return;
    }
    subschemas(schema, label, visit);
  };
  for (const {op} of operations) for (const [code, declared] of Object.entries(op.responses ?? {})) {
    let response = declared;
    if (typeof response.$ref === 'string') {
      response = components.responses?.[response.$ref.replace('#/components/responses/', '')];
      if (!response) throw new Error(`Unknown response ${declared.$ref}`);
    }
    for (const media of Object.values(response.content ?? {})) visit(media.schema, `${op.operationId ?? 'operation'}.${code}`);
  }
  while (queue.length) { const name = queue.shift(); if (!schemas[name]) throw new Error(`Unknown schema ${name}`); visit(schemas[name], name); }
  schemas[UNKNOWN_ENUM_VALUE] = {
    type: 'string',
    description: 'An enum value this SDK version does not know. The API adds values without a\nbreaking change, so every enum field of a response also accepts any other\nstring, delivered unchanged. Handle it explicitly (a `default` branch); never\ntreat it as one of the known values.',
  };
  return relaxed;
}

// ---------------------------------------------------------------------------
// Fields added since the previous release.
//
// The API declares every response field `required`, including one it started
// sending last week. Generated as required, such a field makes this SDK reject
// every response of a server that is one deployment behind (and the API cannot
// be deployed before the SDK that reads it without the reverse problem). So a
// response property that is NEW AND REQUIRED in this snapshot, compared with the
// snapshot of the previous SDK release, is listed here and generated as
// optional: absent parses, and reads as `undefined`, never as a made-up value.
//
// Keep the list short and current: when no supported server lacks a field any
// more (in practice, at the release after the API that sends it reached
// production), delete its entry so it becomes required again. An entry that no
// longer names a required property fails generation, so the list cannot rot.
// When the snapshot changes, compare `required` lists with the previous
// release's schema/openapi.json and add what is new.
//
// Not listed although new and required in this snapshot: v1MeshTelemetry.readVia
// and v1MeshAdminTelemetry.via. Production already sent both when this list was
// written (2026-11-17), so no supported server lacks them.
// ---------------------------------------------------------------------------
/** `Component.property`; previous release: 0.5.0, sierra-data 1141f24. */
export const FIELDS_ADDED_SINCE_PREVIOUS_RELEASE = [
  'v1Event.subhead',
];

export function relaxAddedFields(doc, fields = FIELDS_ADDED_SINCE_PREVIOUS_RELEASE) {
  for (const field of fields) {
    const [component, property, ...rest] = field.split('.');
    const schema = doc.components?.schemas?.[component];
    if (rest.length || !schema?.properties?.[property] || !schema.required?.includes(property)) {
      throw new Error(`relaxAddedFields: ${field} is not a required property of a component schema; remove or correct the entry`);
    }
    schema.required = schema.required.filter(x => x !== property);
    if (!schema.required.length) delete schema.required;
  }
}
