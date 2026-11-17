import {fixtureData} from './fixtures-data.js';
import * as s from './generated/zod.gen.js';
export const FIXTURE_NOW = fixtureData.now;
export const FIXTURE_LABEL = 'Synthetic demonstration data — not current conditions';
export type FixtureScenario = 'normal'|'empty'|'stale'|'partial'|'unavailable';
const events = fixtureData.events.map(x=>s.zV1Event.parse(x));
const places = fixtureData.places.map(x=>s.zV1Place.parse(x));
const telemetry = Object.fromEntries(Object.entries(fixtureData.telemetry).map(([key,x])=>[key,s.zV1MeshTelemetryArchive.parse(x)]));
const links = fixtureData.links.map(x=>s.zMeshLink.parse(x));
const cameras = s.zV1CameraList.parse(fixtureData.cameras).cameras;
const scanners = s.zV1ScannerList.parse(fixtureData.scanners).scanners;
export const fixtureNodes = events.filter(x=>x.mesh).map(x=>({id:x.id,name:x.headline,publicKey:x.mesh!.publicKey}));
const STALE_LAST_SUCCESS = '2026-11-05T12:00:00Z';
const ranks=['INFO','MINOR','MODERATE','SEVERE','EXTREME'];
// What the enum query parameters accept, read from the generated schemas so a regenerate keeps them current.
// The API takes every named value except the zero value, plus two aliases of MESH.
const named=(schema:{options:readonly [{options:readonly string[]},...unknown[]]})=>schema.options[0].options.filter(x=>!/_UNSPECIFIED$/.test(x));
const layers=named(s.zV1Layer),statuses=named(s.zV1EventStatus),revisionKinds=named(s.zV1RevisionKind);
const layerAlias:Record<string,string>={NETWORK:'MESH',MESH_NODE:'MESH'};
/** The one fixture event whose history has a READING revision (pass `kind: ['CHANGE','READING']` to see it). */
export const FIXTURE_READING_EVENT_ID='chp:fixture-road';
const READING_EVENT_ID=FIXTURE_READING_EVENT_ID;
/** Deterministic GET-only fixture transport. It never performs network requests. */
export function createFixtureFetch({scenario='normal'}: {scenario?:FixtureScenario} = {}): typeof fetch {
 return async (input,init) => {
  const req=new Request(input,init);req.signal.throwIfAborted();const url=new URL(req.url);const q=url.searchParams;
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','X-Sierra-Fixture':scenario}});
  const unavailable=(plain=false)=>new Response(plain?'Synthetic deployment handoff':JSON.stringify({code:14,codeName:'UNAVAILABLE',message:'Synthetic data service unavailable',details:[]}),{status:503,headers:{'Content-Type':plain?'text/plain':'application/json','Retry-After':'1','X-Sierra-Fixture':scenario}});
  const lastSuccessAt=scenario==='unavailable'?null:scenario==='stale'?STALE_LAST_SUCCESS:FIXTURE_NOW;
  const error=(message:string,status=400)=>reply({code:status===404?5:3,codeName:status===404?'NOT_FOUND':'INVALID_ARGUMENT',message,details:[]},status);
  if(req.method!=='GET')return error('Fixtures support public GET only',405);
  const path=decodeURIComponent(url.pathname);const place=q.get('place');
  if(scenario==='unavailable'&&(path==='/api/v1/events'||path.startsWith('/api/v1/events/')||path==='/api/v1/history'||path==='/api/v1/mesh/telemetry'||path==='/api/v1/mesh/links'))return unavailable(path==='/api/v1/mesh/links');
  const allowed = new Set(['place','layer','status','severityMin','since','pageSize','pageToken','geometryFormat','from','to','node','window','kind','q','qTyping','counts','collapse','limit']);
  for(const key of q.keys())if(!allowed.has(key))return error(`Unsupported fixture parameter: ${key}`);
  if(q.has('geometryFormat')&&q.get('geometryFormat')!=='OBJECT')return error('Fixtures support OBJECT geometry only');
  const foundPlace=(key:string)=>places.find(x=>x.slug===key||x.id===key);
  // Enum parameters as the API reads them: repeated or comma-separated, any case, and an unknown value is a 400 (never an empty result).
  const listed=(key:string)=>q.getAll(key).flatMap(x=>x.split(',')).map(x=>x.trim()).filter(Boolean);
  const unknown=(key:string,known:readonly string[],hint='')=>{const bad=listed(key).find(x=>!known.includes(x.toUpperCase()));return bad===undefined?null:error(`unknown ${key}: ${JSON.stringify(bad)}${hint}`);};
  if(place&&!foundPlace(place))return error('Unknown fixture place',404);
  const filters=(items:typeof events)=>{
   let result=scenario==='empty'?[]:items;
   for(const key of ['layer','status'] as const){const values=listed(key).map(x=>x.toUpperCase()).map(x=>key==='layer'?layerAlias[x]??x:x);if(values.length)result=result.filter(x=>values.includes(x[key]));}
   if(place)result=result.filter(x=>x.placeIds.includes(foundPlace(place)!.id));
   if(q.has('severityMin'))result=result.filter(x=>ranks.indexOf(x.severity)>=ranks.indexOf(q.get('severityMin')!.toUpperCase()));
   if(q.has('since'))result=result.filter(x=>Date.parse(x.observedAt??'')>=Date.parse(q.get('since')!));
   return result.sort((a,b)=>ranks.indexOf(b.severity)-ranks.indexOf(a.severity)||Date.parse(b.observedAt??'')-Date.parse(a.observedAt??'')||a.id.localeCompare(b.id));
  };
  const page=<T,>(items:T[],field:string,extra:(shown:T[])=>object=()=>({}))=>{
   const size=Math.min(200,Number(q.get('pageSize')||50))||50;
   const offset=Number(q.get('pageToken')||0);
   if(size<0||!Number.isInteger(size)||!Number.isInteger(offset)||offset<0)return error('Invalid fixture pagination');
   const count=scenario==='partial'?Math.min(size,2):size;
   const shown=items.slice(offset,offset+count);
   return reply({[field]:shown,nextPageToken:offset+count<items.length?String(offset+count):'',...extra(shown)});
  };
  // Text search, approximated: every word of q must appear in the event's
  // text (case-insensitive substring of a word start; the last word is a
  // prefix only with qTyping, otherwise a whole word). The real service stems
  // words and reads roads in any spelling; fixtures do neither.
  const text=(q.get('q')??'').trim();
  const words=text.toLowerCase().split(/\s+/).filter(Boolean);
  const typing=q.get('qTyping')==='true'&&!/\s$/.test(q.get('q')??'');
  if(q.has('q')&&text&&!words.some(w=>/[a-z0-9]/.test(w)))return error('q has nothing to search for');
  const tokens=(value:string)=>value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const eventText=(event:typeof events[number])=>[event.headline,event.areaLabel,event.summary,event.description,event.category,event.mesh?.name,event.mesh?.publicKey,event.provenance.sourceName].filter(Boolean).join(' ');
  const matches=(value:string)=>{const have=tokens(value);return words.every((w,i)=>tokens(w).every(part=>have.some(t=>typing&&i===words.length-1?t.startsWith(part):t===part)));};
  const snippet=(event:typeof events[number])=>{
   const title=[event.headline,event.areaLabel].filter(Boolean).join(' · ');
   const parts=title.split(/([A-Za-z0-9]+)/).filter(Boolean).map(run=>({text:run,hit:words.some((w,i)=>tokens(w).some(part=>typing&&i===words.length-1?run.toLowerCase().startsWith(part):run.toLowerCase()===part))}));
   return parts.some(x=>x.hit)?{field:'title',parts}:{field:'',parts:[]};
  };
  const searchInfo=()=>({query:words.join(' '),since:'2026-11-01T00:00:00Z',note:FIXTURE_LABEL});
  const newest=<T extends {observedAt?:string|null,id:string}>(a:T,b:T)=>Date.parse(b.observedAt??'')-Date.parse(a.observedAt??'')||a.id.localeCompare(b.id);
  if(path==='/api/v1/events'||path==='/api/v1/history'){const bad=unknown('layer',[...layers,...Object.keys(layerAlias)])??unknown('status',statuses);if(bad)return bad;}
  if(path==='/api/v1/events'){
   const searching=words.length>0,counting=searching||q.get('counts')==='true';
   let selected=filters(events);
   if(searching)selected=selected.filter(x=>matches(eventText(x))).sort(newest);
   const tally=new Map<string,{layer:string,category:string,events:number}>();
   for(const x of selected){const key=x.layer+'\u0000'+x.category;const row=tally.get(key)??{layer:x.layer,category:x.category,events:0};row.events++;tally.set(key,row);}
   return page(selected,'events',shown=>({
    totalMatches:counting?selected.length:null,
    counts:counting?[...tally.values()].sort((a,b)=>a.layer.localeCompare(b.layer)||a.category.localeCompare(b.category)):[],
    matches:searching?Object.fromEntries(shown.map(x=>[x.id,snippet(x)])):{},
    search:searching?searchInfo():null,
   }));
  }
  if(path==='/api/v1/search'){
   if(!words.length)return error('q is required');
   const limit=Math.min(20,Number(q.get('limit')||5))||5;
   const kinds=['PLACE','ROAD','EVENT','MESH_NODE','CAMERA','SCANNER'];
   const asked=q.getAll('kind').flatMap(x=>x.split(',')).map(x=>x.trim().toUpperCase()).filter(Boolean);
   if(asked.some(x=>!kinds.includes(x)))return error('unknown kind');
   const want=(kind:string)=>!asked.length||asked.includes(kind);
   const none={event:null,match:null,url:''};
   const found:Record<string,object[]>={};
   const live=scenario==='empty'?[]:events;
   if(want('PLACE'))found.PLACE=places.filter(x=>matches(x.name+' '+x.slug)).map(x=>({...none,kind:'PLACE',id:x.slug,title:x.name,detail:x.kind.charAt(0)+x.kind.slice(1).toLowerCase(),apiPath:`/api/v1/places/${x.slug}/summary`}));
   if(want('ROAD'))found.ROAD=[];
   for(const kind of ['EVENT','MESH_NODE'])if(want(kind))found[kind]=live.filter(x=>(x.layer==='MESH')===(kind==='MESH_NODE')&&matches(eventText(x))).sort(newest).map(x=>{const m=snippet(x);return {kind,id:x.id,title:x.headline,detail:x.areaLabel,match:m.parts.length?m:null,apiPath:`/api/v1/events/${x.id}`,url:x.canonicalUrl,event:{layer:x.layer,category:x.category,status:x.status,severity:x.severity,observedAt:x.observedAt}};});
   if(want('CAMERA'))found.CAMERA=cameras.filter(x=>matches([x.name,x.route,x.nearbyPlace,x.county].join(' '))).map(x=>({...none,kind:'CAMERA',id:x.id,title:x.name,detail:[x.route,x.nearbyPlace].filter(Boolean).join(', '),apiPath:'/api/v1/cameras',url:x.imageUrl}));
   if(want('SCANNER'))found.SCANNER=scanners.filter(x=>matches(x.channelLabel+' '+x.agency)).map(x=>({...none,kind:'SCANNER',id:x.feedId,title:x.channelLabel,detail:x.agency,apiPath:'/api/v1/scanners',url:x.broadcastifyUrl}));
   const searched=kinds.filter(kind=>want(kind)&&!(kind==='CAMERA'&&scenario==='unavailable'));
   return reply({
    hits:searched.flatMap(kind=>found[kind].slice(0,limit)),
    totals:searched.map(kind=>({kind,matches:found[kind].length})),
    unavailable:want('CAMERA')&&scenario==='unavailable'?['CAMERA']:[],
    search:searchInfo(),
   });
  }
  if(path==='/api/v1/history'||path.endsWith('/history')){
   const from=q.get('from'),to=q.get('to');
   if(path==='/api/v1/history'&&(!from||!to||!(Date.parse(from)<Date.parse(to))))return error('Fixture history requires explicit from < to');
   const id=path==='/api/v1/history'?null:path.slice('/api/v1/events/'.length,-'/history'.length);
   const selected=id?events.filter(x=>x.id===id):filters(events);
   if(id&&!selected.length)return error('Unknown event',404);
   const archive=path==='/api/v1/history',searching=archive&&words.length>0,collapse=(q.get('collapse')??'').toLowerCase();
   if(collapse&&collapse!=='event')return error('unknown collapse');
   if(collapse&&!searching)return error('collapse=event needs q');
   // Revision kinds as the API reads them: changes only unless READING is asked for; q searches changes only.
   const badKind=unknown('kind',revisionKinds,' (CHANGE or READING)');if(badKind)return badKind;
   const kinds=listed('kind').map(x=>x.toUpperCase());if(!kinds.length)kinds.push('CHANGE');
   if(searching&&kinds.includes('READING'))return error("q searches changes only: a reading's content is not in the search text, so q cannot be combined with kind=READING");
   // Two changes per event (SCHEDULED, then ACTIVE). The road incident also has one synthetic READING: a later report that confirmed the unchanged state.
   const history=(event:typeof events[number])=>[
    {revision:1,kind:'CHANGE',at:'2026-11-07T08:00:00Z',status:'SCHEDULED'},
    {revision:2,kind:'CHANGE',at:'2026-11-07T10:00:00Z',status:'ACTIVE'},
    ...(event.id===READING_EVENT_ID?[{revision:3,kind:'READING',at:'2026-11-07T11:00:00Z',status:'ACTIVE'}]:[]),
   ].filter(x=>kinds.includes(x.kind));
   const revisions=selected.flatMap(event=>history(event).map(({revision,kind,at,status})=>({revision,kind,observedAt:at,ingestedAt:at,event:{...event,revision,observedAt:at,status},match:searching?snippet(event):null,hit:!searching||matches(eventText(event))}))).filter(x=>x.hit&&(!from||Date.parse(x.observedAt)>=Date.parse(from))&&(!to||Date.parse(x.observedAt)<Date.parse(to))).map(({hit:_hit,...x})=>x).sort((a,b)=>b.observedAt.localeCompare(a.observedAt)||a.event.id.localeCompare(b.event.id));
   if(collapse){
    const groups=new Map<string,typeof revisions>();
    for(const x of revisions)groups.set(x.event.id,[...(groups.get(x.event.id)??[]),x]);
    const rows=[...groups.entries()].map(([eventId,list])=>{const byRev=[...list].sort((a,b)=>a.revision-b.revision);const last=byRev[byRev.length-1];return {eventId,first:byRev[0],lastRevision:last.revision,lastObservedAt:last.observedAt,matchingRevisions:list.length};}).sort((a,b)=>b.lastObservedAt.localeCompare(a.lastObservedAt)||a.eventId.localeCompare(b.eventId));
    return page(rows,'collapsed',()=>({revisions:[],totalMatches:rows.length,search:searchInfo()}));
   }
   return page(revisions,'revisions',()=>({collapsed:[],totalMatches:searching?revisions.length:null,search:searching?searchInfo():null}));
  }
  if(path.startsWith('/api/v1/events/')&&path.endsWith('/samples')){
   // Only ROAD_SEGMENT events keep a series, and no fixture event is one: answer as the API does for the other layers rather than invent a road dataset.
   const id=path.slice('/api/v1/events/'.length,-'/samples'.length);const event=events.find(x=>x.id===id);
   return error(event?`events on the ${event.layer} layer keep no samples (ROAD_SEGMENT events do)`:`unknown event: ${JSON.stringify(id)}`,404);
  }
  if(path.startsWith('/api/v1/events/')){const event=events.find(x=>x.id===path.slice('/api/v1/events/'.length));return event?reply(event):error('Unknown event',404);}
  if(path==='/api/v1/places')return reply({places:places.filter(x=>(!q.get('kind')||x.kind===q.get('kind'))&&(!q.get('q')||x.name.toLowerCase().includes(q.get('q')!.toLowerCase())))});
  if(path==='/api/v1/sources')return reply({sources:fixtureData.sources.map(x=>({...x,lastSuccessAt,lastAttemptAt:FIXTURE_NOW,lastError:scenario==='stale'?'Synthetic upstream timeout':scenario==='unavailable'?'Synthetic upstream unavailable':'',status:scenario==='stale'?'STALE':scenario==='unavailable'?'UNAVAILABLE':'OK'}))});
  if(path==='/api/v1/mesh/links'){
   const window=q.get('window')??'72h';const match=/^(\d+(?:\.\d+)?)(h|m|s)$/.exec(window);if(!match||Number(match[1])<=0)return error('Fixture supports positive h/m/s windows');
   const age=Number(match[1])*({h:3600000,m:60000,s:1000}[match[2] as 'h']);
   return reply({window,generatedAt:FIXTURE_NOW,links:scenario==='empty'?[]:links.filter(x=>Date.parse(x.lastSeen)>=Date.parse(FIXTURE_NOW)-age)});
  }
  if(path==='/api/v1/mesh/telemetry'){
   const key=(q.get('node')??'').toLowerCase().replace(/^meshcore:/,'');if(!/^([a-f0-9]{2}){4,32}$/.test(key))return error('Invalid mesh key');
   if(scenario==='partial'&&key===fixtureNodes[2].publicKey)return unavailable();
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
      sources:[{id:'meshcore',status,lastSuccessAt}]});
   }
   if(match[2].startsWith('map/')){
    const layer=match[2].slice(4).replace(/\.geojson$/,'');
    if(!['mesh_node','mesh_link','road_incident'].includes(layer))return error(`Unsupported fixture map layer: ${layer}`,404);
    const nodeFeature=(event:typeof events[number])=>({type:'Feature',geometry:event.geometry?.object??null,properties:{id:event.id,layer:event.layer==='MESH'?'MESH_NODE':event.layer,kind:event.mesh?'Mesh node':'Road incident',severity:event.severity,severityRank:ranks.indexOf(event.severity),headline:event.headline,source:{id:event.provenance.sourceId,name:event.provenance.sourceName,attribution:event.provenance.attribution},...(event.mesh?{mesh:{publicKey:event.mesh.publicKey,name:event.headline,nodeType:event.mesh.nodeType,inRegion:event.placeIds.includes(selected.id)}}:{})}});
    let features:unknown[]=layer==='mesh_link'?[...events.filter(x=>x.mesh).map(nodeFeature),...links.map(link=>({type:'Feature',geometry:{type:'LineString',coordinates:[events.find(x=>x.mesh?.publicKey===link.a)!.geometry!.object!.coordinates,events.find(x=>x.mesh?.publicKey===link.b)!.geometry!.object!.coordinates]},properties:{id:`mesh_link:${link.a}:${link.b}`,layer:'MESH_LINK',kind:'Relay link',severity:'INFO',severityRank:0,headline:'Observed demo link',source:{id:'meshcore',name:'Synthetic MeshCore fixture',attribution:FIXTURE_LABEL},meshLink:link}}))]:events.filter(x=>x.placeIds.includes(selected.id)&&(layer==='mesh_node'?x.layer==='MESH':x.layer.toLowerCase()===layer)).map(nodeFeature);
    if(scenario==='empty'||scenario==='unavailable')features=[];
    return reply({type:'FeatureCollection',features,metadata:{layer,area:selected.slug,generatedAt:FIXTURE_NOW,...(lastSuccessAt?{lastSourceUpdate:lastSuccessAt}:{}),sourceStatus:scenario==='stale'?'STALE':scenario==='unavailable'?'UNAVAILABLE':'OK',attribution:FIXTURE_LABEL,schemaVersion:1}});
   }
  }
  return error('Endpoint not implemented by synthetic fixtures',404);
 };
}
