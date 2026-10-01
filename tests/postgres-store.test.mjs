import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresWarehouseStore } from '../db/postgres-warehouse.ts';
import { initialState } from '../lib/warehouse.ts';

test('concurrent reads and writes wait for the complete database initialization', async () => {
  let releaseInitialization;
  const initialization = new Promise(resolve => { releaseInitialization = resolve; });
  let initializationCalls = 0;
  let queryCalls = 0;
  const state = initialState();
  const store = createPostgresWarehouseStore({
    async initialize() {
      initializationCalls += 1;
      await initialization;
    },
    async query() {
      queryCalls += 1;
      return [{ revision: 1, data: state }];
    },
  });

  const read = store.read();
  const write = store.write(0, state);
  await Promise.resolve();
  assert.equal(initializationCalls, 1);
  assert.equal(queryCalls, 0, 'inventory must not be accessed before security setup completes');

  releaseInitialization();
  assert.deepEqual(await read, { revision: 1, state });
  assert.equal(await write, true);
  assert.equal(queryCalls, 2);
});

test('failed initialization blocks inventory access and can be retried', async () => {
  const denied = new Error('Security setup failed');
  let initializationCalls = 0;
  let queryCalls = 0;
  const store = createPostgresWarehouseStore({
    async initialize() {
      initializationCalls += 1;
      if (initializationCalls === 1) throw denied;
    },
    async query() {
      queryCalls += 1;
      return [];
    },
  });

  const results = await Promise.allSettled([store.read(), store.write(0, initialState())]);
  for (const result of results) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason, denied);
  }
  assert.equal(queryCalls, 0, 'a failed security setup must never fall through to a query');
  assert.equal(initializationCalls, 1);

  assert.deepEqual(await store.read(), { revision: 0, state: initialState() });
  assert.equal(initializationCalls, 2);
  assert.equal(queryCalls, 1);
});
