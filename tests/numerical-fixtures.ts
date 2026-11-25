import type { NumericalSettings } from '../src/numerics/contract.ts';

export type ComplexFixture = { re: number; im: number };
export type AnalyticFixture = {
  id: string; mode: 'julia' | 'mandelbrot'; c: ComplexFixture; z0?: ComplexFixture; N: number; expected: number | null;
};

/** The first twelve entries cover independently known cases. */
export const ANALYTIC_FIXTURES: readonly AnalyticFixture[] = [
  { id: 'legacy-01-c0-critical', mode: 'julia', c: { re: 0, im: 0 }, z0: { re: 0, im: 0 }, N: 256, expected: null },
  { id: 'legacy-02-minus1-two-cycle', mode: 'julia', c: { re: -1, im: 0 }, z0: { re: 0, im: 0 }, N: 256, expected: null },
  { id: 'legacy-03-plus1-n3', mode: 'julia', c: { re: 1, im: 0 }, z0: { re: 0, im: 0 }, N: 3, expected: 3 },
  { id: 'legacy-04-plus1-n2', mode: 'julia', c: { re: 1, im: 0 }, z0: { re: 0, im: 0 }, N: 2, expected: null },
  { id: 'legacy-05-minus2-equality', mode: 'julia', c: { re: -2, im: 0 }, z0: { re: 0, im: 0 }, N: 256, expected: null },
  { id: 'legacy-06-unit-fixed', mode: 'julia', c: { re: 0, im: 0 }, z0: { re: 1, im: 0 }, N: 512, expected: null },
  { id: 'legacy-07-radius-equality-n0', mode: 'julia', c: { re: 0, im: 0 }, z0: { re: 2, im: 0 }, N: 0, expected: null },
  { id: 'legacy-08-escape-last-n1', mode: 'julia', c: { re: 0, im: 0 }, z0: { re: 2, im: 0 }, N: 1, expected: 1 },
  { id: 'legacy-09-initial-outside', mode: 'julia', c: { re: 0, im: 0 }, z0: { re: 3, im: 0 }, N: 0, expected: 0 },
  { id: 'legacy-10-inside-n0', mode: 'julia', c: { re: 1, im: 0 }, z0: { re: 0, im: 0 }, N: 0, expected: null },
  { id: 'legacy-11-imaginary-equality', mode: 'julia', c: { re: 0, im: 0 }, z0: { re: 0, im: 2 }, N: 1, expected: 1 },
  { id: 'legacy-12-negative-equality', mode: 'julia', c: { re: 0, im: 0 }, z0: { re: -2, im: 0 }, N: 1, expected: 1 },
  { id: 'julia-i-critical-n0', mode: 'julia', c: { re: 0, im: 1 }, z0: { re: 0, im: 0 }, N: 0, expected: null },
  { id: 'julia-i-critical-cycle', mode: 'julia', c: { re: 0, im: 1 }, z0: { re: 0, im: 0 }, N: 512, expected: null },
  { id: 'julia-unit-minus', mode: 'julia', c: { re: 0, im: 0 }, z0: { re: 1 - 2 ** -10, im: 0 }, N: 512, expected: null },
  { id: 'julia-unit-plus-n9', mode: 'julia', c: { re: 0, im: 0 }, z0: { re: 1 + 2 ** -10, im: 0 }, N: 9, expected: null },
  { id: 'julia-unit-plus-n10', mode: 'julia', c: { re: 0, im: 0 }, z0: { re: 1 + 2 ** -10, im: 0 }, N: 10, expected: 10 },
  { id: 'julia-unit-plus-n512', mode: 'julia', c: { re: 0, im: 0 }, z0: { re: 1 + 2 ** -10, im: 0 }, N: 512, expected: 10 },
  { id: 'mandelbrot-plus2-n1', mode: 'mandelbrot', c: { re: 2, im: 0 }, N: 1, expected: null },
  { id: 'mandelbrot-plus2-n2', mode: 'mandelbrot', c: { re: 2, im: 0 }, N: 2, expected: 2 },
  { id: 'mandelbrot-minus2', mode: 'mandelbrot', c: { re: -2, im: 0 }, N: 512, expected: null },
  { id: 'mandelbrot-plus1-n2', mode: 'mandelbrot', c: { re: 1, im: 0 }, N: 2, expected: null },
  { id: 'mandelbrot-plus1-n3', mode: 'mandelbrot', c: { re: 1, im: 0 }, N: 3, expected: 3 },
  { id: 'mandelbrot-outside-julia-c-domain', mode: 'mandelbrot', c: { re: 3, im: 0 }, N: 1, expected: 1 },
];

export function numericalFixture(overrides: Record<string, unknown> = {}): NumericalSettings {
  return {
    contractVersion: 'SAM-003-N-v1', mode: 'julia', precision: 'float64',
    width: 3, height: 2, maxIterations: 32, escapeRadius: 2, pixelSampling: 'center-top-left-y-up',
    viewport: { reMin: -2, reMax: 2, imMin: -1, imMax: 1 }, c: { re: 0, im: 0 }, ...overrides,
  } as NumericalSettings;
}

export type CoordinateFixture = {
  id: string; settings: NumericalSettings; tolerance: 'exact-binary-rational' | '8-epsilon-relative';
  points: readonly { i: number; j: number; re: number; im: number }[];
};

/** Coordinates below are hand-computed, not obtained by calling either coordinate implementation. */
export const COORDINATE_FIXTURES: readonly CoordinateFixture[] = [
  { id: 'one-pixel-asymmetric', settings: numericalFixture({ width: 1, height: 1, viewport: { reMin: -2, reMax: -1, imMin: 0.5, imMax: 1.5 } }), tolerance: 'exact-binary-rational', points: [{ i: 0, j: 0, re: -1.5, im: 1 }] },
  { id: 'three-by-two', settings: numericalFixture({ width: 3, height: 2, viewport: { reMin: -1.5, reMax: 1.5, imMin: -1, imMax: 1 } }), tolerance: 'exact-binary-rational', points: [
    { i: 0, j: 0, re: -1, im: 0.5 }, { i: 1, j: 0, re: 0, im: 0.5 }, { i: 2, j: 0, re: 1, im: 0.5 },
    { i: 0, j: 1, re: -1, im: -0.5 }, { i: 1, j: 1, re: 0, im: -0.5 }, { i: 2, j: 1, re: 1, im: -0.5 },
  ] },
  { id: 'two-by-three-independent-aspect', settings: numericalFixture({ width: 2, height: 3, viewport: { reMin: -2, reMax: 2, imMin: -0.75, imMax: 0.75 } }), tolerance: 'exact-binary-rational', points: [
    { i: 0, j: 0, re: -1, im: 0.5 }, { i: 1, j: 0, re: 1, im: 0.5 },
    { i: 0, j: 1, re: -1, im: 0 }, { i: 1, j: 1, re: 1, im: 0 },
    { i: 0, j: 2, re: -1, im: -0.5 }, { i: 1, j: 2, re: 1, im: -0.5 },
  ] },
  { id: 'asymmetric-three-by-two', settings: numericalFixture({ width: 3, height: 2, viewport: { reMin: -2, reMax: 1, imMin: -0.5, imMax: 1.5 } }), tolerance: 'exact-binary-rational', points: [
    { i: 0, j: 0, re: -1.5, im: 1 }, { i: 1, j: 0, re: -0.5, im: 1 }, { i: 2, j: 0, re: 0.5, im: 1 },
    { i: 0, j: 1, re: -1.5, im: 0 }, { i: 1, j: 1, re: -0.5, im: 0 }, { i: 2, j: 1, re: 0.5, im: 0 },
  ] },
  { id: 'general-eight-epsilon', settings: numericalFixture({ width: 7, height: 5, viewport: { reMin: -0.7, reMax: 1.1, imMin: -1.3, imMax: 0.9 } }), tolerance: '8-epsilon-relative', points: [
    { i: 0, j: 0, re: -0.5714285714285714, im: 0.68 },
    { i: 3, j: 2, re: 0.2, im: -0.2 },
    { i: 6, j: 4, re: 0.9714285714285714, im: -1.08 },
  ] },
];

type InvalidInputCase = { id: string; description: string; build: () => unknown; expected: 'reject-before-buffer' };
const invalid = (id: string, description: string, build: () => unknown): InvalidInputCase => ({ id, description, build, expected: 'reject-before-buffer' });
const patch = (values: Record<string, unknown>): unknown => ({ ...numericalFixture(), ...values });
const viewportPatch = (values: Record<string, unknown>): unknown => patch({ viewport: { ...numericalFixture().viewport, ...values } });

export const INVALID_INPUT_CASES: readonly InvalidInputCase[] = [
  invalid('null', 'null settings', () => null), invalid('array', 'array settings', () => []), invalid('empty', 'empty object', () => ({})),
  invalid('version-unknown', 'unsupported contract version', () => patch({ contractVersion: 'future' })),
  invalid('version-missing', 'missing contract version', () => { const v = { ...numericalFixture() } as Record<string, unknown>; delete v.contractVersion; return v; }),
  invalid('mode-unknown', 'unknown mode', () => patch({ mode: 'other' })), invalid('mode-missing', 'missing mode', () => { const v = { ...numericalFixture() } as Record<string, unknown>; delete v.mode; return v; }),
  invalid('precision', 'unsupported precision', () => patch({ precision: 'float32' })),
  invalid('extra-key', 'unknown enumerable key', () => patch({ extra: true })),
  invalid('symbol-key', 'unknown symbol key', () => ({ ...numericalFixture(), [Symbol('unknown')]: true })),
  invalid('hidden-key', 'unknown nonenumerable key', () => Object.defineProperty({ ...numericalFixture() }, 'hidden', { value: 1 })),
  ...(['width', 'height'] as const).flatMap((axis) => [
    invalid(`${axis}-zero`, `${axis}=0`, () => patch({ [axis]: 0 })), invalid(`${axis}-over`, `${axis}=769`, () => patch({ [axis]: 769 })),
    invalid(`${axis}-fraction`, `${axis}=1.5`, () => patch({ [axis]: 1.5 })), invalid(`${axis}-nan`, `${axis}=NaN (tagged)`, () => patch({ [axis]: Number.NaN })),
    invalid(`${axis}-infinity`, `${axis}=+Infinity (tagged)`, () => patch({ [axis]: Number.POSITIVE_INFINITY })), invalid(`${axis}-string`, `${axis} is a numeric string`, () => patch({ [axis]: '2' })),
  ]),
  ...[[-1, 'negative'], [513, 'over'], [1.5, 'fraction'], [Number.NaN, 'nan'], [Number.POSITIVE_INFINITY, 'infinity']].map(([value, id]) => invalid(`iterations-${id}`, `N=${id}`, () => patch({ maxIterations: value }))),
  invalid('radius', 'R must remain 2', () => patch({ escapeRadius: 3 })), invalid('sampling', 'corner sampling is unsupported', () => patch({ pixelSampling: 'corner' })),
  invalid('viewport-null', 'null viewport', () => patch({ viewport: null })), invalid('viewport-missing', 'missing endpoint', () => patch({ viewport: { reMin: -2, reMax: 2, imMin: -1 } })),
  invalid('viewport-extra', 'unknown viewport key', () => viewportPatch({ extra: 0 })),
  invalid('viewport-reversed-real', 'real endpoints reversed', () => viewportPatch({ reMin: 2, reMax: -2 })),
  invalid('viewport-reversed-imag', 'imaginary endpoints reversed', () => viewportPatch({ imMin: 1, imMax: -1 })),
  invalid('viewport-equal', 'zero real span', () => viewportPatch({ reMin: 0, reMax: 0 })),
  invalid('viewport-span-real', 'real span 0.125 below 0.25', () => viewportPatch({ reMin: 0, reMax: 0.125 })),
  invalid('viewport-span-imag', 'imaginary span 0.125 below 0.25', () => viewportPatch({ imMin: 0, imMax: 0.125 })),
  invalid('viewport-below', 'endpoint below -4', () => viewportPatch({ reMin: -4.25 })), invalid('viewport-above', 'endpoint above 4', () => viewportPatch({ imMax: 4.25 })),
  invalid('viewport-nan', 'viewport endpoint NaN (tagged)', () => viewportPatch({ reMin: Number.NaN })),
  invalid('viewport-infinity', 'viewport endpoint +Infinity (tagged)', () => viewportPatch({ imMax: Number.POSITIVE_INFINITY })),
  invalid('viewport-string', 'viewport endpoint string', () => viewportPatch({ reMin: '-2' })),
  invalid('julia-c-missing', 'Julia requires c', () => { const v = { ...numericalFixture() } as Record<string, unknown>; delete v.c; return v; }),
  invalid('julia-c-null', 'null c', () => patch({ c: null })), invalid('julia-c-component-missing', 'missing c.im', () => patch({ c: { re: 0 } })),
  invalid('julia-c-extra', 'unknown c key', () => patch({ c: { re: 0, im: 0, extra: 1 } })),
  invalid('julia-c-nan', 'c.re NaN (tagged)', () => patch({ c: { re: Number.NaN, im: 0 } })),
  invalid('julia-c-infinity', 'c.im +Infinity (tagged)', () => patch({ c: { re: 0, im: Number.POSITIVE_INFINITY } })),
  invalid('julia-c-outside-real', 'Julia c=3 rejected', () => patch({ c: { re: 3, im: 0 } })),
  invalid('julia-c-outside-complex', 'Julia |1.5+1.5i|>2 rejected', () => patch({ c: { re: 1.5, im: 1.5 } })),
  invalid('mandelbrot-fixed-c', 'Mandelbrot field forbids fixed c', () => patch({ mode: 'mandelbrot' })),
  invalid('legacy-schema', 'schemaVersion=1 is not the new internal contract', () => ({ schemaVersion: 1, mode: 'julia' })),
];

export const RELATION_FIXTURES = {
  increasingN: [
    { id: 'julia-radius', mode: 'julia', c: { re: 0, im: 0 }, z0: { re: 2, im: 0 }, Ns: [0, 1, 2, 8], expectedFirst: 1 },
    { id: 'julia-plus1', mode: 'julia', c: { re: 1, im: 0 }, z0: { re: 0, im: 0 }, Ns: [0, 1, 2, 3, 16], expectedFirst: 3 },
    { id: 'julia-unit-plus', mode: 'julia', c: { re: 0, im: 0 }, z0: { re: 1 + 2 ** -10, im: 0 }, Ns: [9, 10, 16, 512], expectedFirst: 10 },
    { id: 'mandelbrot-plus2', mode: 'mandelbrot', c: { re: 2, im: 0 }, Ns: [0, 1, 2, 3, 16], expectedFirst: 2 },
    { id: 'mandelbrot-plus3', mode: 'mandelbrot', c: { re: 3, im: 0 }, Ns: [0, 1, 2, 16], expectedFirst: 1 },
    { id: 'mandelbrot-minus2', mode: 'mandelbrot', c: { re: -2, im: 0 }, Ns: [0, 1, 2, 16, 512], expectedFirst: null },
  ],
  conjugates: [
    { id: 'julia-interior', mode: 'julia', c: { re: -0.75, im: 0.125 }, z0: { re: 0.25, im: 0.5 }, N: 128 },
    { id: 'julia-exterior', mode: 'julia', c: { re: 0.5, im: 0.25 }, z0: { re: 1.5, im: 0.5 }, N: 128 },
    { id: 'julia-imaginary', mode: 'julia', c: { re: 0, im: 1 }, z0: { re: 0, im: 0 }, N: 512 },
    { id: 'mandelbrot-interior', mode: 'mandelbrot', c: { re: -0.5, im: 0.25 }, N: 256 },
    { id: 'mandelbrot-exterior', mode: 'mandelbrot', c: { re: 0.75, im: 0.5 }, N: 128 },
    { id: 'mandelbrot-outside-julia-domain', mode: 'mandelbrot', c: { re: 2.5, im: 0.5 }, N: 128 },
  ],
  commonMode: [
    { re: 0, im: 0 }, { re: -1, im: 0 }, { re: 1, im: 0 }, { re: -0.8, im: 0.156 },
    { re: 0.285, im: 0.01 }, { re: -2, im: 0 }, { re: 0, im: 1 },
  ],
  commonModeNs: [0, 2, 3, 128, 512],
} as const;

/** Static planned denominators: constructing this plan executes no numerical calculation. */
export const CHECK_PLAN = {
  mandatory: [
    ...ANALYTIC_FIXTURES.map((fixture) => `analytic:${fixture.id}`),
    ...COORDINATE_FIXTURES.flatMap((fixture) => fixture.points.map((point) => `coordinate:${fixture.id}:${point.i},${point.j}`)),
    'allocation-spy-calibration',
    ...INVALID_INPUT_CASES.map((fixture) => `reject:${fixture.id}`),
    ...['julia-c-outside', 'julia-c-nan', 'julia-initial-infinity', 'julia-fraction-N', 'julia-over-N', 'mandelbrot-c-nan', 'mandelbrot-c-infinity', 'mandelbrot-negative-N', 'mandelbrot-over-N', 'mandelbrot-fraction-N'].map((id) => `scalar-reject:${id}`),
    ...['negative-i', 'negative-j', 'i-width', 'j-height', 'fraction-i', 'fraction-j', 'nan-i', 'infinite-j'].map((id) => `coordinate-reject:${id}`),
    ...['new-contract', 'rectangle', 'viewport', 'over-N', 'precision', 'extra-mode', 'c-outside'].map((id) => `legacy-v1-reject:${id}`),
    'legacy-cpu-adapter', 'legacy-gpu-adapter-rejected',
    ...['width-max-height-min', 'height-max-width-min', 'one-pixel-N0'].map((id) => `valid-endpoint:${id}`),
    'palette-purity:lagoon', 'palette-purity:ember', 'sentinel-representations',
    ...['julia-last-n', 'julia-unescaped', 'mandelbrot-outside-c'].map((id) => `field-mode:${id}`),
    'json-reject:syntax', 'json-reject:nonfinite', 'json-reject:unsupported', 'json-internal-roundtrip',
    'legacy-12-fixtures-preserved', 'oracle-runtime-independence',
  ],
  relations: [
    ...RELATION_FIXTURES.increasingN.map((fixture) => `relation:increasing-N:${fixture.id}`),
    ...RELATION_FIXTURES.conjugates.map((fixture) => `relation:conjugation:${fixture.id}`),
    ...RELATION_FIXTURES.commonMode.map((_, index) => `relation:common-domain:${index}`),
  ],
  mutations: [
    { id: 'radius-greater-or-equal', targetCheckId: 'analytic:legacy-07-radius-equality-n0' },
    { id: 'omit-final-N', targetCheckId: 'analytic:legacy-03-plus1-n3' },
    { id: 'pixel-corner', targetCheckId: 'coordinate:one-pixel-asymmetric:0,0' },
    { id: 'omit-y-flip', targetCheckId: 'coordinate:asymmetric-three-by-two:0,0' },
    { id: 'mandelbrot-start-at-c', targetCheckId: 'analytic:mandelbrot-plus2-n2' },
    { id: 'palette-mutates-field', targetCheckId: 'palette-purity:lagoon' },
  ],
} as const;

/** JSON-safe tags preserve nonfinite test inputs instead of silently serializing them as null. */
export function fixtureValue(value: unknown): unknown {
  if (typeof value === 'number' && !Number.isFinite(value)) return { numericTag: String(value) };
  if (Array.isArray(value)) return value.map(fixtureValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Reflect.ownKeys(value).map((key) => [typeof key === 'symbol' ? `symbol:${key.description}` : key, fixtureValue((value as Record<PropertyKey, unknown>)[key])]));
  }
  return value;
}

export function fixtureManifest(): unknown {
  return {
    analytic: ANALYTIC_FIXTURES, coordinate: COORDINATE_FIXTURES,
    invalid: INVALID_INPUT_CASES.map(({ id, description, expected, build }) => ({ id, description, expected, input: fixtureValue(build()) })),
    relations: RELATION_FIXTURES,
    checkPlan: CHECK_PLAN,
    coordinateTolerance: '8 * Number.EPSILON * max(1, abs(expected)), exact hand-computed binary-rational fixtures use zero tolerance',
  };
}
