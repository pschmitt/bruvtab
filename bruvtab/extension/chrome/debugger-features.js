// Debugging sessions belong to one CLI command and expire if it stops polling.
const debugSessions = new Map();
const DEBUG_SESSION_TIMEOUT = 30000;
const DEBUG_EVENT_LIMIT = 1000;

function debugEvent(source, method, params) {
  const session = debugSessions.get(source.tabId);
  if (!session) return;
  let event;
  if (session.mode === 'console' && method === 'Runtime.consoleAPICalled') {
    event = {type: params.type, timestamp: params.timestamp,
      args: params.args.map(arg => arg.value ?? arg.description ?? arg.type)};
  } else if (session.mode === 'console' && method === 'Runtime.exceptionThrown') {
    event = {type: 'exception', timestamp: params.timestamp,
      text: params.exceptionDetails.exception?.description || params.exceptionDetails.text};
  } else if (session.mode === 'console' && method === 'Log.entryAdded') {
    event = {type: params.entry.level, timestamp: params.entry.timestamp, text: params.entry.text};
  } else if (session.mode === 'network' && method === 'Network.requestWillBeSent') {
    event = {type: 'request', id: params.requestId, method: params.request.method,
      url: params.request.url, timestamp: params.timestamp};
  } else if (session.mode === 'network' && method === 'Network.responseReceived') {
    event = {type: 'response', id: params.requestId, status: params.response.status,
      url: params.response.url, timestamp: params.timestamp};
  } else if (session.mode === 'network' && method === 'Network.loadingFailed') {
    event = {type: 'failed', id: params.requestId, error: params.errorText, timestamp: params.timestamp};
  } else if (session.mode === 'network' && method === 'Network.loadingFinished') {
    event = {type: 'finished', id: params.requestId, bytes: params.encodedDataLength, timestamp: params.timestamp};
  }
  if (event) {
    if (session.events.length >= DEBUG_EVENT_LIMIT) { session.events.shift(); session.dropped++; }
    session.events.push(event);
  }
}

chrome.debugger.onEvent.addListener(debugEvent);
chrome.debugger.onDetach.addListener(source => {
  const session = debugSessions.get(source.tabId);
  if (session) { clearTimeout(session.timer); debugSessions.delete(source.tabId); }
});

async function stopDebugSession(tabId) {
  const session = debugSessions.get(tabId);
  if (!session) return;
  debugSessions.delete(tabId);
  clearTimeout(session.timer);
  try { await chrome.debugger.detach({tabId}); } catch (_) { /* Tab closed or debugger detached. */ }
}

function renewDebugSession(tabId, session) {
  clearTimeout(session.timer);
  session.timer = setTimeout(() => { void stopDebugSession(tabId); }, DEBUG_SESSION_TIMEOUT);
}

async function debugCommand(command) {
  const {action, tabId, options = {}} = command;
  if (!Number.isInteger(tabId)) throw new Error('A tab ID is required');
  const target = {tabId};
  const send = (method, params = {}) => chrome.debugger.sendCommand(target, method, params);
  if (action === 'poll') {
    const session = debugSessions.get(tabId);
    if (!session) throw new Error('Debug session ended');
    renewDebugSession(tabId, session);
    const events = session.events.splice(0);
    const dropped = session.dropped;
    session.dropped = 0;
    return {events, dropped};
  }
  if (action === 'stop') { await stopDebugSession(tabId); return {}; }
  if (debugSessions.has(tabId)) throw new Error('This tab already has a BruvTab debug session');
  await chrome.debugger.attach(target, '1.3');
  let keepAttached = false;
  try {
    if (action === 'screenshot') {
      const metrics = await send('Page.getLayoutMetrics');
      const {width, height} = metrics.cssContentSize;
      const result = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true,
        clip: {x: 0, y: 0, width, height, scale: 1}});
      return {data: result.data};
    }
    if (action === 'pdf') return await send('Page.printToPDF', {printBackground: true});
    if (action === 'start') {
      if (!['console', 'network'].includes(options.mode)) throw new Error('Unknown session mode');
      const session = {mode: options.mode, events: [], dropped: 0, timer: null};
      debugSessions.set(tabId, session);
      if (options.mode === 'console') {
        await send('Runtime.enable');
        await send('Log.enable');
      } else {
        await send('Network.enable');
      }
      renewDebugSession(tabId, session);
      keepAttached = true;
      return {};
    }
    throw new Error(`Unknown debugger action: ${action}`);
  } finally {
    if (!keepAttached) {
      debugSessions.delete(tabId);
      try { await chrome.debugger.detach(target); } catch (_) { /* Already detached. */ }
    }
  }
}
