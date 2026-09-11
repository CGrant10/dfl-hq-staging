# Arena sprite assets

Drop PNGs in here and the Arena race uses them. Nothing is required — every
slot has a drawn SVG fallback, so the track looks finished with this folder
completely empty.

## Where files go

    assets/arena/sprites/<theme>/<slot>.png

`<theme>` is one of `pokemon`, `dinosaurs`, `ducks`, `cars`.
`<slot>` is a key from `THEMES` in `js/arena/sprites.js`, e.g.

    assets/arena/sprites/dinosaurs/trex.png
    assets/arena/sprites/ducks/mallard.png
    assets/arena/sprites/cars/f1.png
    assets/arena/sprites/pokemon/fire.png

A file that is missing simply falls back to the drawn shape, so you can add
art one image at a time and never see a broken lane.

## What the images should be

* **Facing right.** The racers run left to right.
* **Transparent background** (PNG).
* **Roughly 3:2**, about 96x64 or 128x84. They are drawn at 46x30, so
  anything much larger is wasted bytes on every page load.
* **Small.** Keep each one under ~15KB if you can. Twelve lanes means twelve
  requests.

## On copyright

The slot keys are deliberately generic — `fire`, `raptor`, `mallard`, `f1` —
rather than trademarked character names, because no sprite art ships with
this app. Pokémon sprites in particular are Nintendo's, and bundling them
into a league app that lives on a public GitHub Pages site is not a fight
worth having.

Use art you have the right to use: your own drawings, public domain or CC0
assets (Kenney.nl and OpenGameArt are good sources for cars and creatures),
or a paid pack you own. To add a theme, add an entry to `THEMES` in
`js/arena/sprites.js` and a matching folder here.


## Two ways to use your own art

**Per racer, from inside the app (easiest).** Sign in as commissioner, open an
Arena event, and each racer in the line-up has a **PNG** button. Pick any
image and the browser redraws it to a transparent 128x80 PNG before saving,
so a phone photo becomes a few kilobytes. `PNG ✓` means that racer has one;
the `↺` next to it goes back to the drawn sprite. Needs
`arena_sprites_schema.sql`.

That picture belongs to that racer *in that event*, which is the point — the
same person can be a duck in the draft-order race and a T-Rex in the
punishment race.

**Per theme slot, from this folder.** Drop a file at
`assets/arena/sprites/<theme>/<slot>.png` and add `"<theme>/<slot>"` to
`SPRITE_FILES` in `js/arena/sprites.js`. Useful for a full set you want
reused across every event. Unregistered slots stay drawn, so a half-finished
set never shows a broken lane.
