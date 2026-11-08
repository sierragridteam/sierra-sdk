import {readFileSync,writeFileSync} from 'node:fs';
import {preserveWireTypes,verifySource} from './schema-contract.mjs';
const source = readFileSync(new URL('../schema/openapi.json',import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../schema/source.json',import.meta.url)));
verifySource(source, manifest);
const doc = JSON.parse(source);
// Explorer SDK intentionally excludes writes, MCP and specification self-fetch.
for(const [path,item] of Object.entries(doc.paths)) {
  for(const method of Object.keys(item)) if(method !== 'get') delete item[method];
  if(path === '/api/openapi.json' || !Object.keys(item).length) delete doc.paths[path];
}
preserveWireTypes(doc);
writeFileSync(new URL('../schema/generated.json',import.meta.url),JSON.stringify(doc,null,2)+'\n');
