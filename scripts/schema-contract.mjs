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
