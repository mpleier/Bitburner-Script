import type { NS } from "../defs.d";

/**
 * defs.d.ts declares most of its enum types without exporting them, so we
 * recover the ones we need either from the `ns.enums` object or from the
 * signature of the API function that accepts them. This keeps every name we
 * hand to the API type-checked instead of a loose string.
 */
type Enums = NS["enums"];

export type CityName = Enums["CityName"][keyof Enums["CityName"]];
export type CrimeType = Enums["CrimeType"][keyof Enums["CrimeType"]];
export type GymType = Enums["GymType"][keyof Enums["GymType"]];
export type FactionWorkType = Enums["FactionWorkType"][keyof Enums["FactionWorkType"]];
export type JobField = Enums["JobField"][keyof Enums["JobField"]];
export type CompanyName = Enums["CompanyName"][keyof Enums["CompanyName"]];
export type FactionName = Enums["FactionName"][keyof Enums["FactionName"]];
export type LocationName = Enums["LocationName"][keyof Enums["LocationName"]];
export type UniversityClassType = Enums["UniversityClassType"][keyof Enums["UniversityClassType"]];
export type GangTaskName = Enums["GangTaskName"][keyof Enums["GangTaskName"]];
export type BladeburnerActionType = Enums["BladeburnerActionType"][keyof Enums["BladeburnerActionType"]];

export type BladeburnerSkillName = Parameters<NS["bladeburner"]["upgradeSkill"]>[0];
export type CorpIndustryName = Parameters<NS["corporation"]["expandIndustry"]>[0];
export type SleevePerson = ReturnType<NS["sleeve"]["getSleeve"]>;