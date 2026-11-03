# Security

Redline is meant to expose nothing of your machine. What it does, and what it relies on:

- **What listens**: a `redline wait` only, while an agent waits for a round, on 127.0.0.1 (never
  another interface) and a port of 47390-47399. It takes one round and exits.
- **Web pages cannot reach it**: it refuses a request that names another host than `127.0.0.1` or
  `localhost` (DNS rebinding), or that carries a web page's `Origin`, and it sends no CORS headers.
- **Other users and processes of the machine cannot either.** The loopback is everyone's on the
  machine, so the bridge and the extension prove to each other that they know your **token**: 32
  random bytes in a file only you can read (`~/.config/redline/token` on Linux, or under `$XDG_CONFIG_HOME`;
  `~/Library/Application Support/redline/token` on macOS, `%APPDATA%\redline\token` on Windows;
  `REDLINE_HOME` moves the directory). Each request carries an HMAC of it, bound to the bridge's
  port and to a random value of each run, and the token itself never goes over the wire. A process
  of another user can neither post a round to your agent nor read its status, and one that
  listens on a port of the range first gets nothing from your browser: no screenshot, no round.
  The browser gets the token from the native messaging host, which it runs as you
  (`redline install`), or from you, pasted in the sidebar.
- **What it writes**: `.redline/` in the project, readable by you only (0700 and 0600). The
  screenshots show what the page showed: keep `.redline/` out of git (`/redline` adds it to
  `.gitignore`).
- **The extension** has the permission of every site (`<all_urls>`), to capture whatever page you
  start it on. It runs on a page only when you start it there, or when a `redline wait` names the
  page's app. Install it in the browser the firefox-devtools MCP drives, a profile of its own, not
  the one of your everyday browsing: the agent drives that browser. Without an MCP, it is your
  own browser, where the extension does nothing until you start it, or a page of an app an agent
  waits for opens.
- **The app under review is trusted**: its pages run in the browser, and their text, selectors and
  components go to the agent. `feedback.md` writes them as data, on one line each, which a page cannot
  turn into instructions of its own. The overlay ignores the events that the page's scripts make
  up (a page could otherwise send a round with a synthetic Ctrl+D).
- **What remains**: root, and anyone who can read your files, can read the token. A process can
  still hold all ten ports, so that no `redline wait` can listen: a nuisance, not a leak.
