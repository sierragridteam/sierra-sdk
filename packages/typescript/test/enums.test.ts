import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSierraClient} from '../dist/index.js';
import {createFixtureFetch} from '../dist/fixtures.js';
import * as schemas from '../dist/generated/zod.gen.js';
import {fixtureData} from '../dist/fixtures-data.js';
import {tolerateResponseEnums,UNKNOWN_ENUM_VALUE} from '../../../scripts/schema-contract.mjs';

// Response enums are open: a value newer than this SDK validates and reaches the
// caller unchanged. Request enums stay closed in the types; that half is checked
// at compile time by test/request-types.check.ts (part of `pnpm check`).

/** A client whose transport answers the fixture response after `edit` changed it. */
const edited=(edit:(body:any)=>void)=>createSierraClient({fetch:async(input,init)=>{
 const body=await (await createFixtureFetch()(input,init)).json();edit(body);return Response.json(body);
}});
const timeline=(kind:unknown)=>({eventId:'chp:fixture-road',truncated:false,entries:[{after:'',at:'2026-11-07T10:00:00Z',before:'',clock:'TIMELINE_CLOCK_GRID',detail:'',field:'',kind,label:'Synthetic entry',revision:1}]});

test('an unknown event layer and provenance source id parse and arrive unchanged',async()=>{
 const api=edited(body=>{body.events[0].layer='LAYER_FROM_THE_FUTURE';body.events[0].provenance.sourceId='source-from-the-future';body.events[0].status='STATUS_FROM_THE_FUTURE';});
 const {data}=await api.listEvents();
 assert.equal(data.events[0].layer,'LAYER_FROM_THE_FUTURE');
 assert.equal(data.events[0].provenance.sourceId,'source-from-the-future');
 assert.equal(data.events[0].status,'STATUS_FROM_THE_FUTURE');
 // The rest of the page is untouched, and known values are still what they were.
 assert.equal(data.events[1].layer,'MESH');assert.equal(data.events[1].provenance.sourceId,'meshcore');
});
test('an unknown source kind and status parse and arrive unchanged',async()=>{
 const api=edited(body=>{body.sources[0].kind='SATELLITE';body.sources[0].status='DEGRADED';});
 const source=(await api.listSources()).data.sources[0];
 assert.equal(source.kind,'SATELLITE');assert.equal(source.status,'DEGRADED');
 const known=(await createSierraClient({fetch:createFixtureFetch()}).listSources()).data.sources[0];
 assert.equal(known.status,'OK');
});
test('an unknown timeline entry kind parses and arrives unchanged',async()=>{
 const api=(kind:unknown)=>createSierraClient({fetch:async()=>Response.json(timeline(kind))});
 assert.equal((await api('TIMELINE_FROM_THE_FUTURE').getEventTimeline('chp:fixture-road')).data.entries[0].kind,'TIMELINE_FROM_THE_FUTURE');
 assert.equal((await api('TIMELINE_STATUS').getEventTimeline('chp:fixture-road')).data.entries[0].kind,'TIMELINE_STATUS');
});
test('closed string lists on plain fields are open too, and the error envelope',()=>{
 assert.equal(schemas.zV1Severity.parse('CATASTROPHIC'),'CATASTROPHIC');
 assert.equal(schemas.zV1Severity.parse('SEVERE'),'SEVERE');
 assert.equal(schemas.zV1CameraList.parse({...fixtureData.cameras,sourceStatus:'DEGRADED'}).sourceStatus,'DEGRADED');
 assert.equal(schemas.zRpcStatus.parse({code:99,codeName:'CODE_FROM_THE_FUTURE',message:'x',details:[]}).codeName,'CODE_FROM_THE_FUTURE');
});
test('a wrong type or a missing value in an enum field still fails',async()=>{
 await assert.rejects(edited(body=>{body.events[0].layer=7;}).listEvents());
 await assert.rejects(edited(body=>{body.events[0].provenance.sourceId=null;}).listEvents());
 await assert.rejects(edited(body=>{body.sources[0].kind=1;}).listSources());
 await assert.rejects(createSierraClient({fetch:async()=>Response.json(timeline(3))}).getEventTimeline('chp:fixture-road'));
 // No invented default: an enum the response lacks is missing, not *_UNSPECIFIED.
 await assert.rejects(edited(body=>{delete body.events[0].layer;}).listEvents());
 assert.equal(schemas.zV1Layer.safeParse(undefined).success,false);
});
test('what stays strict: request schemas, GeoJSON tags and the map schema version',()=>{
 assert.equal(schemas.zGridServiceListEventsQuery.safeParse({layer:['LAYER_FROM_THE_FUTURE']}).success,false);
 assert.equal(schemas.zGridServiceListEventsQuery.safeParse({layer:['MESH']}).success,true);
 assert.equal(schemas.zGetMapLayerPath.safeParse({place:'ebbetts-pass',layer:'layer_from_the_future'}).success,false);
 assert.equal(schemas.zMapGeometry.safeParse({type:'Blob',coordinates:[]}).success,false);
 assert.equal(schemas.zMapGeometry.safeParse({type:'Point',coordinates:[-120,38]}).success,true);
 const metadata={layer:'layer_from_the_future',area:'ebbetts-pass',generatedAt:'2026-11-07T10:00:00Z',sourceStatus:'DEGRADED',attribution:'Synthetic',schemaVersion:1};
 assert.equal(schemas.zMapLayerMetadata.parse(metadata).layer,'layer_from_the_future');
 assert.equal(schemas.zMapLayerMetadata.safeParse({...metadata,schemaVersion:2}).success,false);
});
test('the overlay relaxes what responses reach and nothing a request uses',()=>{
 const ref=(name:string)=>({$ref:`#/components/schemas/${name}`});
 const doc:any={paths:{'/x/{mode}':{parameters:[{name:'mode',in:'path',schema:ref('Mode')}],get:{operationId:'getX',
   parameters:[{name:'layer',in:'query',schema:{type:'array',items:ref('Layer')}},{$ref:'#/components/parameters/Shared'}],
   responses:{200:{content:{'application/json':{schema:ref('X')}}},default:{$ref:'#/components/responses/Failure'}}}}},
  components:{parameters:{Shared:{name:'shared',in:'query',schema:ref('Mode')}},
   responses:{Failure:{content:{'application/json':{schema:ref('Failure')}}}},
   schemas:{
    Layer:{type:'string',enum:['A','B'],default:'A',description:'kept'},
    Mode:{type:'string',enum:['fast','slow']},
    Failure:{type:'object',properties:{codeName:{type:'string',enum:['OK']}}},
    X:{type:'object',properties:{layer:{allOf:[ref('Layer')]},mode:ref('Mode'),tags:{type:'array',items:{type:'string',enum:['t']}},nested:{type:'object',properties:{state:{type:'string',enum:['on']}}},
     type:{type:'string',enum:['Feature']},version:{type:'integer',enum:[1]},example:{type:'object',example:{enum:['not a schema']}}}},
    Write:{type:'object',properties:{status:{type:'string',enum:['green']}}},
   }}};
 const relaxed=tolerateResponseEnums(doc,new Set(['X.type']));
 assert.deepEqual([...relaxed].sort(),['Failure.codeName','Layer','Mode','X.nested.state','X.tags']);
 const open=(values:string[])=>[{type:'string',enum:values},ref(UNKNOWN_ENUM_VALUE)];
 const s=doc.components.schemas;
 assert.deepEqual(s.Layer,{description:'kept',anyOf:open(['A','B'])});
 assert.deepEqual(s.X.properties.tags.items.anyOf,open(['t']));
 assert.deepEqual(s.X.properties.type,{type:'string',enum:['Feature']},'listed strict');
 assert.deepEqual(s.X.properties.version,{type:'integer',enum:[1]},'not a string enum');
 assert.deepEqual(s.X.properties.example.example,{enum:['not a schema']},'examples are data');
 assert.deepEqual(s.Write.properties.status,{type:'string',enum:['green']},'no response reaches it');
 assert.deepEqual(s[UNKNOWN_ENUM_VALUE].type,'string');
 // Parameters were given their own closed copies before the shared schemas opened.
 const op=doc.paths['/x/{mode}'];
 assert.deepEqual(op.get.parameters[0].schema.items,{type:'string',enum:['A','B'],default:'A',description:'kept'});
 assert.deepEqual(op.parameters[0].schema,{type:'string',enum:['fast','slow']});
 assert.deepEqual(doc.components.parameters.Shared.schema,{type:'string',enum:['fast','slow']});
 assert.throws(()=>tolerateResponseEnums(doc),/already defines/);
});
