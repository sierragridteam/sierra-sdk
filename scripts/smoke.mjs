import {createSierraClient} from '../packages/typescript/dist/index.js';
const api=createSierraClient({timeoutMs:30000});
for(const [name,load] of [['places',()=>api.listPlaces({kind:'AREA'})],['mesh events',()=>api.listEvents({layer:['MESH'],pageSize:1})],['mesh links',()=>api.listMeshLinks({window:'24h'})]]){
 const result=await load();console.log(`${name}: HTTP ${result.status}, generated schema validation passed`);
}
