importScripts('force-close.js');

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const allowed = ['edpgjheobdplebiikjgjgpmonakingef', 'bkifkhiemhgpnomgdcbcbkifekkecnhk'];
  if (!allowed.includes(sender.id) || message?.type !== 'prepareClose' ||
      !Array.isArray(message.tabIds) || !message.tabIds.every(Number.isInteger)) return false;
  closeWithOptionalDebugger(message.tabIds, () => sendResponse({ready: true}));
  return true;
});
