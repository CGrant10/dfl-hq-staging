// =====================================================================
// icons.js - the app's inline SVG glyphs.
// ---------------------------------------------------------------------
// These replace the emoji that had accumulated in the markup. An emoji is
// a font glyph: it renders as Apple's artwork on one device and Google's
// on another, it ignores currentColor so it cannot be themed, it sits on
// the text baseline at whatever size the font decides, and a screen
// reader announces its Unicode name mid-sentence.
//
// Every icon here draws in currentColor, sizes off one number, and is
// aria-hidden - the surrounding text already says what it means.
//
// PATHS ARE ON A 24x24 GRID so a caller can mix any two icons at the same
// size and get the same optical weight.
// =====================================================================

import { esc } from "./ui.js";

const PATHS = {
  /* A flame: presence, "somebody is lurking". */
  flame: `<path d="M12 2.5c2.6 3 3.4 5 2.4 6.6 1.2-.3 2-1.2 2.4-2.6C18.6 8.4 19.5 10.4 19.5 12a7.5 7.5 0 0 1-15 0c0-3.2 1.9-5.6 4.2-7.8-.4 1.9.1 3.2 1.1 3.9.6-2.4 1.3-4.2 2.2-5.6Z"/>
           <path d="M12 21a3.4 3.4 0 0 1-3.4-3.4c0-1.7 1.3-2.9 2.3-4.3.6 1.2 1.3 1.8 2 2.2 1 .6 2.5 1.3 2.5 2.9A3.4 3.4 0 0 1 12 21Z" opacity=".55"/>`,

  /* A stadium bowl seen from the side: members watching the Arena. */
  stadium: `<ellipse cx="12" cy="7.5" rx="9" ry="4" fill="none" stroke="currentColor" stroke-width="1.8"/>
            <path d="M3 7.5v5c0 2.2 4 4 9 4s9-1.8 9-4v-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            <ellipse cx="12" cy="7.5" rx="4" ry="1.7"/>`,

  /* A trophy: an Arena or race winner. */
  trophy: `<path d="M7 4h10v4.5a5 5 0 0 1-10 0V4Z"/>
           <path d="M7 5H4.5v1.5A3.5 3.5 0 0 0 8 10M17 5h2.5v1.5A3.5 3.5 0 0 1 16 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
           <path d="M10.5 13.2h3V17h-3z"/><rect x="7.5" y="17" width="9" height="2.4" rx="1.2"/>`,

  /* A chilli pepper: the Chip Eater badge. */
  chilli: `<path d="M14.5 4.2c.6-1 1.7-1.6 2.9-1.6.5 0 .8.4.8.8s-.3.8-.8.8c-.8 0-1.4.5-1.6 1.2"/>
           <path d="M15.6 5.6c1.2.9 1.9 2.4 1.9 4.1 0 4.9-4 8.9-8.9 8.9-2 0-3.7-.6-4.9-1.6-.4-.3-.3-.9.2-1 3.2-.9 5.2-2.4 6.6-4.4 1.2-1.8 1.8-3.9 2.3-5.6.2-.7 1-1 1.6-.6l1.2.2Z"/>`,

  /* A camera: attach a picture to a wall post. */
  camera: `<path d="M9.4 4h5.2l1.1 2H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.3l1.1-2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
           <circle cx="12" cy="12.5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/>`,

  /* A television: send a picture to the Broadcast inbox. */
  tv: `<rect x="2.5" y="6.5" width="19" height="13" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
       <path d="M8 3.2 12 6.4 16 3.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,

  /* A tick: something done - submitted, saved. */
  check: `<path d="M4.5 12.6l4.6 4.6L19.5 6.8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,

  /* A closed padlock: a golf player locked to a team. */
  lock: `<rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/>
         <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`,

  /* An open padlock: a golf player free to move. */
  unlock: `<rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/>
           <path d="M8 10.5V7.8a4 4 0 0 1 7.6-1.7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`,

  /* A star: a featured achievement. */
  star: `<path d="M12 3.2l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.6l6.1-.8L12 3.2Z"/>`,

  /* A shield: commissioner / privileged access. */
  shield: `<path d="M12 2.6l7.4 2.7v6c0 4.4-3 8.4-7.4 10.1-4.4-1.7-7.4-5.7-7.4-10.1v-6L12 2.6Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
           <path d="M8.6 12.2l2.5 2.5 4.3-4.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`,

  /* A person: the plain member view. */
  user: `<circle cx="12" cy="8.2" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/>
         <path d="M4.8 20.2c0-3.6 3.2-5.8 7.2-5.8s7.2 2.2 7.2 5.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,

  /* An American football: the favourite-team pill when no logo is shown. */
  football: `<path d="M20.4 3.6c1.4 4.6.1 10.2-3.4 13.7-3.5 3.5-9.1 4.8-13.7 3.4C1.9 16.1 3.2 10.5 6.7 7 10.2 3.5 15.8 2.2 20.4 3.6Z" fill="none" stroke="currentColor" stroke-width="1.8"/>
             <path d="M9.4 14.6l5.2-5.2M10.9 12.1l1.6 1.6M12.9 10.1l1.6 1.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
};

/**
 * One inline SVG glyph, drawn in currentColor.
 *
 * @param {keyof PATHS} name
 * @param {object} opts  size in px and an extra class name
 */
export function icon(name, { size = 16, className = "" } = {}) {
  const body = PATHS[name];
  if (!body) return "";
  const px = Number(size) || 16;
  /*
    THE GLYPH NAME IS A CLASS. Without it a stylesheet cannot say "a trophy
    is always gold" - it can only say "an icon in this container is gold",
    which means every new place a trophy appears has to be remembered
    somewhere else. ico-trophy travels with the trophy.
  */
  return `<svg class="ico ico-${esc(name)}${className ? ` ${className}` : ""}" width="${px}" height="${px}"
    viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Every glyph name, so a caller can be checked against the set. */
export function iconNames() { return Object.keys(PATHS); }
