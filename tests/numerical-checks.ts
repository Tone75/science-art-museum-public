import { readFileSync } from 'node:fs';
import { validateSettings, makeSettings } from '../src/config.ts';
import { validateNumericalSettings, parseNumericalSettings, serializeNumericalSettings } from '../src/numerics/contract.ts';
import type { NumericalSettings } from '../src/numerics/contract.ts';
import { juliaEscape, mandelbrotEscape, coordinateAt, computeNumericalField, UNESCAPED } from '../src/numerics/engine.ts';
import { colorizeNumericalField } from '../src/numerics/palette.ts';
import { fromLegacySettings } from '../src/numerics/legacy.ts';
import { ANALYTIC_CASES } from './reference.ts';
import { referenceJulia, referenceMandelbrot, referenceCoordinate } from './numerical-reference.ts';
import { ANALYTIC_FIXTURES, COORDINATE_FIXTURES, INVALID_INPUT_CASES, RELATION_FIXTURES, fixtureValue, numericalFixture } from './numerical-fixtures.ts';
import type { AnalyticFixture, CoordinateFixture } from './numerical-fixtures.ts';

export type CheckRecord = {
  id: string; kind: string; pass: boolean; expected?: unknown; actual?: unknown; detail?: unknown;
};
type Point = { re: number; im: number };
export type AnalyticEvaluator = (fixture: AnalyticFixture) => number | null;
export type CoordinateEvaluator = (i: number, j: number, settings: NumericalSettings) => Point;
export type PaletteEvaluator = (counts: Uint16Array, settings: NumericalSettings, palette: 'lagoon' | 'ember') => Uint8ClampedArray;

export const productionAnalytic: AnalyticEvaluator = (f) => f.mode === 'julia'
  ? juliaEscape(f.c, f.z0!, f.N) : mandelbrotEscape(f.c, f.N);
const oracleAnalytic: AnalyticEvaluator = (f) => f.mode === 'julia'
  ? referenceJulia(f.c, f.z0!, f.N) : referenceMandelbrot(f.c, f.N);

/** The same assertion helpers are applied to production and individually injected test mutants. */
export function checkAnalytic(candidate: AnalyticEvaluator, fixture: AnalyticFixture): CheckRecord {
  const actual = candidate(fixture);
  return { id: `analytic:${fixture.id}`, kind: 'analytic', pass: actual === fixture.expected, expected: fixture.expected, actual };
}

export function checkCoordinate(candidate: CoordinateEvaluator, fixture: CoordinateFixture, point: CoordinateFixture['points'][number]): CheckRecord {
  const actual = candidate(point.i, point.j, fixture.settings);
  const epsilon = (value: number) => fixture.tolerance === 'exact-binary-rational' ? 0 : 8 * Number.EPSILON * Math.max(1, Math.abs(value));
  const tolerances = { re: epsilon(point.re), im: epsilon(point.im) };
  return {
    id: `coordinate:${fixture.id}:${point.i},${point.j}`, kind: 'coordinate',
    pass: Number.isFinite(actual.re) && Number.isFinite(actual.im)
      && Math.abs(actual.re - point.re) <= tolerances.re && Math.abs(actual.im - point.im) <= tolerances.im,
    expected: { re: point.re, im: point.im }, actual: fixtureValue(actual), detail: { tolerances },
  };
}

export function checkPalettePurity(candidate: PaletteEvaluator, field: Uint16Array, settings: NumericalSettings, palette: 'lagoon' | 'ember'): CheckRecord {
  const before = Array.from(field);
  const rgba = candidate(field, settings, palette);
  const after = Array.from(field);
  return {
    id: `palette-purity:${palette}`, kind: 'palette-purity',
    pass: before.length === after.length && before.every((value, i) => value === after[i]) && rgba.length === field.length * 4,
    expected: before, actual: after, detail: { rgbaLength: rgba.length, expectedRgbaLength: field.length * 4 },
  };
}

function rejected(operation: () => unknown): { rejected: boolean; error?: string } {
  try { operation(); return { rejected: false }; }
  catch (error) { return { rejected: true, error: error instanceof Error ? error.message : String(error) }; }
}

/** Instruments explicit field-buffer constructors, restores globals even when a validator throws. */
function allocationCheck(input: unknown): { rejected: boolean; error?: string; uint16Constructions: number; arrayBufferConstructions: number } {
  const OriginalUint16 = globalThis.Uint16Array;
  const OriginalBuffer = globalThis.ArrayBuffer;
  let uint16Constructions = 0;
  let arrayBufferConstructions = 0;
  const TrackedUint16 = new Proxy(OriginalUint16, { construct(target, args) { uint16Constructions += 1; return Reflect.construct(target, args); } });
  const TrackedBuffer = new Proxy(OriginalBuffer, { construct(target, args) { arrayBufferConstructions += 1; return Reflect.construct(target, args); } });
  try {
    globalThis.Uint16Array = TrackedUint16;
    globalThis.ArrayBuffer = TrackedBuffer;
    return { ...rejected(() => computeNumericalField(input)), uint16Constructions, arrayBufferConstructions };
  } finally {
    globalThis.Uint16Array = OriginalUint16;
    globalThis.ArrayBuffer = OriginalBuffer;
  }
}

export function runMandatoryChecks(): CheckRecord[] {
  const records: CheckRecord[] = [];
  for (const fixture of ANALYTIC_FIXTURES) {
    const production = checkAnalytic(productionAnalytic, fixture);
    const oracle = checkAnalytic(oracleAnalytic, fixture);
    records.push({ ...production, pass: production.pass && oracle.pass, actual: { production: production.actual, oracle: oracle.actual } });
  }
  for (const fixture of COORDINATE_FIXTURES) for (const point of fixture.points) {
    const production = checkCoordinate(coordinateAt, fixture, point);
    const oracle = checkCoordinate(referenceCoordinate, fixture, point);
    records.push({ ...production, pass: production.pass && oracle.pass, actual: { production: production.actual, oracle: oracle.actual } });
  }
  const calibration = allocationCheck(numericalFixture({ width: 1, height: 1, maxIterations: 0 }));
  records.push({ id: 'allocation-spy-calibration', kind: 'input-validation', pass: !calibration.rejected && calibration.uint16Constructions === 1, expected: { rejected: false, uint16Constructions: 1 }, actual: calibration });
  for (const fixture of INVALID_INPUT_CASES) {
    const result = allocationCheck(fixture.build());
    records.push({
      id: `reject:${fixture.id}`, kind: 'input-validation',
      pass: result.rejected && result.uint16Constructions === 0 && result.arrayBufferConstructions === 0,
      expected: fixture.expected, actual: result, detail: fixture.description,
    });
  }

  const scalarInvalid: { id: string; invoke: () => unknown }[] = [
    { id: 'julia-c-outside', invoke: () => juliaEscape({ re: 3, im: 0 }, { re: 0, im: 0 }, 1) },
    { id: 'julia-c-nan', invoke: () => juliaEscape({ re: Number.NaN, im: 0 }, { re: 0, im: 0 }, 1) },
    { id: 'julia-initial-infinity', invoke: () => juliaEscape({ re: 0, im: 0 }, { re: 0, im: Number.POSITIVE_INFINITY }, 1) },
    { id: 'julia-fraction-N', invoke: () => juliaEscape({ re: 0, im: 0 }, { re: 0, im: 0 }, 1.5) },
    { id: 'julia-over-N', invoke: () => juliaEscape({ re: 0, im: 0 }, { re: 0, im: 0 }, 513) },
    { id: 'mandelbrot-c-nan', invoke: () => mandelbrotEscape({ re: 0, im: Number.NaN }, 1) },
    { id: 'mandelbrot-c-infinity', invoke: () => mandelbrotEscape({ re: Number.NEGATIVE_INFINITY, im: 0 }, 1) },
    { id: 'mandelbrot-negative-N', invoke: () => mandelbrotEscape({ re: 3, im: 0 }, -1) },
    { id: 'mandelbrot-over-N', invoke: () => mandelbrotEscape({ re: 3, im: 0 }, 513) },
    { id: 'mandelbrot-fraction-N', invoke: () => mandelbrotEscape({ re: 3, im: 0 }, 1.5) },
  ];
  for (const fixture of scalarInvalid) {
    const actual = rejected(fixture.invoke);
    records.push({ id: `scalar-reject:${fixture.id}`, kind: 'scalar-validation', pass: actual.rejected, expected: 'reject', actual });
  }
  for (const [i, j, id] of [[-1, 0, 'negative-i'], [0, -1, 'negative-j'], [3, 0, 'i-width'], [0, 2, 'j-height'], [0.5, 0, 'fraction-i'], [0, 0.5, 'fraction-j'], [Number.NaN, 0, 'nan-i'], [0, Number.POSITIVE_INFINITY, 'infinite-j']] as const) {
    const actual = rejected(() => coordinateAt(i, j, numericalFixture()));
    records.push({ id: `coordinate-reject:${id}`, kind: 'coordinate-validation', pass: actual.rejected, expected: 'reject', actual });
  }
  const legacy = makeSettings('cpu-worker', { re: -0.8, im: 0.156 }, 2, 128);
  const legacyInvalid = [
    { id: 'new-contract', input: numericalFixture() },
    { id: 'rectangle', input: { ...legacy, width: 3, height: 2 } },
    { id: 'viewport', input: { ...legacy, viewport: { ...legacy.viewport, reMin: -2 } } },
    { id: 'over-N', input: { ...legacy, maxIterations: 513 } },
    { id: 'precision', input: { ...legacy, renderer: { ...legacy.renderer, precision: 'highp-float32' } } },
    { id: 'extra-mode', input: { ...legacy, mode: 'julia' } },
    { id: 'c-outside', input: { ...legacy, c: { re: 3, im: 0 } } },
  ];
  for (const fixture of legacyInvalid) {
    const actual = rejected(() => validateSettings(fixture.input));
    records.push({ id: `legacy-v1-reject:${fixture.id}`, kind: 'legacy-contract', pass: actual.rejected, expected: 'reject under unchanged v1 contract', actual });
  }
  const mapped = fromLegacySettings(legacy);
  const legacyRoundTrip = validateNumericalSettings(mapped);
  records.push({ id: 'legacy-cpu-adapter', kind: 'legacy-contract', pass: mapped.mode === 'julia' && mapped.width === legacy.width && mapped.height === legacy.height && mapped.maxIterations === legacy.maxIterations && JSON.stringify(mapped) === JSON.stringify(legacyRoundTrip), expected: 'strict v1 CPU settings map to the new Julia contract', actual: mapped });
  const gpuAdapter = rejected(() => fromLegacySettings(makeSettings('webgl2', { re: 0, im: 0 }, 2, 128)));
  records.push({ id: 'legacy-gpu-adapter-rejected', kind: 'legacy-contract', pass: gpuAdapter.rejected, expected: 'reject; no GPU success substitution', actual: gpuAdapter });

  for (const [id, settings] of [
    ['width-max-height-min', numericalFixture({ width: 768, height: 1, maxIterations: 0, viewport: { reMin: -4, reMax: 4, imMin: -0.125, imMax: 0.125 } })],
    ['height-max-width-min', numericalFixture({ width: 1, height: 768, maxIterations: 0, viewport: { reMin: -0.125, reMax: 0.125, imMin: -4, imMax: 4 } })],
    ['one-pixel-N0', numericalFixture({ width: 1, height: 1, maxIterations: 0 })],
  ] as const) {
    const field = computeNumericalField(settings);
    records.push({ id: `valid-endpoint:${id}`, kind: 'input-validation', pass: field.length === settings.width * settings.height, expected: settings.width * settings.height, actual: field.length });
  }
  const synthetic = new Uint16Array([0, 1, 255, 256, 512, UNESCAPED]);
  const syntheticSettings = numericalFixture({ maxIterations: 512 });
  for (const palette of ['lagoon', 'ember'] as const) records.push(checkPalettePurity(colorizeNumericalField, synthetic, syntheticSettings, palette));
  const encoded = Array.from(synthetic);
  records.push({ id: 'sentinel-representations', kind: 'sentinel', pass: UNESCAPED === 65535 && new Set(encoded).size === 6 && encoded.every((value, index) => value === [0, 1, 255, 256, 512, 65535][index]), expected: [0, 1, 255, 256, 512, 65535], actual: encoded });

  for (const [id, settings, expected] of [
    ['julia-last-n', numericalFixture({ width: 1, height: 1, c: { re: 1, im: 0 }, maxIterations: 3 }), 3],
    ['julia-unescaped', numericalFixture({ width: 1, height: 1, c: { re: 1, im: 0 }, maxIterations: 2 }), UNESCAPED],
    ['mandelbrot-outside-c', { contractVersion: 'SAM-003-N-v1', mode: 'mandelbrot', precision: 'float64', width: 1, height: 1, maxIterations: 1, escapeRadius: 2, pixelSampling: 'center-top-left-y-up', viewport: { reMin: 2.5, reMax: 3.5, imMin: -0.5, imMax: 0.5 } } as NumericalSettings, 1],
  ] as const) {
    const actual = Array.from(computeNumericalField(settings));
    records.push({ id: `field-mode:${id}`, kind: 'field-mode', pass: actual.length === 1 && actual[0] === expected, expected: [expected], actual });
  }
  for (const [id, json] of [['syntax', 'not JSON'], ['nonfinite', '{"value":Infinity}'], ['unsupported', '{}']] as const) {
    const actual = rejected(() => parseNumericalSettings(json));
    records.push({ id: `json-reject:${id}`, kind: 'serialization', pass: actual.rejected, expected: 'reject', actual });
  }
  const roundTrip = parseNumericalSettings(serializeNumericalSettings(numericalFixture()));
  records.push({ id: 'json-internal-roundtrip', kind: 'serialization', pass: JSON.stringify(roundTrip) === JSON.stringify(validateNumericalSettings(numericalFixture())), expected: validateNumericalSettings(numericalFixture()), actual: roundTrip });
  const preservedLegacy = ANALYTIC_CASES.every((old, index) => {
    const next = ANALYTIC_FIXTURES[index]!;
    return old.re === next.z0!.re && old.im === next.z0!.im && old.c.re === next.c.re && old.c.im === next.c.im && old.N === next.N && old.expected === next.expected;
  });
  records.push({ id: 'legacy-12-fixtures-preserved', kind: 'legacy-contract', pass: preservedLegacy, expected: 'all original twelve fixture data unchanged', actual: { oldCount: ANALYTIC_CASES.length, preserved: preservedLegacy } });
  const oracleSource = readFileSync(new URL('./numerical-reference.ts', import.meta.url), 'utf8');
  const runtimeImports = oracleSource.split('\n').filter((line) => /^\s*import\s/.test(line) && !/^\s*import\s+type\b/.test(line));
  records.push({ id: 'oracle-runtime-independence', kind: 'oracle-source', pass: runtimeImports.length === 0, expected: 'zero runtime imports in independent oracle', actual: { runtimeImports } });
  return records;
}

export function runRelationChecks(): CheckRecord[] {
  const records: CheckRecord[] = [];
  for (const fixture of RELATION_FIXTURES.increasingN) {
    const trace = fixture.Ns.map((N) => ({ N, value: fixture.mode === 'julia'
      ? juliaEscape(fixture.c, (fixture as { z0: Point }).z0, N) : mandelbrotEscape(fixture.c, N) }));
    const pass = trace.every(({ N, value }) => value === (fixture.expectedFirst !== null && N >= fixture.expectedFirst ? fixture.expectedFirst : null));
    records.push({ id: `relation:increasing-N:${fixture.id}`, kind: 'mathematical-relation', pass, expected: { firstEscape: fixture.expectedFirst, rule: 'first escape remains unchanged as N increases' }, actual: trace });
  }
  for (const fixture of RELATION_FIXTURES.conjugates) {
    const cConjugate = { re: fixture.c.re, im: -fixture.c.im };
    const z0 = (fixture as { z0?: Point }).z0;
    const actual = fixture.mode === 'julia' ? juliaEscape(fixture.c, z0!, fixture.N) : mandelbrotEscape(fixture.c, fixture.N);
    const conjugate = fixture.mode === 'julia' ? juliaEscape(cConjugate, { re: z0!.re, im: -z0!.im }, fixture.N) : mandelbrotEscape(cConjugate, fixture.N);
    records.push({ id: `relation:conjugation:${fixture.id}`, kind: 'mathematical-relation', pass: actual === conjugate, expected: 'equal first escape for conjugate binary-rational inputs', actual: { original: actual, conjugate } });
  }
  for (const [index, c] of RELATION_FIXTURES.commonMode.entries()) {
    const trace = RELATION_FIXTURES.commonModeNs.map((N) => ({ N, julia: juliaEscape(c, { re: 0, im: 0 }, N), mandelbrot: mandelbrotEscape(c, N) }));
    records.push({ id: `relation:common-domain:${index}`, kind: 'mathematical-relation', pass: trace.every((point) => point.julia === point.mandelbrot), expected: 'M(c) equals Julia(c,z0=0) on their common valid c domain', actual: { c, trace } });
  }
  return records;
}
