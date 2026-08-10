# Control Panel

A personal focus, goals and training tracker. Plain HTML, React and one JS file —
no build step, no server, no account.

## Running it

Open `index.html`. That's it. Hosted on GitHub Pages it also installs to an
iPhone home screen: open the page in Safari, tap Share, then **Add to Home
Screen**. It then opens fullscreen with its own icon.

## Where the data lives

Everything is stored in this browser's `localStorage`. It is not synced and it is
not backed up anywhere. Clearing Safari's site data, or losing the device, loses
it all.

Use **Now → Backup → Export file** regularly and keep the JSON somewhere real
(iCloud Drive, Drive, anywhere). **Import** restores it.

## Optional: task breakdown

The "Break into steps" button on the Tasks screen calls the Anthropic API. It
needs your own key, entered under **Now → Task breakdown**. The key is kept in
this browser and sent directly to Anthropic; it is never committed to this repo.
Every other feature works without it.

Anyone with physical access to the browser can read that key. If that matters,
leave it blank and write the steps yourself, or put a small server-side proxy in
front of the call instead.

## Sections

- **Now** — day remaining, daily routine checklist, settings, backup
- **Tasks** — quick capture and step breakdown
- **Focus** — adjustable countdown with a draining ring
- **Gym** — set logging with a volume trend chart
- **Goals** — monthly and long-term, with deadline countdowns
- **Upcoming** — calendar events, added by hand or imported from `.ics`

## Calendar import

There is no live calendar sync. Paste an `.ics` export, or one event per line as
`YYYY-MM-DD HH:MM | Title`. An iOS Shortcut can produce that format from your
existing calendars in a few seconds.

## Files

    index.html      page shell and PWA metadata
    app.js          the whole application, compiled
    vendor/         React 18, vendored so it works offline
    manifest.json   home-screen install metadata
    icon.png        app icon
