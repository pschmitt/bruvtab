const input = document.getElementById('companion');
const status = document.getElementById('status');
chrome.storage.local.get('forceCloseCompanion').then(({forceCloseCompanion}) => {
  input.value = forceCloseCompanion || '';
}).catch(error => { status.textContent = `Could not load settings: ${error.message}`; });

document.getElementById('save').addEventListener('click', async () => {
  const id = input.value.trim();
  if (id && !/^[a-p]{32}$/.test(id)) {
    status.textContent = 'Enter a valid extension ID.';
    return;
  }
  try {
    await chrome.storage.local.set({forceCloseCompanion: id});
    status.textContent = 'Saved.';
  } catch (error) {
    status.textContent = `Could not save: ${error.message}`;
  }
});
