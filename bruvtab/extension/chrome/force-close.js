// The debugger permission lives in a separate, optional companion extension.
async function closeWithOptionalDebugger(tabIds, closeNormally) {
  const timeout = new Promise(resolve => setTimeout(resolve, 1500));
  try {
    await Promise.race([(async () => {
      const {forceCloseCompanion} = await chrome.storage.local.get('forceCloseCompanion');
      if (!forceCloseCompanion) return;
      await chrome.runtime.sendMessage(forceCloseCompanion, {type: 'prepareClose', tabIds});
    })(), timeout]);
  } catch (error) {
    console.warn('Force-close companion unavailable; closing tabs normally:', error);
  }
  closeNormally(tabIds);
}
