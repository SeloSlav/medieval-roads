import assert from 'node:assert/strict';
import {
  formatBootstrapFailure,
  formatConnectionUnavailable,
  formatWorldGenerationMismatch,
} from '../src/app/connectionRecoveryHints.ts';

const generationLock = formatBootstrapFailure(
  new Error('Cannot change world generation after the simulation has started.'),
);
assert.equal(generationLock.showNewWorldAction, true);
assert.match(generationLock.recoveryHint, /Small/i);
assert.match(generationLock.recoveryHint, /local storage/i);

const timeout = formatBootstrapFailure(new Error('Timed out waiting for world_config subscription.'));
assert.equal(timeout.showNewWorldAction, false);
assert.match(timeout.recoveryHint, /world configuration/i);

const generic = formatBootstrapFailure(new Error('Reducer failed'));
assert.equal(generic.showNewWorldAction, true);
assert.match(generic.recoveryHint, /retry/i);

const mismatch = formatWorldGenerationMismatch('Settings differ.');
assert.equal(mismatch.showNewWorldAction, true);
assert.match(mismatch.recoveryHint, /saved map settings/i);

const offline = formatConnectionUnavailable();
assert.equal(offline.showNewWorldAction, false);
assert.match(offline.recoveryHint, /retry/i);

console.log('connection recovery hint tests passed');
