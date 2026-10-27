/**
 * Compile-time guard that src/types.ts matches the backend's Pydantic schemas (via src/generated/api.ts).
 * Pydantic silently drops unknown fields, so a field added on only one side would be lost on save;
 * these checks make `tsc` fail instead. Regenerate the API types with `npm run gen:api`.
 */
import type { components } from '../generated/api';
import type { ElementCategory, KitchenItem, ProjectData, Room, TallZoneConfig, TallZoneType, WallRun } from '../types';

type S = components['schemas'];

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type SchemaSyncChecks = [
  // Same field names on both sides.
  Expect<Equal<keyof KitchenItem, keyof S['KitchenItem']>>,
  Expect<Equal<keyof TallZoneConfig, keyof S['TallZoneConfig']>>,
  Expect<Equal<keyof WallRun, keyof S['WallRun-Input']>>,
  Expect<Equal<keyof Room, keyof S['Room']>>,
  Expect<Equal<keyof ProjectData, keyof S['ProjectData-Input']>>,
  // Same enum values on both sides.
  Expect<Equal<ElementCategory, S['KitchenItem']['category']>>,
  Expect<Equal<TallZoneType, S['TallZoneConfig']['type']>>,
  // Everything the client saves passes server validation.
  Expect<ProjectData extends S['ProjectData-Input'] ? true : false>,
];
