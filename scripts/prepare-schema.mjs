import {readFileSync,writeFileSync} from 'node:fs';
const doc=JSON.parse(readFileSync(new URL('../schema/openapi.json',import.meta.url)));
// Explorer SDK intentionally excludes writes, MCP and specification self-fetch.
for(const [path,item] of Object.entries(doc.paths)) {
  for(const method of Object.keys(item)) if(method !== 'get') delete item[method];
  if(path === '/api/openapi.json' || !Object.keys(item).length) delete doc.paths[path];
}
// Proto default strings may be empty even when annotated URI. Keep string wire
// typing; URLs are presentation links, not executable authority checks.
function visit(x){if(!x||typeof x!=='object')return;if(x.format==='uri')delete x.format;if(['int64','uint64'].includes(x.format)){if(x.type==='string')x.pattern='^-?[0-9]+$';delete x.format;}for(const v of Object.values(x))visit(v);}
visit(doc);
writeFileSync(new URL('../schema/generated.json',import.meta.url),JSON.stringify(doc,null,2)+'\n');
