import {readFileSync} from 'node:fs';
import * as schemas from '../packages/typescript/dist/generated/zod.gen.js';
const spec=JSON.parse(readFileSync(new URL('../schema/generated.json',import.meta.url)));
let checked=0;let failed=0;
for(const [path,item] of Object.entries(spec.paths))for(const op of Object.values(item)){
 const name='z'+op.operationId.replace(/_([A-Za-z])/g,(_,x)=>x.toUpperCase())+'Response';
 const schema=schemas[name];if(!schema)throw new Error(`Missing ${name}`);
 for(const [code,response] of Object.entries(op.responses)){
  if(code!=='200')continue;const content=response.content?.['application/json']??response.content?.['application/geo+json'];if(!content)continue;
  const examples=content.example?[content.example]:Object.values(content.examples??{}).map(x=>x.value).filter(x=>x!==undefined);
  for(const example of examples){checked++;const result=schema.safeParse(example);if(!result.success){failed++;console.error(path,JSON.stringify(result.error.issues.slice(0,3)));}}
 }
}
console.log(`Validated ${checked} upstream response examples; ${failed} failures`);if(failed)process.exitCode=1;
