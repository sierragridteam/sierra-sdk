// Type-level test, compiled (never run) by `pnpm check` through
// test/tsconfig.types.json. Response enums are open, request enums are closed:
// a caller cannot send a layer, status, kind or geometry format the API would
// answer with a 400, and an enum value read from a response cannot be passed
// back as a parameter without first being narrowed to a known one.
import {createSierraClient} from '../src/index.ts';
import type {EventQuery,HistoryQuery,MapLayer,SearchQuery,V1Event,V1Layer,V1Source,V1TimelineEntry} from '../src/index.ts';
import type * as T from '../src/generated/types.gen.ts';

type Equal<A,B>=(<X>()=>X extends A?1:2) extends (<X>()=>X extends B?1:2)?true:false;
const yes=<_T extends true>()=>{};
const no=<_T extends false>()=>{};

// Responses: any string is assignable, and the known values are still spelled out.
const layer:V1Layer='LAYER_FROM_THE_FUTURE';
const known:V1Layer='MESH';
const sourceId:V1Event['provenance']['sourceId']='source-from-the-future';
const kind:V1Source['kind']='SATELLITE';
const entry:V1TimelineEntry['kind']='TIMELINE_FROM_THE_FUTURE';
const severity:T.V1SummaryStats['highestSeverity']='CATASTROPHIC';
no<Equal<V1Layer,string>>(); // widened with `string & {}`, not collapsed to `string`
yes<'MESH' extends V1Layer?true:false>();
// @ts-expect-error a number is not an enum value
const wrong:V1Layer=7;
// Structural tags stay closed.
// @ts-expect-error GeoJSON geometry types are fixed
const geometry:T.MapGeometry['type']='Blob';

// Requests: closed unions.
type ElementOf<A>=A extends ReadonlyArray<infer E>?E:never;
no<string extends ElementOf<EventQuery['layer']>?true:false>();
no<string extends ElementOf<EventQuery['status']>?true:false>();
no<string extends NonNullable<EventQuery['severityMin']>?true:false>();
no<string extends NonNullable<EventQuery['geometryFormat']>?true:false>();
no<string extends ElementOf<HistoryQuery['layer']>?true:false>();
no<string extends ElementOf<SearchQuery['kind']>?true:false>();
no<string extends MapLayer?true:false>();
const api=createSierraClient();
export const calls=[
 api.listEvents({layer:['MESH'],status:['ACTIVE'],geometryFormat:'OBJECT'}),
 // @ts-expect-error unknown layer
 api.listEvents({layer:['LAYER_FROM_THE_FUTURE']}),
 // @ts-expect-error unknown status
 api.listEvents({status:['STATUS_FROM_THE_FUTURE']}),
 // @ts-expect-error unknown geometry format
 api.getEvent('id',{geometryFormat:'WKT'}),
 // @ts-expect-error a response layer is not a request layer until narrowed
 api.listEvents({layer:[layer]}),
 // @ts-expect-error unknown search kind
 api.search({q:'x',kind:['PLANET']}),
 // @ts-expect-error unknown place kind
 api.listPlaces({kind:'PLANET'}),
 api.getEventHistory('id',{kind:['CHANGE','READING']}),
 // @ts-expect-error unknown revision kind
 api.getEventHistory('id',{kind:['REVISION_FROM_THE_FUTURE']}),
 // @ts-expect-error unknown revision kind
 api.listHistory({from:'2026-11-06T00:00:00Z',to:'2026-11-07T00:00:00Z',kind:['REVISION_FROM_THE_FUTURE']}),
 api.getMapLayer('ebbetts-pass','mesh_node'),
 // @ts-expect-error unknown map layer
 api.getMapLayer('ebbetts-pass','layer_from_the_future'),
];
export const values=[known,sourceId,kind,entry,severity,wrong,geometry];
