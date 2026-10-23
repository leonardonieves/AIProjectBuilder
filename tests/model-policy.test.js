import test from 'node:test';
import assert from 'node:assert/strict';
import { plannerModelArgs, POC_MODEL } from '../server/model-policy.js';
test('always selects low-cost model explicitly', () => assert.deepEqual(plannerModelArgs({}), ['--model', 'gpt-6-luna', '-c', 'model_reasoning_effort="low"']));
test('matching override accepted', () => assert.equal(plannerModelArgs({ AIPB_MODEL: POC_MODEL })[1], POC_MODEL));
test('expensive override rejected without fallback', () => assert.throws(() => plannerModelArgs({ AIPB_MODEL: 'gpt-6-astra' })));
test('unknown model rejected', () => assert.throws(() => plannerModelArgs({ AIPB_MODEL: 'unknown' })));