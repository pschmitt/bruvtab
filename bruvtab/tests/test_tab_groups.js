const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const {setImmediate} = require('node:timers/promises');

const normalize = value => JSON.parse(JSON.stringify(value));

function setup(browserName, {groupApiAvailable = true, failMetadata = false, tabProperties = {}} = {}) {
  const path = `bruvtab/extension/${browserName}`;
  const background = fs.readFileSync(`${path}/background.js`, 'utf8');
  const helper = fs.readFileSync(`${path}/tab-groups.js`, 'utf8');
  const handler = background.slice(background.indexOf('function handleNativeMessage('),
    background.indexOf('function handleNativeDisconnect('));
  const windows = [{id: 11, windowId: 3, groupId: -1, ...tabProperties},
    {id: 12, windowId: 3, groupId: -1}, {id: 13, windowId: 4, groupId: -1}];
  const groups = [];
  const changes = [];
  const browser = {
    tabs: {
      async query(options) {
        return windows.filter(tab => (options.windowId === undefined || tab.windowId === options.windowId)
          && (options.groupId === undefined || tab.groupId === options.groupId));
      },
      async group(options) {
        changes.push(['group', normalize(options)]);
        const group = {id: 8, windowId: options.createProperties.windowId, color: 'grey', collapsed: false};
        groups.push(group);
        for (const tab of windows.filter(tab => options.tabIds.includes(tab.id))) {
          tab.groupId = group.id;
        }
        return group.id;
      },
      async ungroup(ids) {
        changes.push(['ungroup', normalize(ids)]);
        const tabIds = new Set(ids);
        for (const tab of windows.filter(tab => tabIds.has(tab.id))) {
          tab.groupId = -1;
        }
      },
    },
    tabGroups: groupApiAvailable ? {
      async query(options) {
        return groups.filter(group => options.windowId === undefined || options.windowId === group.windowId);
      },
      async get(id) {
        return groups.find(group => group.id === id);
      },
      async update(id, properties) {
        if (failMetadata) {
          throw new Error('Metadata changed concurrently');
        }
        changes.push(['update', id, normalize(properties)]);
        return Object.assign(groups.find(group => group.id === id), properties);
      },
    } : undefined,
  };
  const messages = [];
  const context = vm.createContext({
    [browserName === 'chrome' ? 'chrome' : 'browser']: browser,
    console: {log() {}, warn() {}},
    port: {postMessage: value => messages.push(normalize(value))},
  });
  vm.runInContext(`${helper}\n${handler}`, context);
  return {
    changes,
    async command(command) {
      const before = messages.length;
      context.handleNativeMessage({name: 'tab_group_command', ...command});
      await setImmediate();
      assert.equal(messages.length, before + 1);
      return messages.at(-1);
    },
  };
}

for (const browserName of ['chrome', 'firefox']) {
  test(`${browserName}: native tab groups are a required extension permission`, () => {
    const manifest = JSON.parse(fs.readFileSync(`bruvtab/extension/${browserName}/manifest.json`, 'utf8'));
    assert.ok(manifest.permissions.includes('tabGroups'));
    assert.ok(!manifest.optional_permissions?.includes('tabGroups'));
  });

  test(`${browserName}: create, list, update and ungroup native tabs`, async () => {
    const {command, changes} = setup(browserName);
    const properties = {title: 'Research', color: 'blue'};
    const expected = {id: 8, windowId: 3, tabCount: 2, ...properties, collapsed: false};
    assert.deepEqual(await command({action: 'create', window_id: 3, tab_ids: [11, 12], properties}),
      {ok: true, group: expected});
    assert.deepEqual(changes[0], ['group', {tabIds: [11, 12], createProperties: {windowId: 3}}]);
    assert.deepEqual(await command({action: 'list', window_id: 3}), {ok: true, groups: [expected]});
    assert.deepEqual(await command({action: 'update', window_id: 3, group_id: 8, properties: {collapsed: true}}),
      {ok: true, group: {...expected, collapsed: true}});
    assert.deepEqual(await command({action: 'ungroup', window_id: 3, tab_ids: [11]}),
      {ok: true, tabIds: [11]});
    assert.deepEqual(changes.at(-1), ['ungroup', [11]]);
    assert.deepEqual(await command({action: 'list'}), {ok: true, groups: [{...expected, collapsed: true, tabCount: 1}]});
  });

  for (const [name, config, override, message] of [
    ['missing group API', {groupApiAvailable: false}, {}, /does not support native tab groups/],
    ['tab missing', {}, {tab_ids: [11, 999]}, /no longer in window/],
    ['other window', {}, {tab_ids: [11, 13]}, /no longer in window/],
    ['split view', {tabProperties: {splitViewId: 0}}, {}, /split view/],
    ['pinned tab', {tabProperties: {pinned: true}}, {}, /pinned or already grouped/],
    ['grouped tab', {tabProperties: {groupId: 9}}, {}, /pinned or already grouped/],
    ['invalid metadata', {}, {properties: {color: 'unknown'}}, /Invalid group property/],
    ['active tab collapse', {tabProperties: {active: true}}, {properties: {collapsed: true}}, /outside the group/],
  ]) {
    test(`${browserName}: ${name} fails before grouping`, async () => {
      const {command, changes} = setup(browserName, config);
      const result = await command({action: 'create', window_id: 3, tab_ids: [11], ...override});
      assert.equal(result.ok, false);
      assert.match(result.error, message);
      assert.deepEqual(changes, []);
    });
  }

  test(`${browserName}: metadata failure reports the created group ID`, async () => {
    const {command, changes} = setup(browserName, {failMetadata: true});
    assert.deepEqual(await command({action: 'create', window_id: 3, tab_ids: [11], properties: {title: 'Research'}}),
      {ok: false, error: 'Metadata changed concurrently', groupId: 8});
    assert.equal(changes.length, 1);
  });
}
