# Use

In a project, run `/redline` (or `/redline http://localhost:5173/`), or ask your agent to show
you the page. It opens the preview,
and Redline starts on it. Open the sidebar with the Redline button of the browser's toolbar: the
live page itself shows nothing of Redline.

A screenshot comes first: <kbd>Ctrl</kbd>+<kbd>S</kbd> on the page, or the sidebar's **Take a screenshot**. It covers the page,
frozen, and you draw on it. Each mark opens a comment box at once: type, <kbd>Enter</kbd>
saves. Double-click a mark or its number, whatever the tool, to edit its comment again: all of it selected, to type over it. The box's trash icon deletes the mark.

| Key                                                 | Tool                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| <kbd>Ctrl</kbd>+<kbd>S</kbd>                        | Take a screenshot of the live page; on a screenshot, back to the live page |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>       | A screenshot of a shared window, with an open dropdown (below)             |
| <kbd>1</kbd>                                        | Select: move a mark, or select it                                          |
| <kbd>2</kbd>                                        | Rectangle                                                                  |
| <kbd>3</kbd>                                        | Arrow: press where it starts, release where it points                      |
| <kbd>4</kbd>                                        | Pen: strokes 500 ms apart or less make one mark; a click is a dot          |
| <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> | Colors (and the selected mark's)                                           |
| <kbd>Del</kbd>                                      | Delete the selected mark                                                   |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd>                        | Undo the last mark                                                         |
| <kbd>Ctrl</kbd>+<kbd>D</kbd>                        | Send to your agent; Done when there is nothing to send                     |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>        | <kbd>Ctrl</kbd>+<kbd>S</kbd>, wherever the focus is in the browser         |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>        | <kbd>Ctrl</kbd>+<kbd>D</kbd>, wherever the focus is in the browser         |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>        | Turn Redline on or off on the tab                                          |

The tools and colors go by their places on the keyboard, not their letters: the colors are the
row under the digits whatever the layout (A Z E R on AZERTY). While Redline is on,
<kbd>Ctrl</kbd>+<kbd>S</kbd> is its screenshot, not the browser's Save Page.

<kbd>Ctrl</kbd>+<kbd>S</kbd> and <kbd>Ctrl</kbd>+<kbd>D</kbd> work only while the focus is in the page.
<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> and <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> do the same
from anywhere in the browser's window, such as the address bar or the sidebar. They are the browser's shortcuts, which you can change:
`about:addons` → ⚙ → Manage Extension Shortcuts in Firefox, `chrome://extensions/shortcuts` in Chrome.

An open dropdown (a `<select>`'s list) is the browser's, not the page's: a screenshot leaves it
out. For one with it, press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> on the page, and share
the browser's window, or the screen it is on, when the browser asks. During the countdown, open
the dropdown. Redline takes one frame, stops sharing, finds the page in the frame and keeps only
the page: the part of the list that hangs out of it is cut off. The browser asks each time.

While a screenshot is shown, a toolbar on it has the tools, the colors, undo and delete. Its ✕
leaves the screenshot, back to the live page, where the next one is taken; its grip moves it out
of the way.

To see the responsive layouts, pick a device in the sidebar's dropdown before
the screenshot: Phone (iPhone 15, 393×852), Tablet (iPad Air, 820×1180), Laptop 14″ FHD
(1536×864) or Desktop 4K (2560×1440), in CSS pixels; `packages/extension/src/devices.ts` has
them. The page shows in a frame of that size, scaled down when the window is smaller, and the
screenshot is the frame's. The frame loads the page anew, and its pixel ratio is the window's,
scaled: a 4K layout on a smaller screen is captured smaller.

Click the Redline button of the browser's toolbar to open the sidebar. It lists the
screenshots of the round, and the marks of each with their comment:

- A mark selected in the sidebar is selected on the screenshot, and the other way round; clicked
  again, unselected. On the screenshot, a click on a mark selects it whatever the tool, and a drag
  moves it (a drawing tool catches a mark by its outline and its number, so a rectangle can still
  be drawn inside another).
- The marks of the screenshot being annotated have a trash icon, to delete them.
- A click on a screenshot's preview shows it on the page, to mark more; another click goes back to
  the live page.
- Write a comment on the round as a whole, then **Send**, or **Done** to end the loop.

The agent replies in the sidebar: what it did of each mark, and its questions, each with a field to
answer it. The answers go with the next round, which may hold only them.

A round waits in the browser until the agent listens. The bar at the bottom of the sidebar tells
whether it does, and which agent: its name, its channel's, and its project.

Each round lands in the project:

```
.redline/sleepy-gecko/003/
├─ feedback.md          what the agent reads first: every mark by #id, its comment, its element
├─ feedback.json        all of it, with coordinates
├─ S1.annotated.png     the screenshot with the marks and their #id
└─ S1.clean.png         the same, without
```

`sleepy-gecko` is the agent's channel: each agent session has a directory of its own, its rounds
numbered from 001, so two agents reviewing the same project never mix theirs.

Add `.redline/` to the project's `.gitignore` (`/redline` does).

Each `#id` badge goes where it hides the least: of the places around its mark, the one with the
least to see on the screenshot, and no other mark.

Each mark tells the agent where its element is: a CSS selector, its text, and its path in the page
(`main#app > section.hero > button.cta[1/2]`). On a Preact page in development, it also names the
components that rendered it and where its JSX is, so the agent goes straight to the source.

Mark ids are never reused in a session: `#7` is the same mark in every snapshot and every round.

## Several agent sessions at once

Each agent session, of whichever agent, reviews with you on a channel of its own, named like `sleepy-gecko`: in
different projects, in worktrees of one, or even in the same directory on the same dev server.
`redline wait` prints its channel's name, and the sidebar's bar shows it. So do, to match an agent
with its browser:

- **Firefox's window title**, `[sleepy-gecko] …`: the channel of the window's tab on screen, else
  the one its tabs are all bound to. Chrome has no such title.
- **[Herdr](https://herdr.dev)**: a wait run in one of its panes names the agent there after its
  channel, unless you named it yourself. Herdr forgets the name when the agent exits.

- A tab is bound to the channel of the agent that opened it (the one whose `redline wait` names
  the page's app, and that no other tab has yet). Its rounds go to that agent alone: while it is
  at work on the last round, the next one waits in the browser, never going to another agent.
- With several agents for the page's app, the bar has a menu to send the tab's rounds to another.
- A channel keeps its name from round to round (`redline wait --session`, which the skill gives
  Claude Code's session id; other agents' are found by their process), and a new wait of a channel stops its last one.
- Ten at once: the ten ports of 47390-47399.

## Browsers

Firefox first: it builds as Manifest V2, with a sidebar. Chrome builds as Manifest V3, with a side
panel, from the same sources (`yarn dev:chrome` in `packages/extension`).
