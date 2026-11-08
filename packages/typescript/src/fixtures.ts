import {fixtureData} from './fixtures-data.js';
import * as s from './generated/zod.gen.js';
export const FIXTURE_NOW = fixtureData.now;
export const FIXTURE_LABEL = 'Synthetic demonstration data — not current conditions';
export type FixtureScenario = 'normal'|'empty'|'stale'|'partial'|'unavailable';
const events = fixtureData.events.map(x=>s.zV1Event.parse(x));
const places = fixtureData.places.map(x=>s.zV1Place.parse(x));
const telemetry = Object.fromEntries(Object.entries(fixtureData.telemetry).map(([key,x])=>[key,s.zV1MeshTelemetryArchive.parse(x)]));
const links = fixtureData.links.map(x=>s.zMeshLink.parse(x));
export const fixtureNodes = events.filter(x=>x.mesh).map(x=>({id:x.id,name:x.headline,publicKey:x.mesh!.publicKey}));
const ranks=['INFO','MINOR','MODERATE','SEVERE','EXTREME'];
/** Deterministic GET-only fixture transport. It never performs network requests. */
export function createFixtureFetch({scenario='normal'}: {scenario?:FixtureScenario} = {}): typeof fetch {
 return async (input,init) => {
  const req=new Request(input,init);req.signal.throwIfAborted();const url=new URL(req.url);const q=url.searchParams;
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','X-Sierra-Fixture':scenario}});
  const error=(message:string,status=400)=>reply({code:status===404?5:3,codeName:status===404?'NOT_FOUND':'INVALID_ARGUMENT',message,details:[]},status);
  if(req.method!=='GET')return error('Fixtures support public GET only',405);
  const path=decodeURIComponent(url.pathname);const place=q.get('place');
  const allowed = new Set(['place','layer','status','severityMin','since','pageSize','pageToken','geometryFormat','from','to','node','window','kind','q']);
  for(const key of q.keys())if(!allowed.has(key))return error(`Unsupported fixture parameter: ${key}`);
  if(q.has('geometryFormat')&&q.get('geometryFormat')!=='OBJECT')return error('Fixtures support OBJECT geometry only');
  const foundPlace=(key:string)=>places.find(x=>x.slug===key||x.id===key);
  if(place&&!foundPlace(place))return error('Unknown fixture place',404);
  const filters=(items:typeof events)=>{
   let result=scenario==='empty'?[]:items;
   for(const key of ['layer','status'] as const){const values=q.getAll(key).flatMap(x=>x.split(',')).map(x=>x.toUpperCase());if(values.length)result=result.filter(x=>values.includes(x[key]));}
   if(place)result=result.filter(x=>x.placeIds.includes(foundPlace(place)!.id));
   if(q.has('severityMin'))result=result.filter(x=>ranks.indexOf(x.severity)>=ranks.indexOf(q.get('severityMin')!.toUpperCase()));
   if(q.has('since'))result=result.filter(x=>Date.parse(x.observedAt??'')>=Date.parse(q.get('since')!));
   return result.sort((a,b)=>ranks.indexOf(b.severity)-ranks.indexOf(a.severity)||Date.parse(b.observedAt??'')-Date.parse(a.observedAt??'')||a.id.localeCompare(b.id));
  };
  const page=<T,>(items:T[],field:string)=>{
   const size=Math.min(200,Number(q.get('pageSize')||50))||50;
   const offset=Number(q.get('pageToken')||0);
   if(size<0||!Number.isInteger(size)||!Number.isInteger(offset)||offset<0)return error('Invalid fixture pagination');
   const count=scenario==='partial'?Math.min(size,2):size;
   return reply({[field]:items.slice(offset,offset+count),nextPageToken:offset+count<items.length?String(offset+count):''});
  };
  if(path==='/api/v1/events')return page(filters(events),'events');
  if(path==='/api/v1/history'||path.endsWith('/history')){
   const from=q.get('from'),to=q.get('to');
   if(path==='/api/v1/history'&&(!from||!to||!(Date.parse(from)<Date.parse(to))))return error('Fixture history requires explicit from < to');
   const id=path==='/api/v1/history'?null:path.slice('/api/v1/events/'.length,-'/history'.length);
   const selected=id?events.filter(x=>x.id===id):filters(events);
   if(id&&!selected.length)return error('Unknown event',404);
   const revisions=selected.flatMap(event=>[0,1].map(i=>{const at=i?'2026-11-07T10:00:00Z':'2026-11-07T08:00:00Z';return {revision:i+1,observedAt:at,ingestedAt:at,event:{...event,revision:i+1,observedAt:at,status:i?'ACTIVE':'SCHEDULED'}};})).filter(x=>(!from||Date.parse(x.observedAt)>=Date.parse(from))&&(!to||Date.parse(x.observedAt)<Date.parse(to))).sort((a,b)=>b.observedAt.localeCompare(a.observedAt)||a.event.id.localeCompare(b.event.id));
   return page(revisions,'revisions');
  }
  if(path.startsWith('/api/v1/events/')){const event=events.find(x=>x.id===path.slice('/api/v1/events/'.length));return event?reply(event):error('Unknown event',404);}
  if(path==='/api/v1/places')return reply({places:places.filter(x=>(!q.get('kind')||x.kind===q.get('kind'))&&(!q.get('q')||x.name.toLowerCase().includes(q.get('q')!.toLowerCase())))});
  if(path==='/api/v1/sources')return reply({sources:fixtureData.sources.map(x=>({...x,status:scenario==='stale'?'STALE':scenario==='unavailable'?'UNAVAILABLE':'OK'}))});
  if(path==='/api/v1/mesh/links'){
   const window=q.get('window')??'72h';const match=/^(\d+(?:\.\d+)?)(h|m|s)$/.exec(window);if(!match||Number(match[1])<=0)return error('Fixture supports positive h/m/s windows');
   const age=Number(match[1])*({h:3600000,m:60000,s:1000}[match[2] as 'h']);
   return reply({window,generatedAt:FIXTURE_NOW,links:scenario==='empty'?[]:links.filter(x=>Date.parse(x.lastSeen)>=Date.parse(FIXTURE_NOW)-age)});
  }
  if(path==='/api/v1/mesh/telemetry'){
   const key=(q.get('node')??'').toLowerCase().replace(/^meshcore:/,'');if(!/^([a-f0-9]{2}){4,32}$/.test(key))return error('Invalid mesh key');
   const to=q.get('to')??FIXTURE_NOW;const from=q.get('from')??new Date(Date.parse(to)-86400000).toISOString();if(!(Date.parse(from)<Date.parse(to)))return error('Invalid telemetry window');
   const archive=telemetry[key];if(!archive||scenario==='empty')return reply({node:key,from,to,coverage:{from:null,to:null,samples:0},cadenceSeconds:null,reboots:[],samples:[],truncated:false});
   const samples=archive.samples.filter(x=>Date.parse(x.reading.reportedAt!)>=Date.parse(from)&&Date.parse(x.reading.reportedAt!)<Date.parse(to));
   return reply({...archive,from,to,samples,reboots:archive.reboots.filter(x=>Date.parse(x)>=Date.parse(from)&&Date.parse(x)<Date.parse(to)),truncated:archive.truncated||scenario==='partial'});
  }
  if(path==='/api/v1/conditions')return reply(fixtureData.conditions);
  if(path==='/api/v1/cameras')return reply(fixtureData.cameras);
  if(path==='/api/v1/scanners')return reply(fixtureData.scanners);
  const match=/^\/api\/v1\/places\/([^/]+)(?:\/(.*))?$/.exec(path);
  if(match){const selected=foundPlace(match[1]);if(!selected)return error('Unknown place',404);
   if(!match[2])return reply(selected);
   if(match[2]==='summary'){
    const status=scenario==='unavailable'?'UNAVAILABLE':scenario==='stale'?'STALE':'OK';
    return reply({...fixtureData.summary,place:selected.slug,placeId:selected.id,placeName:selected.name,mode:scenario==='empty'?'QUIET':'WATCH',generatedAt:FIXTURE_NOW,
      summary:{...fixtureData.summary.summary,activeEvacuations:scenario==='unavailable'?null:0,evacuationStatus:status,evacuationSourceUrl:'https://protect.genasys.com/',totalActive:scenario==='empty'?0:1,highestSeverity:scenario==='empty'?'INFO':'MODERATE',highestSeverityRank:scenario==='empty'?0:2},
      domains:['fire','evacuation','weather','roads','seismic','power','burn','comms'].map(domain=>({domain,status,activeCount:scenario==='empty'?0:domain==='comms'?5:domain==='roads'?1:0,highestSeverity:domain==='roads'&&scenario!=='empty'?'MODERATE':'INFO',headlines:[]})),
      sources:[{id:'meshcore',status,lastSuccessAt:scenario==='unavailable'?null:FIXTURE_NOW}]});
   }
   if(match[2].startsWith('map/')){
    const layer=match[2].slice(4).replace(/\.geojson$/,'');
    const nodeFeature=(event:typeof events[number])=>({type:'Feature',geometry:event.geometry?.object??null,properties:{id:event.id,layer:event.layer==='MESH'?'MESH_NODE':event.layer,kind:event.mesh?'Mesh node':'Road incident',severity:event.severity,severityRank:ranks.indexOf(event.severity),headline:event.headline,source:{id:event.provenance.sourceId,name:event.provenance.sourceName,attribution:event.provenance.attribution},...(event.mesh?{mesh:{publicKey:event.mesh.publicKey,name:event.headline,nodeType:event.mesh.nodeType,inRegion:event.placeIds.includes(selected.id)}}:{})}});
    let features:unknown[]=layer==='mesh_link'?[...events.filter(x=>x.mesh).map(nodeFeature),...links.map(link=>({type:'Feature',geometry:{type:'LineString',coordinates:[events.find(x=>x.mesh?.publicKey===link.a)!.geometry!.object!.coordinates,events.find(x=>x.mesh?.publicKey===link.b)!.geometry!.object!.coordinates]},properties:{id:`mesh_link:${link.a}:${link.b}`,layer:'MESH_LINK',kind:'Relay link',severity:'INFO',severityRank:0,headline:'Observed demo link',source:{id:'meshcore',name:'Synthetic MeshCore fixture',attribution:FIXTURE_LABEL},meshLink:link}}))]:events.filter(x=>x.placeIds.includes(selected.id)&&(layer==='mesh_node'?x.layer==='MESH':x.layer.toLowerCase()===layer)).map(nodeFeature);
    if(scenario==='empty'||scenario==='unavailable')features=[];
    return reply({type:'FeatureCollection',features,metadata:{layer,area:selected.slug,generatedAt:FIXTURE_NOW,sourceStatus:scenario==='stale'?'STALE':scenario==='unavailable'?'UNAVAILABLE':'OK',attribution:FIXTURE_LABEL,schemaVersion:1}});
   }
  }
  return error('Endpoint not implemented by synthetic fixtures',404);
 };
}
