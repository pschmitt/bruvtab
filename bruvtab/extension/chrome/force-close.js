// Never intercept dialogs outside a close request.
const closingDebuggees = new Set();
let debuggerListenerRegistered = false;

function registerDebuggerListener() {
  if (debuggerListenerRegistered || !chrome.debugger) return;
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (method === 'Page.javascriptDialogOpening' && params.type === 'beforeunload' &&
        closingDebuggees.has(source.tabId)) {
      chrome.debugger.sendCommand({tabId: source.tabId}, 'Page.handleJavaScriptDialog',
        {accept: true}).catch(error => console.warn('Could not accept close confirmation:', error));
    }
  });
  debuggerListenerRegistered = true;
}

async function closeWithOptionalDebugger(tabIds, closeNormally) {
  let active = true;
  let preparing = true;
  const attached = new Set();
  const detach = async tabId => {
    closingDebuggees.delete(tabId);
    if (!attached.delete(tabId)) return;
    try { await chrome.debugger.detach({tabId}); } catch (_) { /* Already closed or detached. */ }
  };
  const cleanup = () => {
    active = false;
    for (const tabId of attached) void detach(tabId);
  };
  try {
    const hasPermission = chrome.debugger && chrome.permissions && await Promise.race([
      chrome.permissions.contains({permissions: ['debugger']}),
      new Promise(resolve => setTimeout(() => resolve(false), 1000)),
    ]);
    if (hasPermission) {
      registerDebuggerListener();
      const prepare = tabIds.map(async tabId => {
        try {
          await chrome.debugger.attach({tabId}, '1.3');
          attached.add(tabId);
          if (!active || !preparing) return void detach(tabId);
          await chrome.debugger.sendCommand({tabId}, 'Page.enable');
          if (!active || !preparing) return void detach(tabId);
          closingDebuggees.add(tabId);
        } catch (error) {
          console.warn(`Could not prepare tab ${tabId} for forced close:`, error);
          await detach(tabId);
        }
      });
      await Promise.race([Promise.all(prepare), new Promise(resolve => setTimeout(resolve, 1000))]);
    }
  } catch (error) {
    console.warn('Debugger unavailable; closing tabs normally:', error);
  }
  preparing = false;
  try {
    closeNormally(tabIds);
  } finally {
    setTimeout(cleanup, 4000);
  }
}
