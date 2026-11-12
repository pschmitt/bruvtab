const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function setup() {
  const calls = [];
  const timers = [];
  let listener;
  const chrome = {debugger: {
    onEvent: {addListener: callback => { listener = callback; }},
    onDetach: {addListener: () => {}},
    attach: async target => calls.push(['attach', target.tabId]),
    detach: async target => calls.push(['detach', target.tabId]),
    sendCommand: async (_target, method, params) => {
      calls.push([method, params]);
      if (method === 'Page.getLayoutMetrics') return {cssContentSize: {width: 800, height: 2000}};
      return {data: 'base64'};
    },
  }};
  const context = {chrome, setTimeout: (callback, delay) => { const timer = {callback, delay}; timers.push(timer); return timer; },
    clearTimeout: timer => { if (timer) timer.cleared = true; }};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('bruvtab/extension/chrome/debugger-features.js', 'utf8'), context);
  return {context, calls, timers, event: (...args) => listener(...args)};
}

test('full page screenshot uses page dimensions and detaches', async () => {
  const s = setup();
  const result = await s.context.debugCommand({action: 'screenshot', tabId: 7});
  assert.equal(result.data, 'base64');
  const capture = s.calls.find(item => item[0] === 'Page.captureScreenshot');
  assert.equal(capture[1].clip.height, 2000);
  assert.equal(capture[1].captureBeyondViewport, true);
  assert.deepEqual(s.calls.at(-1), ['detach', 7]);
});

test('PDF is printed and detached', async () => {
  const s = setup();
  const result = await s.context.debugCommand({action: 'pdf', tabId: 7});
  assert.equal(result.data, 'base64');
  assert.equal(s.calls.find(item => item[0] === 'Page.printToPDF')[1].printBackground, true);
  assert.deepEqual(s.calls.at(-1), ['detach', 7]);
});

test('console session streams only its target and stops', async () => {
  const s = setup();
  await s.context.debugCommand({action: 'start', tabId: 7, options: {mode: 'console'}});
  s.event({tabId: 8}, 'Runtime.consoleAPICalled', {type: 'error', args: [{value: 'other'}]});
  s.event({tabId: 7}, 'Runtime.consoleAPICalled', {type: 'error', args: [{value: 'oops'}]});
  const result = await s.context.debugCommand({action: 'poll', tabId: 7});
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].args[0], 'oops');
  await s.context.debugCommand({action: 'stop', tabId: 7});
  assert.deepEqual(s.calls.at(-1), ['detach', 7]);
});

test('network session reports request and failure without headers', async () => {
  const s = setup();
  await s.context.debugCommand({action: 'start', tabId: 7, options: {mode: 'network'}});
  s.event({tabId: 7}, 'Network.requestWillBeSent', {requestId: '1', request: {url: 'https://example.org', method: 'GET', headers: {secret: 'private'}}});
  s.event({tabId: 7}, 'Network.loadingFailed', {requestId: '1', errorText: 'failed'});
  const result = await s.context.debugCommand({action: 'poll', tabId: 7});
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].url, 'https://example.org');
  assert.equal(result.events[0].headers, undefined);
  assert.equal(result.events[1].type, 'failed');
  await s.context.debugCommand({action: 'stop', tabId: 7});
});

test('failed setup detaches', async () => {
  const s = setup();
  s.context.chrome.debugger.sendCommand = async () => { throw new Error('unsupported'); };
  await assert.rejects(s.context.debugCommand({action: 'start', tabId: 7, options: {mode: 'network'}}));
  assert.deepEqual(s.calls.at(-1), ['detach', 7]);
});

test('event queue is bounded and reports dropped events', async () => {
  const s = setup();
  await s.context.debugCommand({action: 'start', tabId: 7, options: {mode: 'network'}});
  for (let i = 0; i < 1001; i++) {
    s.event({tabId: 7}, 'Network.loadingFailed', {requestId: String(i), errorText: 'failed'});
  }
  const result = await s.context.debugCommand({action: 'poll', tabId: 7});
  assert.equal(result.events.length, 1000);
  assert.equal(result.events[0].id, '1');
  assert.equal(result.dropped, 1);
  await s.context.debugCommand({action: 'stop', tabId: 7});
});

test('abandoned session detaches after the lease expires', async () => {
  const s = setup();
  await s.context.debugCommand({action: 'start', tabId: 7, options: {mode: 'console'}});
  s.timers.find(timer => timer.delay === 30000).callback();
  await Promise.resolve();
  assert.deepEqual(s.calls.at(-1), ['detach', 7]);
  await assert.rejects(s.context.debugCommand({action: 'poll', tabId: 7}), /ended/);
});
