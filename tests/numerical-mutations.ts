/** Six isolated test-only mutants; never patch production files or reference evidence. */
import type { NumericalSettings } from '../src/numerics/contract.ts';
import { colorizeNumericalField } from '../src/numerics/palette.ts';
import { ANALYTIC_FIXTURES, COORDINATE_FIXTURES, numericalFixture } from './numerical-fixtures.ts';
import { checkAnalytic, checkCoordinate, checkPalettePurity } from './numerical-checks.ts';
import type { CheckRecord, AnalyticEvaluator } from './numerical-checks.ts';

export type MutationResult = {
  id: string; targetCheckId: string; detected: boolean; expectedFailure: true; actualCheckPassed: boolean;
  expected: unknown; mutantActual: unknown; injection: string;
};

function orbit(c: { re: number; im: number }, z0: { re: number; im: number }, N: number, equality: boolean, omitLast: boolean): number | null {
  let x = z0.re; let y = z0.im;
  for (let n = 0; n <= N; n += 1) {
    if (omitLast && n === N) return null;
    const normSquared = x * x + y * y;
    if (equality ? normSquared >= 4 : normSquared > 4) return n;
    const real = x * x - y * y + c.re;
    y = 2 * x * y + c.im;
    x = real;
  }
  return null;
}

function evidence(id: string, injection: string, result: CheckRecord): MutationResult {
  return { id, targetCheckId: result.id, detected: !result.pass, expectedFailure: true, actualCheckPassed: result.pass, expected: result.expected, mutantActual: result.actual, injection };
}

export function runMutationChecks(): MutationResult[] {
  const radiusFixture = ANALYTIC_FIXTURES.find((f) => f.id === 'legacy-07-radius-equality-n0')!;
  const lastFixture = ANALYTIC_FIXTURES.find((f) => f.id === 'legacy-03-plus1-n3')!;
  const mandelbrotFixture = ANALYTIC_FIXTURES.find((f) => f.id === 'mandelbrot-plus2-n2')!;
  const one = COORDINATE_FIXTURES.find((f) => f.id === 'one-pixel-asymmetric')!;
  const asym = COORDINATE_FIXTURES.find((f) => f.id === 'asymmetric-three-by-two')!;
  const radiusMutant: AnalyticEvaluator = (f) => orbit(f.c, f.mode === 'julia' ? f.z0! : { re: 0, im: 0 }, f.N, true, false);
  const lastMutant: AnalyticEvaluator = (f) => orbit(f.c, f.mode === 'julia' ? f.z0! : { re: 0, im: 0 }, f.N, false, true);
  const cornerMutant = (i: number, j: number, s: NumericalSettings) => ({ re: s.viewport.reMin + i / s.width * (s.viewport.reMax - s.viewport.reMin), im: s.viewport.imMax - j / s.height * (s.viewport.imMax - s.viewport.imMin) });
  const unflippedMutant = (i: number, j: number, s: NumericalSettings) => ({ re: s.viewport.reMin + (i + 0.5) / s.width * (s.viewport.reMax - s.viewport.reMin), im: s.viewport.imMin + (j + 0.5) / s.height * (s.viewport.imMax - s.viewport.imMin) });
  const mandelbrotMutant: AnalyticEvaluator = (f) => orbit(f.c, f.c, f.N, false, false);
  const paletteMutant = (field: Uint16Array, settings: NumericalSettings, palette: 'lagoon' | 'ember') => { field[0] = 42; return colorizeNumericalField(field, settings, palette); };
  return [
    evidence('radius-greater-or-equal', 'Change strict squared-norm >4 to >=4.', checkAnalytic(radiusMutant, radiusFixture)),
    evidence('omit-final-N', 'Skip the final n=N escape check.', checkAnalytic(lastMutant, lastFixture)),
    evidence('pixel-corner', 'Replace pixel-center offsets by corner coordinates.', checkCoordinate(cornerMutant, one, one.points[0]!)),
    evidence('omit-y-flip', 'Make imaginary coordinates increase downward.', checkCoordinate(unflippedMutant, asym, asym.points[0]!)),
    evidence('mandelbrot-start-at-c', 'Initialize Mandelbrot orbit at c instead of zero.', checkAnalytic(mandelbrotMutant, mandelbrotFixture)),
    evidence('palette-mutates-field', 'Write into the numeric field during colorization.', checkPalettePurity(paletteMutant, new Uint16Array([0, 1, 255, 256, 512, 65535]), numericalFixture({ maxIterations: 512 }), 'lagoon')),
  ];
}
