// Arena theme metadata without the Pixi renderer.
//
// Admin forms, result labels, and other ordinary app pages only need names
// and slot keys. Keeping those here prevents them from downloading the full
// race renderer simply to print "DFL Originals".
import { CHARACTERS } from "./dfl-sprites.js";

export const THEMES = {
  dfl: {
    label: "DFL Originals",
    slots: CHARACTERS.map((c) => ({ key: c.id, label: c.label, art: "pixel", blurb: c.blurb })),
  },
};

const LEGACY_THEMES = {
  pokemon: "dfl", gen3: "dfl", ducks: "dfl", dinosaurs: "dfl", cars: "dfl",
};

export const resolveTheme = (theme) => THEMES[theme] ? theme : (LEGACY_THEMES[theme] || theme);
export const themeKeys = () => Object.keys(THEMES);
export const themeLabel = (key) => THEMES[resolveTheme(key)]?.label || key;
export const slotsFor = (theme) => THEMES[resolveTheme(theme)]?.slots || [];
