# Archived Scripts

This folder contains legacy scripts that are no longer used by the application but are preserved for historical reference.

Archived items:

- `restart-claude.sh` – legacy helper for restarting an older Claude-based workflow.
- `start-with-claude.sh` – legacy launcher for a Claude-integrated startup flow.

Reason for archival:

- The codebase has consolidated on the newer wrappers, MultiSessionManager, and server-driven flows. These scripts are unreferenced by current Node scripts or server code and can cause confusion.

If you still rely on these scripts in a custom workflow, consider pinning them in your own environment. Otherwise, please use the current `npm run` scripts and server APIs.

