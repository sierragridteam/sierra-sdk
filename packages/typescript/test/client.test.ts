import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSierraClient,paginate,SierraApiError} from '../dist/index.js';
import {createFixtureFetch,FIXTURE_NOW,FIXTURE_READING_EVENT_ID,fixtureNodes} from '../dist/fixtures.js';
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

test('fixture Point centroids and bounds agree with their actual coordinates',()=>{
 for(const event of fixtureData.events){
  const g=event.geometry;if(g?.object?.type!=='Point')continue;
  const [lng,lat]=g.object.coordinates;
  assert.deepEqual(g.centroid,{lat,lng});
  assert.deepEqual(g.bbox,{minLat:lat,maxLat:lat,minLng:lng,maxLng:lng});
 }
 const outside=fixtureData.events.find(x=>x.headline==='Outside Relay')!;
 const area=fixtureData.places.find(x=>x.slug==='ebbetts-pass')!;
 const [lng,lat]=outside.geometry.object.coordinates;
 const b=area.geometry.bbox;
 assert(lng<b.minLng||lng>b.maxLng||lat<b.minLat||lat>b.maxLat);
 assert.deepEqual(outside.placeIds,[]);
});
test('a chain-control stretch keeps its ends and nested signs',()=>{
 const sign=(id:string,place:string,direction:string,coordinates:[number,number])=>({id,place,direction,level:'R2',since:'2026-11-13T14:00:00-08:00',coordinates,source:'cwwp2.dot.ca.gov'});
 const parsed=schemas.zMapChainControlProps.parse({level:'R2',highway:'Highway 4',
  from:{place:'Lower Checkpoint',coordinates:[-120.2,38.4]},to:{place:'Upper Checkpoint',coordinates:[-120.0,38.5]},
  signs:[sign('cc:10-CAL-4-1-E-01E','LOWER CHECKPOINT','Eastbound',[-120.2,38.4]),sign('cc:10-CAL-4-9-W-02W','UPPER CHECKPOINT','Westbound',[-120.0,38.5])]});
 assert.equal(parsed.from?.place,'Lower Checkpoint');assert.equal(parsed.to?.place,'Upper Checkpoint');assert.equal(parsed.signs?.length,2);assert.equal(parsed.signs?.[1].direction,'Westbound');assert.equal(parsed.inferred,undefined);
 // A closure or a truck level is still one point with none of the stretch fields.
 assert.deepEqual(schemas.zMapChainControlProps.parse({highway:'Highway 4',direction:'Eastbound'}),{highway:'Highway 4',direction:'Eastbound'});
});

test('text search adds a total, counts, snippets and coverage; plain lists carry none',async()=>{
 const api=createSierraClient({fetch:createFixtureFetch()});
 const plain=await api.listEvents();
 assert.equal(plain.data.totalMatches,null);assert.deepEqual(plain.data.counts,[]);assert.deepEqual(plain.data.matches,{});assert.equal(plain.data.search,null);
 const node=fixtureNodes[0];const word=node.name.split(/\s+/)[0];
 const found=await api.listEvents({q:word,layer:['MESH']});
 assert(found.data.events.some(x=>x.id===node.id));
 assert.equal(found.data.totalMatches,found.data.events.length);
 assert.equal(found.data.counts.reduce((n,c)=>n+c.events,0),found.data.totalMatches);
 assert.equal(found.data.search?.query,word.toLowerCase());assert(found.data.search?.note);
 const match=found.data.matches[node.id];assert.equal(match.field,'title');
 assert.equal(match.parts.map(p=>p.text).join(''),node.name,'parts concatenate to the title as written');
 assert(match.parts.some(p=>p.hit&&p.text.toLowerCase()===word.toLowerCase()));
 // Whole words unless the box says it is still being typed.
 const half=word.slice(0,Math.max(2,word.length-1));
 assert.equal((await api.listEvents({q:half,layer:['MESH']})).data.events.some(x=>x.id===node.id),half===word);
 assert((await api.listEvents({q:half,qTyping:true,layer:['MESH']})).data.events.some(x=>x.id===node.id));
 // A total without a text query.
 const counted=await api.listEvents({counts:true,layer:['MESH'],pageSize:1});
 assert.equal(counted.data.events.length,1);assert.equal(counted.data.totalMatches,6);assert.equal(counted.data.search,null);
 // Nothing matched is a zero, stated, with the note; not an absence.
 const none=await api.listEvents({q:'zzzznothing'});
 assert.equal(none.data.totalMatches,0);assert.deepEqual(none.data.events,[]);assert(none.data.search?.note);
});
test('history search answers per revision or collapsed per event',async()=>{
 const api=createSierraClient({fetch:createFixtureFetch()});const window={from:'2026-11-07T00:00:00Z',to:FIXTURE_NOW};
 const plain=await api.listHistory(window);
 assert.equal(plain.data.totalMatches,null);assert.deepEqual(plain.data.collapsed,[]);assert(plain.data.revisions.every(r=>r.match===null));
 const node=fixtureNodes[0];const word=node.name.split(/\s+/)[0];
 const revs=await api.listHistory({...window,q:word,layer:['MESH']});
 assert(revs.data.revisions.length>0);assert(revs.data.revisions.every(r=>r.match!==null));assert.equal(revs.data.totalMatches,revs.data.revisions.length);
 const collapsed=await api.listHistory({...window,q:word,layer:['MESH'],collapse:'event'});
 assert.deepEqual(collapsed.data.revisions,[]);
 const row=collapsed.data.collapsed.find(x=>x.eventId===node.id);assert(row);
 assert.equal(row.first.revision,1);assert.equal(row.lastRevision,2);assert.equal(row.matchingRevisions,2);assert(row.first.match);
 assert.equal(collapsed.data.totalMatches,collapsed.data.collapsed.length);
 await assert.rejects(api.listHistory({...window,collapse:'event'}),e=>e instanceof SierraApiError&&e.status===400);
});
test('the finder returns typed hits per kind, totals, and what it could not search',async()=>{
 const api=createSierraClient({fetch:createFixtureFetch()});
 const node=fixtureNodes[0];const word=node.name.split(/\s+/)[0];
 const res=await api.search({q:word});
 const hit=res.data.hits.find(x=>x.kind==='MESH_NODE'&&x.id===node.id);assert(hit);
 assert.equal(hit.apiPath,`/api/v1/events/${node.id}`);assert.equal(hit.event?.layer,'MESH');assert(hit.event?.observedAt);
 assert.deepEqual(res.data.totals.map(x=>x.kind),['PLACE','ROAD','EVENT','MESH_NODE','CAMERA','SCANNER']);
 assert.deepEqual(res.data.unavailable,[]);assert(res.data.search.note);
 const place=await api.search({q:'ebbetts',kind:['PLACE']});
 assert.equal(place.data.hits[0].kind,'PLACE');assert.equal(place.data.hits[0].apiPath,'/api/v1/places/ebbetts-pass/summary');assert.equal(place.data.hits[0].event,null,'only event hits carry event facts');
 assert.deepEqual(place.data.totals.map(x=>x.kind),['PLACE']);
 // A kind that could not be searched is named, and has no total: unknown, not none.
 const down=await createSierraClient({fetch:createFixtureFetch({scenario:'unavailable'})}).search({q:word});
 assert.deepEqual(down.data.unavailable,['CAMERA']);assert(!down.data.totals.some(x=>x.kind==='CAMERA'));
 await assert.rejects(api.search({q:'  '}),e=>e instanceof SierraApiError&&e.status===400);
});

const ROAD='chp:fixture-road';
/** A fixture-backed client that records the URLs it requested and may edit the JSON on the way back. */
const recording=(edit:(body:any)=>void=()=>{})=>{
 const urls:URL[]=[];
 const api=createSierraClient({fetch:async(input,init)=>{
  urls.push(new URL(String(input)));const response=await createFixtureFetch()(input,init);
  if(!response.ok)return response;
  const body=await response.json();edit(body);return Response.json(body);
 }});
 return {api,urls};
};
const badRequest=(pattern:RegExp)=>(e:unknown)=>e instanceof SierraApiError&&e.status===400&&e.codeName==='INVALID_ARGUMENT'&&pattern.test(e.message);
test('kind serialises as repeated parameters on both history routes',async()=>{
 const {api,urls}=recording();
 await api.getEventHistory(ROAD,{kind:['CHANGE','READING']});
 assert.equal(urls[0].pathname,`/api/v1/events/${encodeURIComponent(ROAD)}/history`);
 assert.deepEqual(urls[0].searchParams.getAll('kind'),['CHANGE','READING']);
 assert.match(urls[0].search,/kind=CHANGE&kind=READING/);
 await api.listHistory({from:'2026-11-07T00:00:00Z',to:FIXTURE_NOW,kind:['READING']});
 assert.deepEqual(urls[1].searchParams.getAll('kind'),['READING']);
 await api.getEventHistory(ROAD);assert.equal(urls[2].searchParams.has('kind'),false,'no kind unless asked');
});
test('fixture history returns changes unless readings are asked for',async()=>{
 const api=createSierraClient({fetch:createFixtureFetch()});const window={from:'2026-11-07T00:00:00Z',to:FIXTURE_NOW};
 const shape=(revisions:{revision:number,kind?:string}[])=>revisions.map(r=>`${r.revision}:${r.kind}`);
 assert.equal(FIXTURE_READING_EVENT_ID,ROAD);
 // One event: default and CHANGE are the two changes, READING the one reading, both all three, newest first.
 assert.deepEqual(shape((await api.getEventHistory(ROAD)).data.revisions),['2:CHANGE','1:CHANGE']);
 assert.deepEqual(shape((await api.getEventHistory(ROAD,{kind:['CHANGE']})).data.revisions),['2:CHANGE','1:CHANGE']);
 const readings=(await api.getEventHistory(ROAD,{kind:['READING']})).data.revisions;
 assert.deepEqual(shape(readings),['3:READING']);assert.equal(readings[0].event.revision,3);assert.equal(readings[0].event.status,'ACTIVE');
 assert.deepEqual(shape((await api.getEventHistory(ROAD,{kind:['CHANGE','READING']})).data.revisions),['3:READING','2:CHANGE','1:CHANGE']);
 // The event agrees with its history: revision 3, of which one is a reading.
 const event=(await api.getEvent(ROAD)).data;assert.equal(event.revision,3);assert.equal(event.readings,1);
 // An event without readings answers an empty list, not an error.
 assert.deepEqual((await api.getEventHistory(fixtureNodes[0].id,{kind:['READING']})).data.revisions,[]);
 // The archive: same rule across events.
 const changes=(await api.listHistory(window)).data.revisions;
 assert.equal(changes.length,14);assert(changes.every(r=>r.kind==='CHANGE'));
 assert.deepEqual(shape((await api.listHistory({...window,kind:['READING']})).data.revisions),['3:READING']);
 assert.equal((await api.listHistory({...window,kind:['CHANGE','READING']})).data.revisions.length,15);
 // Time bounds apply to readings too (the reading is at 11:00).
 assert.deepEqual((await api.listHistory({from:'2026-11-07T00:00:00Z',to:'2026-11-07T10:30:00Z',kind:['READING']})).data.revisions,[]);
});
test('fixture history rejects an unknown kind, and q with READING, as the API does',async()=>{
 const api=createSierraClient({fetch:createFixtureFetch()});const window={from:'2026-11-07T00:00:00Z',to:FIXTURE_NOW};
 const fetcher=createFixtureFetch();
 for(const url of [`https://fixture.test/api/v1/events/${ROAD}/history?kind=BOGUS`,'https://fixture.test/api/v1/history?from=2026-11-07T00:00:00Z&to=2026-11-07T12:00:00Z&kind=CHANGE&kind=BOGUS','https://fixture.test/api/v1/history?from=2026-11-07T00:00:00Z&to=2026-11-07T12:00:00Z&kind=REVISION_KIND_UNSPECIFIED']){
  const response=await fetcher(url);assert.equal(response.status,400);
  const body=await response.json();assert.equal(body.codeName,'INVALID_ARGUMENT');assert.match(body.message,/^unknown kind: ".+" \(CHANGE or READING\)$/);
 }
 // Lowercase and comma-separated spellings are accepted, as by the API.
 assert.equal((await (await fetcher(`https://fixture.test/api/v1/events/${ROAD}/history?kind=change,reading`)).json()).revisions.length,3);
 await assert.rejects(api.listHistory({...window,q:'road',kind:['READING']}),badRequest(/q cannot be combined with kind=READING/));
 await assert.rejects(api.listHistory({...window,q:'road',kind:['CHANGE','READING']}),badRequest(/q cannot be combined with kind=READING/));
 const searched=await api.listHistory({...window,q:'relay',kind:['CHANGE']});assert(searched.data.revisions.length>0);assert(searched.data.revisions.every(r=>r.kind==='CHANGE'));
});
test('fixtures reject an unknown layer or status instead of answering an empty list',async()=>{
 const fetcher=createFixtureFetch();
 for(const [url,message] of [
  ['https://fixture.test/api/v1/events?layer=BOGUS','unknown layer: "BOGUS"'],
  ['https://fixture.test/api/v1/events?layer=MESH,bogus','unknown layer: "bogus"'],
  ['https://fixture.test/api/v1/events?layer=LAYER_UNSPECIFIED','unknown layer: "LAYER_UNSPECIFIED"'],
  ['https://fixture.test/api/v1/history?from=2026-11-07T00:00:00Z&to=2026-11-07T12:00:00Z&layer=BOGUS','unknown layer: "BOGUS"'],
  ['https://fixture.test/api/v1/events?status=BOGUS','unknown status: "BOGUS"'],
 ]){const response=await fetcher(url);assert.equal(response.status,400,url);assert.equal((await response.json()).message,message);}
 const api=createSierraClient({fetch:createFixtureFetch()});
 // A known layer with no fixture events is a true empty list; slugs and the mesh aliases still resolve.
 assert.deepEqual((await api.listEvents({layer:['ROAD_SEGMENT','SOURCE_HEALTH','CHAIN_CONTROL']})).data.events,[]);
 for(const spelling of ['mesh','mesh_node','network'])assert.equal((await (await fetcher(`https://fixture.test/api/v1/events?layer=${spelling}`)).json()).events.length,6,spelling);
 assert.equal((await api.listEvents({layer:['ROAD_INCIDENT'],status:['ACTIVE']})).data.events.length,1);
});
test('getEventSamples requests the samples route with an encoded id',async()=>{
 const urls:URL[]=[];const id='road:hwy 4/east?';
 const api=createSierraClient({fetch:async input=>{urls.push(new URL(String(input)));return Response.json({eventId:id,layer:'ROAD_SEGMENT',from:'2026-11-06T12:00:00Z',to:FIXTURE_NOW,coverage:{first:'2026-11-06T12:05:00Z',last:'2026-11-06T12:20:00Z',samples:2},bucketSeconds:0,gaps:[],road:[
  {at:'2026-11-06T12:05:00Z',samples:1,status:'OPEN',congestion:'CLEAR',durationMinutes:28,durationMinutesMin:28,durationMinutesMax:28,delayMinutes:1,delayMinutesMax:1},
  {at:'2026-11-06T12:20:00Z',samples:1,status:'CLOSED',congestion:'',durationMinutes:null,durationMinutesMin:null,durationMinutesMax:null,delayMinutes:null,delayMinutesMax:null}]});}});
 const result=await api.getEventSamples(id,{from:'2026-11-06T12:00:00Z',to:FIXTURE_NOW});
 assert.equal(urls[0].pathname,'/api/v1/events/road%3Ahwy%204%2Feast%3F/samples');
 assert.equal(urls[0].searchParams.get('from'),'2026-11-06T12:00:00Z');assert.equal(urls[0].searchParams.get('to'),FIXTURE_NOW);
 assert.equal(urls[0].searchParams.has('geometryFormat'),false);
 assert.equal(result.data.eventId,id);assert.equal(result.data.bucketSeconds,0);assert.equal(result.data.coverage.samples,2);
 assert.equal(result.data.road[0].durationMinutes,28);assert.equal(result.data.road[1].durationMinutes,null,'a closed road has no travel time');
 await api.getEventSamples(id);assert.equal(urls[1].search,'');
 await api.getEventSamples(id,{maxPoints:100});assert.equal(urls[2].searchParams.get('maxPoints'),'100');
});
test('fixture events keep no samples: the API\'s 404, not an invented series',async()=>{
 const api=createSierraClient({fetch:createFixtureFetch()});
 const notFound=(message:string)=>(e:unknown)=>e instanceof SierraApiError&&e.status===404&&e.codeName==='NOT_FOUND'&&e.message===message;
 await assert.rejects(api.getEventSamples(ROAD),notFound('events on the ROAD_INCIDENT layer keep no samples (ROAD_SEGMENT events do)'));
 await assert.rejects(api.getEventSamples(fixtureNodes[0].id),notFound('events on the MESH layer keep no samples (ROAD_SEGMENT events do)'));
 await assert.rejects(api.getEventSamples('road:nowhere'),notFound('unknown event: "road:nowhere"'));
 await assert.rejects(createSierraClient({fetch:createFixtureFetch({scenario:'unavailable'})}).getEventSamples(ROAD),e=>e instanceof SierraApiError&&e.status===503);
});
test('fields that were new in earlier releases are required: a response without one fails',async()=>{
 // No field is optional-because-new in this release (FIELDS_ADDED_SINCE_PREVIOUS_RELEASE is empty).
 await assert.rejects(recording(body=>{if('id' in body&&'layer' in body)delete body.subhead;}).api.getEvent(ROAD));
 await assert.rejects(recording(body=>{if('id' in body&&'layer' in body)delete body.readings;}).api.getEvent(ROAD));
 await assert.rejects(recording(body=>{for(const row of body.revisions??[])delete row.kind;}).api.getEventHistory(ROAD));
 const base=(await createSierraClient({fetch:createFixtureFetch()}).getEvent(ROAD)).data as any;
 const road=(detail:Record<string,unknown>)=>createSierraClient({fetch:async()=>Response.json({...base,roadIncident:undefined,roadSegment:{roadId:'r',name:'Hwy 4',section:'A to B',status:'CLOSED',beyond:[],...detail}})}).getEvent(ROAD);
 await assert.rejects(road({}));
 assert.deepEqual((await road({causes:[]})).data.roadSegment?.causes,[]);
});
