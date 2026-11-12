const debuggerPermission = {permissions: ['debugger']};
const status = document.getElementById('status');

async function refresh() {
  const enabled = await chrome.permissions.contains(debuggerPermission);
  status.textContent = enabled ? 'Enabled' : 'Disabled';
  document.getElementById('enable').disabled = enabled;
  document.getElementById('disable').disabled = !enabled;
}

document.getElementById('enable').addEventListener('click', async () => {
  try {
    await chrome.permissions.request(debuggerPermission);
    await refresh();
  } catch (error) {
    status.textContent = `Could not enable: ${error.message}`;
  }
});
document.getElementById('disable').addEventListener('click', async () => {
  try {
    await chrome.permissions.remove(debuggerPermission);
    await refresh();
  } catch (error) {
    status.textContent = `Could not disable: ${error.message}`;
  }
});
refresh().catch(error => { status.textContent = `Could not read permission: ${error.message}`; });
