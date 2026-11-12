# BruvTab force-close companion

This optional Chromium extension lets BruvTab accept leave-site confirmations
when closing tabs. It requests the debugger permission, which grants broad
access to page data. Closing a tab can discard unsaved work.

To install from a checkout, open `chrome://extensions`, enable Developer mode,
choose **Load unpacked**, and select this directory. Open the companion's
extension options and copy its extension ID. Open the main BruvTab extension's
options and save that ID. Remove the ID to return to normal closing.

The companion accepts requests only from the official BruvTab extension IDs.
If it is missing or cannot attach to a tab, BruvTab closes normally and warns
when it cannot confirm closure.
