const TAB_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

function requireGroupInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative integer`);
  }
}

function requireTabGroupProperties(properties) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error('Group properties must be an object');
  }
  for (const [name, value] of Object.entries(properties)) {
    if ((name === 'title' && typeof value === 'string') ||
        (name === 'color' && TAB_GROUP_COLORS.includes(value)) ||
        (name === 'collapsed' && typeof value === 'boolean')) {
      continue;
    }
    throw new Error(`Invalid group property: ${name}`);
  }
}

async function selectedGroupTabs(tabsApi, windowId, ids) {
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) {
    throw new Error('Supply one or more distinct tab IDs');
  }
  ids.forEach(id => requireGroupInteger(id, 'Tab ID'));

  const tabs = await tabsApi.query({windowId});
  const byId = new Map(tabs.map(tab => [tab.id, tab]));
  return ids.map(id => {
    const tab = byId.get(id);
    if (!tab || tab.windowId !== windowId) {
      throw new Error(`Tab ${id} is no longer in window ${windowId}`);
    }
    if (Number.isInteger(tab.splitViewId) && tab.splitViewId >= 0) {
      throw new Error(`Tab ${id} belongs to a split view`);
    }
    return tab;
  });
}

function tabGroupRecord(group, tabCount) {
  return {
    id: group.id,
    windowId: group.windowId,
    title: group.title ?? '',
    color: group.color,
    collapsed: group.collapsed,
    tabCount: tabCount,
  };
}

async function tabGroupCommand(browserApi, command) {
  const {action, window_id: windowId, tab_ids: tabIds, group_id: groupId, properties = {}} = command;
  let createdGroupId;
  try {
    if (!['create', 'list', 'update', 'ungroup'].includes(action)) {
      throw new Error('Unknown tab group action');
    }
    if (action !== 'list' || windowId !== undefined) {
      requireGroupInteger(windowId, 'Window ID');
    }
    const {tabs, tabGroups} = browserApi;
    if (typeof tabs?.group !== 'function' || !tabGroups) {
      throw new Error('This browser does not support native tab groups');
    }

    if (action === 'list') {
      const query = windowId === undefined ? {} : {windowId};
      const [groups, openTabs] = await Promise.all([tabGroups.query(query), tabs.query(query)]);
      const counts = new Map();
      for (const tab of openTabs) {
        counts.set(tab.groupId, (counts.get(tab.groupId) || 0) + 1);
      }
      return {ok: true, groups: groups.map(group => tabGroupRecord(group, counts.get(group.id) || 0))};
    }

    if (action === 'update') {
      requireGroupInteger(groupId, 'Group ID');
      requireTabGroupProperties(properties);
      const group = await tabGroups.get(groupId);
      if (group.windowId !== windowId) {
        throw new Error(`Group ${groupId} is no longer in window ${windowId}`);
      }
      const members = await tabs.query({windowId, groupId});
      if (properties.collapsed && members.some(tab => tab.active)) {
        throw new Error('Select a tab outside the group before collapsing it');
      }
      const updated = await tabGroups.update(groupId, properties);
      return {ok: true, group: tabGroupRecord(updated ?? await tabGroups.get(groupId), members.length)};
    }

    const selected = await selectedGroupTabs(tabs, windowId, tabIds);
    if (action === 'ungroup') {
      const groupedIds = selected.filter(tab => tab.groupId !== -1).map(tab => tab.id);
      if (groupedIds.length) {
        await tabs.ungroup(groupedIds);
      }
      return {ok: true, tabIds};
    }

    requireTabGroupProperties(properties);
    for (const tab of selected) {
      if (tab.pinned || tab.groupId !== -1) {
        throw new Error(`Tab ${tab.id} is pinned or already grouped`);
      }
    }
    if (properties.collapsed && selected.some(tab => tab.active)) {
      throw new Error('Select a tab outside the group before collapsing it');
    }

    createdGroupId = await tabs.group({tabIds, createProperties: {windowId}});
    const updated = await tabGroups.update(createdGroupId, properties);
    return {ok: true, group: tabGroupRecord(updated ?? await tabGroups.get(createdGroupId), selected.length)};
  } catch (error) {
    const result = {ok: false, error: error?.message || String(error)};
    if (createdGroupId !== undefined) {
      result.groupId = createdGroupId;
    }
    return result;
  }
}
