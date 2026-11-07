# background/platform

Thin wrappers over `chrome.*` (runtime, tabs, userScripts, storage, webRequest) plus the backend HTTP client
(`x-extension-token`, `x-user-id` install id, `x-trace-id`). **The only background code that touches chrome APIs.**
Add wrappers here (alarms, commands, action badge, webNavigation…) rather than calling chrome.* from a module.
