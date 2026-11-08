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
