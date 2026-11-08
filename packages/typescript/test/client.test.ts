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

test('unavailable data paths fail while diagnostics remain readable',async()=>{
 const api=createSierraClient({fetch:createFixtureFetch({scenario:'unavailable'})});
 for(const load of [()=>api.listEvents(),()=>api.getEvent(fixtureNodes[0].id),()=>api.getEventHistory(fixtureNodes[0].id),()=>api.listHistory({from:'2026-11-07T00:00:00Z',to:FIXTURE_NOW}),()=>api.getMeshTelemetry({node:fixtureNodes[0].publicKey})]){
  await assert.rejects(load(),e=>e instanceof SierraApiError&&e.status===503&&e.codeName==='UNAVAILABLE'&&e.retryAfter==='1');
 }
 await assert.rejects(api.listMeshLinks(),e=>e instanceof SierraApiError&&e.status===503&&e.body==='Synthetic deployment handoff');
 const sources=await api.listSources();assert.equal(sources.data.sources[0].status,'UNAVAILABLE');assert.equal(sources.data.sources[0].lastSuccessAt,null);
 const map=await api.getMapLayer('ebbetts-pass','mesh_node');assert.equal(map.data.metadata.sourceStatus,'UNAVAILABLE');assert.deepEqual(map.data.features,[]);
 assert.equal((await api.getPlaceSummary('ebbetts-pass')).data.summary.activeEvacuations,null);
});
test('partial archive failure does not erase successful nodes',async()=>{
 const api=createSierraClient({fetch:createFixtureFetch({scenario:'partial'})});
 const results=await Promise.allSettled(fixtureNodes.map(node=>api.getMeshTelemetry({node:node.publicKey})));
 assert.equal(results[2].status,'rejected');assert.equal(results.filter(x=>x.status==='rejected').length,1);
 if(results[2].status==='rejected')assert.equal(results[2].reason.codeName,'UNAVAILABLE');
 assert.equal(results[0].status,'fulfilled');if(results[0].status==='fulfilled'){assert.equal(results[0].value.data.samples.length,12);assert.equal(results[0].value.data.truncated,true);}
 assert.equal((await api.listMeshLinks()).data.links.length,4);
});
test('stale diagnostics carry old timestamps and unknown layers fail',async()=>{
 const api=createSierraClient({fetch:createFixtureFetch({scenario:'stale'})});
 const source=(await api.listSources()).data.sources[0];assert.equal(source.status,'STALE');assert.equal(Date.parse(FIXTURE_NOW)-Date.parse(source.lastSuccessAt),2*86400000);
 const summary=(await api.getPlaceSummary('ebbetts-pass')).data;assert.equal(summary.sources[0].lastSuccessAt,source.lastSuccessAt);
 const map=(await api.getMapLayer('ebbetts-pass','mesh_node')).data;assert.equal(map.metadata.lastSourceUpdate,source.lastSuccessAt);
 const fetcher=createFixtureFetch();assert.equal((await fetcher('https://fixture.test/api/v1/places/ebbetts-pass/map/bogus.geojson')).status,404);
 assert.equal((await fetcher('https://fixture.test/api/v1/places/ebbetts-pass/map/wildfire.geojson')).status,404);
});
