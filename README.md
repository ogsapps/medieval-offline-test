# The Scriptorium

**A Pomodoro of the Realm** — a medieval-themed Pomodoro timer with user-adjustable
timers, a royal ledger of completed vigils, and a chapel bell to mark the turning
of the sands.

No frameworks, no build step, no dependencies. Just Node.js and a parchment skin.

## Quick start

```bash
npm start
# The Scriptorium is open at http://localhost:4242
```

Then open <http://localhost:4242> in your browser.

```bash
PORT=8080 npm start   # a different port
npm test              # run the royal test suite
```

Requires Node.js 20 or newer.

## The three vigils

| Vigil | Purpose | Default |
| --- | --- | --- |
| **Study** (focus) | Deep work at the desk | 25 minutes |
| **Rest** (short break) | A brief respite | 5 minutes |
| **Feast** (long break) | A proper repast | 15 minutes |

After every *N* completed Study vigils (default 4), the next break is a Feast.
The wax seals beneath the dial show progress toward it.

## Amending the decrees

The **Royal Decrees** panel lets the scribe adjust:

- Study, Rest, and Feast lengths (1–180, 1–60, and 1–90 minutes)
- Seals before each Feast (2–12)
- Whether breaks and studies begin automatically
- Whether the chapel bell rings

Press **Seal the Decrees** to enact amendments. They are stored on the server in
`data/settings.json`, so they survive a restart and are available to every tab.
If the server cannot be reached, the browser keeps a local copy in
`localStorage` and says so plainly.

Changing a timer while the vigil is paused resets the current dial to the new
length; changing it mid-vigil applies to the next vigil.

## The ledger

Completed vigils are written to `data/sessions.json` and shown in **The Ledger of
Vigils**. The ledger holds the most recent 200 entries. **Burn the Ledger**
clears it after a solemn confirmation.

## Keyboard

- <kbd>Space</kbd> — begin or pause the vigil
- <kbd>R</kbd> — reset the sands

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Realm status |
| `GET` | `/api/settings` | Read the decrees |
| `PUT` | `/api/settings` | Amend the decrees (validated) |
| `GET` | `/api/sessions` | Read the ledger (newest first) |
| `POST` | `/api/sessions` | Record a vigil |
| `DELETE` | `/api/sessions` | Burn the ledger |

Example:

```bash
curl -X PUT http://localhost:4242/api/settings \
  -H 'Content-Type: application/json' \
  -d '{"focusMinutes":50,"shortBreakMinutes":10,"longBreakMinutes":25,"longBreakEvery":3}'
```

Invalid decrees are refused with a courteous `400` and a message fit for a scribe.
Unspecified fields keep their current values.

## Project layout

```
server.js          dependency-free HTTP server and API
lib/settings.js    defaults, limits, and decree validation
lib/store.js       atomic JSON persistence
public/            index.html, styles.css, app.js, favicon.svg
test/api.test.js   node:test suite for the API and validation
data/              settings.json and sessions.json (git-ignored)
```

## A note on the theme

The interface is dressed as a scriptorium: oak shadows, parchment, gold leaf, wax
seals, and a chapel bell synthesized with the Web Audio API. The backend speaks in
the same voice — errors are decrees, logs are raven reports, and the ledger is a
ledger. The year is MMXXVI; no candles were harmed.

## License

MIT — see [LICENSE](LICENSE).