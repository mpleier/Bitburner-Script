/**
 * enumcheck.mjs
 * ============================================================================
 * Bitburner validates most "name" arguments against an enum at runtime:
 *
 *   src/utils/EnumHelper.ts -> nsGetMember() throws
 *     "Argument <arg> should be a <Enum> enum member. Provided value: \"...\""
 *
 * and then aborts the script. That is exactly what happened when crime.ts passed
 * the long-removed "Shadow Blade" to singularity.getAugmentationPrereq.
 *
 * The trap: ns.enums only exposes a *subset* of those enums (no AugmentationName,
 * no BladeburnerContractName, no IndustryType...), so a script that hardcodes a
 * name has no way to verify it.
 *
 * This tool parses every enum out of defs.d.ts, walks the AST of every script and
 * resolves the arguments of enum-validated API calls. Anything that is a literal -
 * or a literal array feeding a literal index - must be a member of the enum.
 *
 * Run: node enumcheck.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { transformSync } from "@swc/core";
import * as acorn from "acorn";
import * as walk from "acorn-walk";

const SCRIPTS = path.join(process.cwd(), "scripts");

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */
/**
 * Every enum-ish type in defs.d.ts: both `type XEnumType = { a: "a" }` blocks and
 * `type X = "a" | "b"` unions. Keys drop the "EnumType" suffix so they match the
 * names the game uses in its error messages.
 */
function parseEnums(defsPath) {
  const src = fs.readFileSync(defsPath, "utf8");
  const enums = {};
  for (const m of src.matchAll(/(?:export\s+)?type\s+(\w+)\s*=\s*/g)) {
    const raw = m[1];
    const name = raw.replace(/EnumType$/, "");
    let i = m.index + m[0].length;
    let depth = 0;
    let body = "";
    while (i < src.length) {
      const ch = src[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ";" && depth === 0) break;
      body += ch;
      i += 1;
    }
    const values = [...body.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    if (values.length === 0) continue;
    for (const key of [raw, name]) {
      enums[key] = new Set([...(enums[key] || []), ...values]);
    }
  }
  // `type CrimeType = _ValueOf<CrimeEnumType>`: give the public name the same
  // members as the block it is derived from.
  for (const m of src.matchAll(/type\s+(\w+)\s*=\s*_ValueOf<(\w+)>/g)) {
    if (enums[m[2]]) enums[m[1]] = enums[m[2]];
  }
  return enums;
}

/**
 * AugmentationName is not in defs.d.ts (ns.enums does not expose it), so it has to
 * be spelled out here. Source: src/Augmentation/Enums.ts in the game repository.
 */
const AUGMENTATION_NAMES = new Set([
  "NeuroFlux Governor", "Augmented Targeting I", "Augmented Targeting II", "Augmented Targeting III",
  "Synthetic Heart", "Synfibril Muscle", "Combat Rib I", "Combat Rib II", "Combat Rib III",
  "Nanofiber Weave", "NEMEAN Subdermal Weave", "Wired Reflexes", "Graphene Bone Lacings",
  "Bionic Spine", "Graphene Bionic Spine Upgrade", "Bionic Legs", "Graphene Bionic Legs Upgrade",
  "Speech Processor Implant", "TITN-41 Gene-Modification Injection", "Enhanced Social Interaction Implant",
  "BitWire", "Artificial Bio-neural Network Implant", "Artificial Synaptic Potentiation",
  "Enhanced Myelin Sheathing", "Synaptic Enhancement Implant", "Neural-Retention Enhancement",
  "DataJack", "Embedded Netburner Module", "Embedded Netburner Module Core Implant",
  "Embedded Netburner Module Core V2 Upgrade", "Embedded Netburner Module Core V3 Upgrade",
  "Embedded Netburner Module Analyze Engine", "Embedded Netburner Module Direct Memory Access Upgrade",
  "Neuralstimulator", "Neural Accelerator", "Cranial Signal Processors - Gen I",
  "Cranial Signal Processors - Gen II", "Cranial Signal Processors - Gen III",
  "Cranial Signal Processors - Gen IV", "Cranial Signal Processors - Gen V",
  "Neuronal Densification", "Neuroreceptor Management Implant", "Nuoptimal Nootropic Injector Implant",
  "Speech Enhancement", "FocusWire", "PC Direct-Neural Interface",
  "PC Direct-Neural Interface Optimization Submodule", "PC Direct-Neural Interface NeuroNet Injector",
  "PCMatrix", "ADR-V1 Pheromone Gene", "ADR-V2 Pheromone Gene", "The Shadow's Simulacrum",
  "Hacknet Node CPU Architecture Neural-Upload", "Hacknet Node Cache Architecture Neural-Upload",
  "Hacknet Node NIC Architecture Neural-Upload", "Hacknet Node Kernel Direct-Neural Interface",
  "Hacknet Node Core Direct-Neural Interface", "Neurotrainer I", "Neurotrainer II", "Neurotrainer III",
  "HyperSight Corneal Implant", "LuminCloaking-V1 Skin Implant", "LuminCloaking-V2 Skin Implant",
  "HemoRecirculator", "SmartSonar Implant", "Power Recirculation Core", "QLink", "The Red Pill",
  "SPTN-97 Gene Modification", "ECorp HVMind Implant", "CordiARC Fusion Reactor", "SmartJaw", "Neotra",
  "Xanipher", "nextSENS Gene Modification", "OmniTek InfoLoad", "Photosynthetic Cells",
  "BitRunners Neurolink", "The Black Hand", "Unstable Circadian Modulator", "CRTX42-AA Gene Modification",
  "Neuregen Gene Modification", "CashRoot Starter Kit", "NutriGen Implant", "INFRARET Enhancement",
  "DermaForce Particle Barrier", "Graphene BrachiBlades Upgrade", "Graphene Bionic Arms Upgrade",
  "BrachiBlades", "Bionic Arms", "Social Negotiation Assistant (S.N.A)", "violet Congruity Implant",
  "Hydroflame Left Arm", "BigD's Big ... Brain", "Z.O.Ë.", "Eloquence Module", "Golden Tongue Module",
  "Glibness Enhancement", "Magnetism Amplifier", "The Illustrated Primer", "Social Dynamics Processor",
  "Neural Wit Amplifier", "EsperTech Bladeburner Eyewear", "EMS-4 Recombination", "ORION-MKIV Shoulder",
  "Hyperion Plasma Cannon V1", "Hyperion Plasma Cannon V2", "GOLEM Serum", "Vangelis Virus",
  "Vangelis Virus 3.0", "I.N.T.E.R.L.I.N.K.E.D", "Blade's Runners", "BLADE-51b Tesla Armor",
  "BLADE-51b Tesla Armor: Power Cells Upgrade", "BLADE-51b Tesla Armor: Energy Shielding Upgrade",
  "BLADE-51b Tesla Armor: Unibeam Upgrade", "BLADE-51b Tesla Armor: Omnibeam Upgrade",
  "BLADE-51b Tesla Armor: IPU Upgrade", "The Blade's Simulacrum", "Stanek's Gift - Genesis",
  "Stanek's Gift - Awakening", "Stanek's Gift - Serenity", "The W1ngs of Icarus", "The B00ts of Perseus",
  "The St4ff of Asclepius", "The H4mmer of Daedalus", "The L4w of Bayes", "The B1ade of Solomonoff",
  "The Thr3ad of Ariadne", "SoA - Might of Ares", "SoA - Wisdom of Athena", "SoA - Trickery of Hermes",
  "SoA - Beauty of Aphrodite", "SoA - Chaos of Dionysus", "SoA - Flood of Poseidon",
  "SoA - Hunt of Artemis", "SoA - Knowledge of Apollo", "SoA - phyzical WKS harmonizer",
]);

/**
 * Which argument of which API call is enum-validated, and against which enum.
 * Derived from the getEnumHelper(...) calls in the game's API wrappers.
 */
const ENUM_ARGS = {
  "singularity.getAugmentationFactions": [[0, "AugmentationName"]],
  "singularity.getAugmentationsFromFaction": [[0, "FactionName"]],
  "singularity.getAugmentationPrereq": [[0, "AugmentationName"]],
  "singularity.getAugmentationBasePrice": [[0, "AugmentationName"]],
  "singularity.getAugmentationPrice": [[0, "AugmentationName"]],
  "singularity.getAugmentationRepReq": [[0, "AugmentationName"]],
  "singularity.getAugmentationStats": [[0, "AugmentationName"]],
  "singularity.purchaseAugmentation": [[0, "FactionName"], [1, "AugmentationName"]],
  "singularity.joinFaction": [[0, "FactionName"]],
  "singularity.getFactionRep": [[0, "FactionName"]],
  "singularity.getFactionFavor": [[0, "FactionName"]],
  "singularity.getFactionFavorGain": [[0, "FactionName"]],
  "singularity.getFactionWorkTypes": [[0, "FactionName"]],
  "singularity.donateToFaction": [[0, "FactionName"]],
  "singularity.workForFaction": [[0, "FactionName"], [1, "FactionWorkType"]],
  "singularity.commitCrime": [[0, "CrimeType"]],
  "singularity.getCrimeChance": [[0, "CrimeType"]],
  "singularity.getCrimeStats": [[0, "CrimeType"]],
  "singularity.applyToCompany": [[0, "CompanyName"], [1, "JobField"]],
  "singularity.getCompanyPositionInfo": [[0, "CompanyName"], [1, "JobName"]],
  "singularity.workForCompany": [[0, "CompanyName"]],
  "singularity.quitJob": [[0, "CompanyName"]],
  "singularity.getCompanyFavor": [[0, "CompanyName"]],
  "singularity.getCompanyFavorGain": [[0, "CompanyName"]],
  "sleeve.setToGymWorkout": [[1, "LocationName"], [2, "GymType"]],
  "sleeve.setToUniversityCourse": [[1, "LocationName"], [2, "UniversityClassType"]],
  "sleeve.setToCompanyWork": [[1, "CompanyName"]],
  "sleeve.setToFactionWork": [[1, "FactionName"], [2, "FactionWorkType"]],
  "sleeve.setToBladeburnerAction": [[1, "SpecialBladeburnerActionTypeForSleeve"]],
  "sleeve.purchaseSleeveAug": [[1, "AugmentationName"]],
  "codingcontract.attempt": [[1, "CodingContractName"]],
  "bladeburner.startAction": [[0, "BladeburnerActionType"]],
  "bladeburner.getActionTime": [[0, "BladeburnerActionType"]],
  "bladeburner.getActionEstimatedSuccessChance": [[0, "BladeburnerActionType"]],
  "bladeburner.getActionRepGain": [[0, "BladeburnerActionType"]],
  "bladeburner.getActionRankGain": [[0, "BladeburnerActionType"]],
  "bladeburner.getActionRankLoss": [[0, "BladeburnerActionType"]],
  "bladeburner.getActionCountRemaining": [[0, "BladeburnerActionType"]],
  "bladeburner.getBlackOpRank": [[0, "BladeburnerBlackOpName"]],
  "bladeburner.upgradeSkill": [[0, "BladeburnerSkillName"]],
  "bladeburner.getSkillLevel": [[0, "BladeburnerSkillName"]],
  "bladeburner.getSkillUpgradeCost": [[0, "BladeburnerSkillName"]],
  "bladeburner.getCityEstimatedPopulation": [[0, "CityName"]],
  "bladeburner.getCityCommunities": [[0, "CityName"]],
  "bladeburner.getCityChaos": [[0, "CityName"]],
  "bladeburner.switchCity": [[0, "CityName"]],
  "gang.createGang": [[0, "FactionName"]],
  "gang.setMemberTask": [[1, "GangTaskName"]],
  "gang.getTaskStats": [[0, "GangTaskName"]],
  "hacknet.upgradeNode": [[0, "HacknetServerHashUpgrade"]],
  "formulas.hashCost": [[0, "HacknetServerHashUpgrade"]],
  "formulas.hashUpgradeCost": [[0, "HacknetServerHashUpgrade"]],
  "tui.toast": [[0, "ToastVariant"]],
  "go.play": [[0, "GoOpponent"]],
  "go.getBoard": [[0, "GoOpponent"]],
  "go.resetBoardState": [[0, "GoOpponent"]],
  "corporation.research": [[1, "CorpResearchName"]],
  "corporation.getResearchCost": [[1, "CorpResearchName"]],
  "corporation.hasResearched": [[1, "CorpResearchName"]],
  "corporation.unlock": [[1, "CorpUnlockName"]],
  "corporation.upgrade": [[1, "CorpUpgradeName"]],
  "corporation.getUnlockCost": [[1, "CorpUnlockName"]],
  "corporation.getUpgradeLevel": [[1, "CorpUpgradeName"]],
  "corporation.createDivision": [[1, "IndustryType"]],
  "corporation.getIndustryData": [[0, "CorpIndustryName"]],
  "corporation.expandIndustry": [[0, "CorpIndustryName"]],
  "corporation.expandCity": [[1, "CityName"]],
  "corporation.getOffice": [[1, "CityName"]],
  "corporation.getOfficeSizeUpgradeCost": [[1, "CityName"]],
  "corporation.upgradeOfficeSize": [[1, "CityName"]],
  "corporation.hireEmployee": [[1, "CityName"]],
  "corporation.setJobAssignment": [[1, "CityName"], [2, "CorpEmployeePosition"]],
  "corporation.hasWarehouse": [[1, "CityName"]],
  "corporation.purchaseWarehouse": [[1, "CityName"]],
  "corporation.getWarehouse": [[1, "CityName"]],
  "corporation.getUpgradeWarehouseCost": [[1, "CityName"]],
  "corporation.upgradeWarehouse": [[1, "CityName"]],
  "corporation.getProduct": [[1, "CityName"]],
  "corporation.makeProduct": [[1, "CityName"]],
  "corporation.sellProduct": [[1, "CityName"]],
};

/* -------------------------------------------------------------------------- */
/* AST helpers                                                                */
/* -------------------------------------------------------------------------- */
function nsPath(node) {
  if (node.object.type === "Identifier" && node.object.name === "ns") {
    return node.property.type === "Identifier" ? node.property.name : null;
  }
  if (node.object.type === "MemberExpression") {
    const parent = nsPath(node.object);
    if (parent && node.property.type === "Identifier") return parent + "." + node.property.name;
  }
  return null;
}

/** Top-level `const NAME = ["a", "b"]` arrays, so NAME[i] args can be resolved. */
function literalArrays(ast) {
  const out = new Map();
  for (const node of ast.body) {
    if (node.type !== "VariableDeclaration") continue;
    for (const decl of node.declarations) {
      if (decl.id.type !== "Identifier") continue;
      let init = decl.init;
      if (init && init.type === "BinaryExpression" && init.operator === "as") init = init.left;
      if (init && init.type === "ArrayExpression") {
        const values = init.elements
          .filter((e) => e && e.type === "Literal" && typeof e.value === "string")
          .map((e) => e.value);
        if (values.length) out.set(decl.id.name, values);
      }
    }
  }
  return out;
}

/** The string values an argument can take. Empty array means "not statically known". */
function resolveArg(arg, arrays, loopVars) {
  if (!arg) return [];
  if (arg.type === "Literal" && typeof arg.value === "string") return [arg.value];
  if (arg.type === "Identifier") {
    if (arrays.has(arg.name)) return arrays.get(arg.name);
    if (loopVars.has(arg.name)) return loopVars.get(arg.name);
    return [];
  }
  if (
    arg.type === "MemberExpression" &&
    arg.object.type === "Identifier" &&
    arrays.has(arg.object.name)
  ) {
    return arrays.get(arg.object.name); // conservative: check every element
  }
  return [];
}

/* -------------------------------------------------------------------------- */
/* Run                                                                        */
/* -------------------------------------------------------------------------- */
const ENUMS = parseEnums(path.join(process.cwd(), "defs.d.ts"));
ENUMS.AugmentationName = AUGMENTATION_NAMES;

const problems = [];

for (const file of fs.readdirSync(SCRIPTS)) {
  if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;
  const full = path.join(SCRIPTS, file);
  const js = transformSync(fs.readFileSync(full, "utf8"), {
    jsc: {
      parser: { syntax: file.endsWith(".ts") ? "typescript" : "ecmascript" },
      target: "esnext",
    },
  }).code;
  const ast = acorn.parse(js, { ecmaVersion: "latest", sourceType: "module" });
  const arrays = literalArrays(ast);
  // `for (const aug of SHADOW_AUGS)` - the loop variable can only ever take one
  // of the array's literal values, so those values must be valid too. Collect
  // these in a separate pass so they are known before the call check runs.
  const loopVars = new Map();
  walk.full(ast, (node) => {
    if (node.type !== "ForOfStatement") return;
    const right = node.right;
    const left = node.left;
    if (right.type === "Identifier" && arrays.has(right.name) && left.type === "VariableDeclaration") {
      const id = left.declarations[0].id;
      if (id.type === "Identifier") loopVars.set(id.name, arrays.get(right.name));
    }
  });

  walk.simple(ast, {
    CallExpression(node) {
      if (node.callee.type !== "MemberExpression") return;
      const dotted = nsPath(node.callee);
      if (!dotted) return;
      const spec = ENUM_ARGS[dotted];
      if (!spec) return;
      for (const [index, enumName] of spec) {
        const allowed = ENUMS[enumName];
        if (!allowed) continue; // enum not modelled, cannot check
        for (const value of resolveArg(node.arguments[index], arrays, loopVars)) {
          if (!allowed.has(value)) {
            problems.push({ file, call: dotted, arg: index, enum: enumName, value });
          }
        }
      }
    },
  });
}

console.log(`enumcheck: ${Object.keys(ENUMS).length} enums loaded (defs.d.ts + AugmentationName)`);
if (problems.length === 0) {
  console.log("OK - every hardcoded name is a valid enum member.");
} else {
  console.log(`${problems.length} hardcoded name(s) the game would reject:`);
  for (const p of problems) {
    console.log(`  ${p.file}: ${p.call}(arg ${p.arg}) -> "${p.value}" is not a ${p.enum}`);
  }
  process.exitCode = 1;
}

