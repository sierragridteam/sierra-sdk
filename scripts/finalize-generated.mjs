import { readdirSync,readFileSync,writeFileSync,existsSync } from 'node:fs';
import {dirname,resolve} from 'node:path';
const root=new URL('../packages/typescript/src/generated/',import.meta.url);
for(const file of readdirSync(root,{recursive:true}).filter(x=>x.endsWith('.ts'))){
 const url=new URL(file,root);const text=readFileSync(url,'utf8');
 writeFileSync(url,text.replace(/(from\s+|import\s*)['"](\.[^'"]+)['"]/g,(all,start,path)=>{
  if(/\.[cm]?[jt]s$/.test(path))return all;
  const target=resolve(dirname(url.pathname),path);
  return `${start}'${path}${existsSync(target+'.ts')?'.js':'/index.js'}'`;
 }));
}
// Tolerant response enums (see schema-contract.mjs): the overlay adds the string
// schema UnknownEnumValue as the open branch of every response enum. Widening it
// to `string & {}` keeps `'A' | 'B' | UnknownEnumValue` from collapsing to
// `string`, so known values keep their completion. This is the only edit of
// generated code for enums, and it refuses to continue if Hey API's output for
// that one alias (or its Zod schema) is not what it expects.
const read=name=>readFileSync(new URL(name,root),'utf8');
const alias=/^export type UnknownEnumValue = string;$/gm;
const types=read('types.gen.ts');
if((types.match(alias)??[]).length!==1)throw new Error('finalize-generated: expected exactly one `export type UnknownEnumValue = string;` in types.gen.ts');
writeFileSync(new URL('types.gen.ts',root),types.replace(alias,'export type UnknownEnumValue = string & {};'));
if(!/^export const zUnknownEnumValue = z\.string\(\);$/m.test(read('zod.gen.ts')))throw new Error('finalize-generated: expected `export const zUnknownEnumValue = z.string();` in zod.gen.ts');
