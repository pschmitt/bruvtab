// Run with node --test bruvtab/tests/test_query_errors.js.
// A query the browser rejects (an invalid URL pattern, say) must be answered
// with an ERROR line, not left unanswered until the mediator times out.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function load(file) {
  const source = fs.readFileSync(`bruvtab/extension/${file}`, 'utf8');
  const classes = source.slice(source.indexOf('class BrowserTabs {'),
                               source.indexOf('\n}\n', source.indexOf('class ChromeTabs')) + 3);
  const start = source.indexOf('function queryTabsOnSuccess(');
  const end = source.indexOf('\n}\n', source.indexOf('function queryTabs(')) + 3;
  return `${classes}\n${source.slice(start, end)}\n`;
}

function run(file, className, api, query) {
  const messages = [];
  const context = {api, console: {log() {}, error() {}}, atob, btoa,
    compareWindowIdTabId: (a, b) => a.id - b.id,
    // JSON round trip: arrays made inside the vm have another Array prototype
    port: {postMessage: message => messages.push(JSON.parse(JSON.stringify(message)))}};
  vm.runInNewContext(`${load(file)}
    var browserTabs = new ${className}(api);
    queryTabs(btoa(JSON.stringify(${JSON.stringify(query)})));`, context);
  return messages;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

for (const file of ['background.js', 'chrome/background.js', 'firefox/background.js']) {
  test(`${file}: Chrome reports a rejected query`, async () => {
    const api = {runtime: {}, tabs: {query(_query, callback) {
      api.runtime.lastError = {message: "Invalid url pattern 'x'"};
      callback(undefined);
      delete api.runtime.lastError;
    }}};
    const messages = run(file, 'ChromeTabs', api, {url: ['x']});
    await settle();
    assert.deepEqual(messages, [["ERROR\tInvalid url pattern 'x'"]]);
  });

  test(`${file}: Chrome reports a rejected windowFocused query`, async () => {
    const api = {runtime: {}, windows: {get() { throw new Error('unexpected'); }}, tabs: {query(_query, callback) {
      api.runtime.lastError = {message: "Invalid url pattern 'x'"};
      callback(undefined);
      delete api.runtime.lastError;
    }}};
    const messages = run(file, 'ChromeTabs', api, {url: ['x'], windowFocused: true});
    await settle();
    assert.deepEqual(messages, [["ERROR\tInvalid url pattern 'x'"]]);
  });

  test(`${file}: a query without an error callback logs the rejection`, async () => {
    const errors = [];
    const api = {runtime: {}, tabs: {query: () => Promise.reject(new Error('boom'))}};
    const context = {api, console: {log() {}, error: (...args) => errors.push(args.join(' '))}};
    vm.runInNewContext(`${load(file)}\nnew FirefoxTabs(api).query({}, () => {});`, context);
    await settle();
    assert.equal(errors.length, 1);
  });

  test(`${file}: Firefox reports a rejected query`, async () => {
    const api = {runtime: {}, tabs: {query: () => Promise.reject(new Error("Invalid url pattern 'x'"))}};
    const messages = run(file, 'FirefoxTabs', api, {url: ['x']});
    await settle();
    assert.deepEqual(messages, [["ERROR\tInvalid url pattern 'x'"]]);
  });

  test(`${file}: a successful query still lists the tabs`, async () => {
    const api = {runtime: {}, tabs: {query: () => Promise.resolve([{id: 2, windowId: 1, title: 't', url: 'u'}])}};
    const messages = run(file, 'FirefoxTabs', api, {url: ['*://u/*']});
    await settle();
    assert.deepEqual(messages, [['1.2\tt\tu']]);
  });
}
