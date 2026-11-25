import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMandatoryChecks, runRelationChecks } from './numerical-checks.ts';
import { runMutationChecks } from './numerical-mutations.ts';

// Development regression suite and final audit use the identical planned assertions.
for (const record of [...runMandatoryChecks(), ...runRelationChecks()]) {
  test(`Numerical case ${record.id}`, () => assert.equal(record.pass, true, JSON.stringify(record)));
}
for (const mutation of runMutationChecks()) {
  test(`Numerical mutation detected: ${mutation.id}`, () => {
    assert.equal(mutation.expectedFailure, true);
    assert.equal(mutation.actualCheckPassed, false, JSON.stringify(mutation));
    assert.equal(mutation.detected, true, JSON.stringify(mutation));
  });
}
