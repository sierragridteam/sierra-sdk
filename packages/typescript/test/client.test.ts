import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSierraClient,paginate,SierraApiError} from '../dist/index.js';
import {createFixtureFetch,FIXTURE_NOW,fixtureNodes} from '../dist/fixtures.js';
import * as schemas from '../dist/generated/zod.gen.js';
import {fixtureData} from '../dist/fixtures-data.js';

test('all synthetic payloads validate against generated schemas',async()=>{
 const api=createSierraClient({fetch:createFixtureFetch()});
 for(const request of await Promise.all([api.listEvents(),api.listPlaces(),api.listSources(),api.getConditions(),api.listCameras(),api.listScanners(),api.listMeshLinks(),api.getPlaceSummary('ebbetts-pass'),api.getMapLayer('ebbetts-pass','mesh_node'),api.getMapLayer('ebbetts-pass','mesh_link'),api.listHistory({from:'2026-11-07T00:00:00Z',to:FIXTURE_NOW})])) assert.equal(request.status,200);
 for(const node of fixtureNodes){assert.equal((await api.getMeshTelemetry({node:node.publicKey})).status,200);await api.getEvent(node.id);await api.getEventHistory(node.id);}
});
test('null, zero, gap, reboot and no coverage remain distinct',async()=>{
 const api=createSierraClient({fetch:createFixtureFetch()});const series=await Promise.all(fixtureNodes.map(n=>api.getMeshTelemetry({node:n.publicKey})));
 assert.equal(series[2].data.samples[0].reading.batteryPercent,null);assert.equal(series[3].data.samples[0].reading.batteryPercent,0);assert.equal(series[1].data.samples.length,9);assert.equal(series[3].data.reboots.length,1);assert.equal(series[4].data.coverage.samples,0);assert.equal(series[5].data.truncated,true);
});
test('partial short pages preserve continuation and filtering',async()=>{
 const api=createSierraClient({fetch:createFixtureFetch({scenario:'partial'})});const all=[];
 for await(const page of paginate(token=>api.listEvents({layer:['MESH'],pageSize:50,pageToken:token})))all.push(...page.events);
 assert.equal(all.length,6);assert(all.every(x=>x.layer==='MESH'));
 const limited=[];for await(const page of paginate(token=>api.listEvents({pageToken:token}),1))limited.push(page);assert.notEqual(limited[0].nextPageToken,'');
});
test('bounded history rejects missing or inverted windows',()=>{
 const api=createSierraClient();assert.throws(()=>api.listHistory({from:FIXTURE_NOW,to:'2026-11-01T00:00:00Z'}),RangeError);
});
test('304, plain-text deploy error and invalid JSON contract are explicit',async()=>{
 const api=createSierraClient({fetch:async()=>new Response(null,{status:304,headers:{ETag:'test'}})});assert.equal((await api.listEvents()).notModified,true);
 await assert.rejects(createSierraClient({fetch:async()=>new Response('handoff',{status:503,headers:{'Retry-After':'1'}})}).listEvents(),e=>e instanceof SierraApiError&&e.retryAfter==='1');
 await assert.rejects(createSierraClient({fetch:async()=>Response.json({events:null})}).listEvents());
});
test('deadline and caller cancellation propagate',async()=>{
 const slow:typeof fetch=async(_input,init)=>new Promise((_,reject)=>{init?.signal?.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});
 await assert.rejects(createSierraClient({fetch:slow,timeoutMs:5}).listEvents(),{name:'TimeoutError'});
 const controller=new AbortController();const result=createSierraClient({fetch:slow}).listEvents({}, {signal:controller.signal});controller.abort();await assert.rejects(result,{name:'AbortError'});
});
test('stale and unavailable are not healthy empty',async()=>{
 for(const scenario of ['stale','unavailable'] as const){const api=createSierraClient({fetch:createFixtureFetch({scenario})});const map=await api.getMapLayer('ebbetts-pass','mesh_node');assert.equal(map.data.metadata.sourceStatus,scenario.toUpperCase());}
 const empty=await createSierraClient({fetch:createFixtureFetch({scenario:'empty'})}).listEvents();assert.deepEqual(empty.data.events,[]);
});
