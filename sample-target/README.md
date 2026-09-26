# Tiny Inbox (sample target)

A deliberately small app that Decypher operates on during the demo. It has a handful of
files with clear responsibilities so a change plan and a before/after comparison are easy
to read.

- `src/store.js`   — in-memory task store (the data model)
- `src/server.js`  — tiny HTTP server exposing `/api/tasks`
- `web/index.html` — the page shell
- `web/app.js`     — fetches tasks and renders the list
- `web/styles.css` — all of the visual styling (a good thing to *protect*)

Run it (this target is standalone, no dependencies):

```
node src/server.js   # then open http://localhost:4000
```
