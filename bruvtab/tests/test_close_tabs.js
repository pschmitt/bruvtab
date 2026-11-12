// Run with node --test bruvtab/tests/test_close_tabs.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

for (const file of ['background.js', 'chrome/background.js', 'firefox/background.js']) {
  for (const scenario of ['closed', 'prompt', 'query stalled']) {
    test(`${file}: ${scenario}`, async () => {
      const source = fs.readFileSync(`bruvtab/extension/${file}`, 'utf8');
      const code = source.slice(source.indexOf('function closeTabs(tab_ids) {'), source.indexOf('function openUrls('));
      const timers = [];
      const messages = [];
      let queries = 0;
      const browserTabs = {
        list(_query, callback) {
          queries++;
          if (scenario === 'query stalled' && queries > 1) return;
          callback(queries === 1 || scenario === 'prompt' ?
            [{id: 1, windowId: 1}, {id: 2, windowId: 1}] : [{id: 2, windowId: 1}]);
        },
        close(_ids, done) { if (scenario !== 'prompt') done(); },
        closeWindow() { throw new Error('unexpected window removal'); },
      };
      const context = {browserTabs, chrome: {runtime: {}}, console,
        port: {postMessage: message => messages.push(JSON.parse(message))},
        setTimeout: (callback, delay) => { const timer = {callback, delay}; timers.push(timer); return timer; },
        clearTimeout: timer => { timer.cleared = true; }};
      vm.runInNewContext(`${code}\ncloseTabs([1]);`, context);
      await Promise.resolve();
      for (const timer of timers.sort((a, b) => a.delay - b.delay)) {
        if (!timer.cleared) timer.callback();
      }
      assert.deepEqual(messages, [{unconfirmed: scenario === 'closed' ? [] : [1]}]);
    });
  }
}
