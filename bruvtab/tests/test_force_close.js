// Run with node --test bruvtab/tests/test_force_close.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function setup({permission = true, attachFails = false} = {}) {
  const timers = [];
  const commands = [];
  const detached = [];
  let event;
  let closes = 0;
  const chrome = {
    permissions: {contains: async () => permission},
    debugger: {
      onEvent: {addListener: listener => { event = listener; }},
      attach: async () => { if (attachFails) throw Error('cannot attach'); },
      detach: async target => { detached.push(target.tabId); },
      sendCommand: async (target, method, params) => { commands.push([target.tabId, method, params]); },
    },
  };
  const context = {chrome, console, setTimeout: (fn, ms) => { timers.push([fn, ms]); }};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('bruvtab/extension/chrome/force-close.js', 'utf8'), context);
  return {context, timers, commands, detached, event: (...args) => event(...args),
    close: () => { closes++; }, get closes() { return closes; }};
}

test('permission unavailable: normal close', async () => {
  const s = setup({permission: false});
  await s.context.closeWithOptionalDebugger([1], s.close);
  assert.equal(s.closes, 1);
  assert.equal(s.commands.length, 0);
});

test('debugger API unavailable: normal close', async () => {
  const s = setup();
  delete s.context.chrome.debugger;
  await s.context.closeWithOptionalDebugger([1], s.close);
  assert.equal(s.closes, 1);
});

test('attach failure: normal close', async () => {
  const s = setup({attachFails: true});
  await s.context.closeWithOptionalDebugger([1], s.close);
  assert.equal(s.closes, 1);
});

test('accepts only beforeunload for the requested tab and detaches', async () => {
  const s = setup();
  await s.context.closeWithOptionalDebugger([1], s.close);
  s.event({tabId: 2}, 'Page.javascriptDialogOpening', {type: 'beforeunload'});
  s.event({tabId: 1}, 'Page.javascriptDialogOpening', {type: 'confirm'});
  s.event({tabId: 1}, 'Page.javascriptDialogOpening', {type: 'beforeunload'});
  assert.deepEqual(s.commands.map(c => c[1]), ['Page.enable', 'Page.handleJavaScriptDialog']);
  assert.equal(s.commands[1][2].accept, true);
  s.timers.find(([, ms]) => ms === 4000)[0]();
  assert.deepEqual(s.detached, [1]);
  s.event({tabId: 1}, 'Page.javascriptDialogOpening', {type: 'beforeunload'});
  assert.equal(s.commands.length, 2);
});

test('a stalled permission check falls back to normal closing', async () => {
  const s = setup();
  s.context.chrome.permissions.contains = () => new Promise(() => {});
  const closing = s.context.closeWithOptionalDebugger([1], s.close);
  s.timers.find(([, ms]) => ms === 1000)[0]();
  await closing;
  assert.equal(s.closes, 1);
});

test('a late debugger attachment is detached after fallback', async () => {
  const s = setup();
  let finishAttach;
  s.context.chrome.debugger.attach = () => new Promise(resolve => { finishAttach = resolve; });
  const closing = s.context.closeWithOptionalDebugger([1], s.close);
  await new Promise(resolve => setImmediate(resolve));
  const timeout = s.timers.filter(([, ms]) => ms === 1000).at(-1);
  timeout[0]();
  await closing;
  assert.equal(s.closes, 1);
  finishAttach();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(s.detached, [1]);
});
