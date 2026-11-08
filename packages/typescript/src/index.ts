import type { z } from 'zod';
import * as schemas from './generated/zod.gen.js';
import type * as T from './generated/types.gen.js';
export type * from './generated/types.gen.js';

export type RequestOptions = { signal?: AbortSignal; etag?: string; timeoutMs?: number };
export type ApiResult<T> = { data: T; status: number; etag: string | null; notModified: false } | { data: undefined; status: 304; etag: string | null; notModified: true };
export class SierraApiError extends Error {
  constructor(message: string, readonly status: number, readonly codeName: string, readonly retryAfter: string | null, readonly body: unknown) { super(message); this.name = 'SierraApiError'; }
}
export type ClientOptions = { baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number };
export type EventQuery = NonNullable<T.GridServiceListEventsData['query']>;
export type HistoryQuery = NonNullable<T.GridServiceListHistoryData['query']> & { from: string; to: string };
export type MapLayer = T.GetMapLayerData['path']['layer'];
/** Public read-only client. All returned JSON is validated against generated Zod schemas. */
export function createSierraClient(config: ClientOptions = {}) {
  const base = (config.baseUrl ?? 'https://data.sierragridteam.org').replace(/\/$/, '');
  const fetcher = config.fetch ?? globalThis.fetch;
  async function request<S extends z.ZodType>(path: string, schema: S, query: object = {}, options: RequestOptions = {}): Promise<ApiResult<z.output<S>>> {
    const url = new URL(base + path);
    for (const [key, value] of Object.entries(query)) {
      if(value === undefined || value === null) continue;
      for(const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
    }
    const timeout = options.timeoutMs ?? config.timeoutMs ?? 20_000;
    if(!Number.isFinite(timeout) || timeout <= 0) throw new RangeError('timeoutMs must be positive');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Request deadline exceeded', 'TimeoutError')), timeout);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    try {
      const response = await fetcher(url, {method:'GET',signal,headers:options.etag ? {'If-None-Match':options.etag} : {}});
      const etag = response.headers.get('ETag');
      if(response.status === 304) return {data:undefined,status:304,etag,notModified:true};
      const text = await response.text();
      let body: unknown; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      if(!response.ok) {
        const error = schemas.zRpcStatus.safeParse(body);
        throw new SierraApiError(error.success ? (error.data.message ?? 'Grid error') : `Grid request failed (${response.status})`, response.status, error.success ? (error.data.codeName ?? 'UNKNOWN') : 'HTTP_ERROR',response.headers.get('Retry-After'),body);
      }
      return {data:schema.parse(body),status:response.status,etag,notModified:false};
    } finally { clearTimeout(timer); }
  }
  const geometry = (query: object = {}) => ({geometryFormat:'OBJECT',...query});
  const api = {
    listEvents: (query: EventQuery = {}, options: RequestOptions = {}) => request(`/api/v1/events`, schemas.zGridServiceListEventsResponse, geometry(query), options),
    getEvent: (id: string, query: NonNullable<T.GridServiceGetEventData['query']> = {}, options: RequestOptions = {}) => request(`/api/v1/events/${encodeURIComponent(id)}`, schemas.zGridServiceGetEventResponse, geometry(query), options),
    getEventHistory: (id: string, query: NonNullable<T.GridServiceGetEventHistoryData['query']> = {}, options: RequestOptions = {}) => request(`/api/v1/events/${encodeURIComponent(id)}/history`, schemas.zGridServiceGetEventHistoryResponse, geometry(query), options),
    listPlaces: (query: NonNullable<T.GridServiceListPlacesData['query']> = {}, options: RequestOptions = {}) => request(`/api/v1/places`, schemas.zGridServiceListPlacesResponse, geometry(query), options),
    getPlace: (place: string, options: RequestOptions = {}) => request(`/api/v1/places/${encodeURIComponent(place)}`, schemas.zGridServiceGetPlaceResponse, geometry(), options),
    resolvePlace: (query: NonNullable<T.GridServiceResolvePlaceData['query']>, options: RequestOptions = {}) => request(`/api/v1/places:resolve`, schemas.zGridServiceResolvePlaceResponse, geometry(query), options),
    getPlaceSummary: (place: string, options: RequestOptions = {}) => request(`/api/v1/places/${encodeURIComponent(place)}/summary`, schemas.zGridServiceGetPlaceSummaryResponse, {}, options),
    getConditions: (query: NonNullable<T.GridServiceGetConditionsData['query']> = {}, options: RequestOptions = {}) => request(`/api/v1/conditions`, schemas.zGridServiceGetConditionsResponse, query, options),
    listCameras: (query: NonNullable<T.GridServiceListCamerasData['query']> = {}, options: RequestOptions = {}) => request(`/api/v1/cameras`, schemas.zGridServiceListCamerasResponse, query, options),
    listScanners: (query: NonNullable<T.GridServiceListScannersData['query']> = {}, options: RequestOptions = {}) => request(`/api/v1/scanners`, schemas.zGridServiceListScannersResponse, query, options),
    listSources: (options: RequestOptions = {}) => request(`/api/v1/sources`, schemas.zGridServiceListSourcesResponse, {}, options),
    getMapLayer: (place: string, layer: MapLayer, query: NonNullable<T.GetMapLayerData['query']> = {}, options: RequestOptions = {}) => request(`/api/v1/places/${encodeURIComponent(place)}/map/${layer}.geojson`, schemas.zGetMapLayerResponse, query, options),
    listMeshLinks: (query: NonNullable<T.ListMeshLinksData['query']> = {}, options: RequestOptions = {}) => request(`/api/v1/mesh/links`, schemas.zListMeshLinksResponse, query, options),
    getMeshTelemetry: (query: NonNullable<T.GridServiceGetMeshTelemetryData['query']>, options: RequestOptions = {}) => request(`/api/v1/mesh/telemetry`, schemas.zGridServiceGetMeshTelemetryResponse, query, options),
    listHistory: (query: HistoryQuery, options: RequestOptions = {}) => {
      if(!Number.isFinite(Date.parse(query.from)) || !Number.isFinite(Date.parse(query.to)) || Date.parse(query.from)>=Date.parse(query.to)) throw new RangeError('History requires a valid explicit from < to window');
      return request('/api/v1/history', schemas.zGridServiceListHistoryResponse, geometry(query), options);
    },
  };
  return api;
}
export type SierraClient = ReturnType<typeof createSierraClient>;
/** Yields pages, including continuation tokens. A caller stopping early owns that incompleteness. */
export async function* paginate<T extends {nextPageToken:string}>(load: (pageToken?:string)=>Promise<ApiResult<T>>, maxPages = 100): AsyncGenerator<T> {
  if(!Number.isInteger(maxPages)||maxPages<1) throw new RangeError('maxPages must be a positive integer');
  let token: string | undefined;
  const seen = new Set<string>();
  for(let page=0;page<maxPages;page++) {
    const result=await load(token);
    if(result.notModified) throw new Error('Pagination cannot advance from a 304; do not pass an ETag');
    yield result.data;
    token=result.data.nextPageToken;
    if(!token)return;
    if(seen.has(token))throw new Error('API returned a repeated pagination token');
    seen.add(token);
  }
}
