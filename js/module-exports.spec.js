// =====================================================================
// Every named import must resolve to a real export.
// ---------------------------------------------------------------------
// WHY THIS TEST EXISTS. Removing the DFL Pet deleted petOf() from
// profile-dfl.js, and pages/broadcast.js was still importing it. A missing
// named export is not a quiet `undefined` - it is a module-level
// SyntaxError that fails the ENTIRE page, so the shared Arena race view
// went white for anybody who opened it through Broadcast. Nothing caught
// it: the removal typechecked, every unit test passed, and the page that
// broke was one nobody re-opened.
//
// This walks the real import graph instead. It is deliberately a text
// scan rather than a set of dynamic imports: half these modules touch
// window, localStorage or a CDN at module scope and cannot be loaded in a
// test runner at all - which is the same reason the bug got through.
// =====================================================================

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = "js";
/* Vendored + generated bundles are not ours to lint: the hash-suffixed Pixi
   chunks and the pixi-runtime.js built from src/. Everything else under
   js/arena IS hand-written (race.js, the shims, duck-physics) and used to be
   skipped along with them, which left the Arena import graph uncovered. */
const VENDOR_FILE = /^(pixi-runtime\.js|[A-Za-z0-9]+-[A-Za-z0-9_-]{8}\.js)$/;

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sourceFiles(full, out);
    } else if (entry.name.endsWith(".js") && !entry.name.endsWith(".spec.js") && !VENDOR_FILE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Every name a module makes available to `import { ... }`. */
function namedExports(file) {
  const src = fs.readFileSync(file, "utf8");
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s+(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  /* `export { a, b as c }` - the exported name is whatever follows `as`. */
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  /* A re-export of everything: assume it satisfies any name rather than
     resolving the chain, which would need a real module resolver. */
  if (/^export\s+\*/m.test(src)) names.add("*");
  return names;
}

/** Every `import { ... } from "./relative"` in a module. */
function namedImports(file) {
  const src = fs.readFileSync(file, "utf8");
  const out = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const spec = m[2];
    if (!spec.startsWith(".")) continue;          // bare + CDN specifiers
    const names = m[1].split(",")
      .map((p) => p.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    /* The arena shims import "./race.js?legacy=1" to reach past the service
       worker rewrite. The query is not part of the path on disk. */
    const onDisk = spec.split("?")[0];
    out.push({ spec, names, target: path.normalize(path.join(path.dirname(file), onDisk)) });
  }
  return out;
}

const FILES = sourceFiles(ROOT);
const exportCache = new Map();
const exportsFor = (f) => {
  if (!exportCache.has(f)) exportCache.set(f, namedExports(f));
  return exportCache.get(f);
};

describe("the import graph", () => {
  it("finds the app's modules", () => {
    expect(FILES.length).toBeGreaterThan(40);
  });

  it("points every relative import at a file that exists", () => {
    const broken = [];
    for (const file of FILES) {
      for (const imp of namedImports(file)) {
        if (!fs.existsSync(imp.target)) broken.push(`${file} -> ${imp.spec}`);
      }
    }
    expect(broken).toEqual([]);
  });

  /*
    THE ONE THAT WOULD HAVE CAUGHT THE PET BUG. If this fails, the named
    import is gone from the module it comes from, and the page doing the
    importing is dead on arrival - not degraded, dead.
  */
  it("resolves every named import to a real export", () => {
    const missing = [];
    for (const file of FILES) {
      for (const imp of namedImports(file)) {
        if (!fs.existsSync(imp.target)) continue;   // reported above
        const available = exportsFor(imp.target);
        if (available.has("*")) continue;
        for (const name of imp.names) {
          if (!available.has(name)) {
            missing.push(`${file} imports { ${name} } from "${imp.spec}"`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  /* A stale import of a module that no longer exists at all is the other
     half of the same failure, and cheap to rule out. */
  it("has no import of a deleted module", () => {
    for (const file of FILES) {
      for (const imp of namedImports(file)) {
        expect(fs.existsSync(imp.target), `${file} -> ${imp.spec}`).toBe(true);
      }
    }
  });
});

describe("the initial app shell", () => {
  it("does not eagerly boot golf feature modules on every route", () => {
    const html = fs.readFileSync("index.html", "utf8");
    const config = fs.readFileSync("js/config.js", "utf8");
    expect(html).not.toMatch(/<script[^>]+src=["']js\/golf-/);
    expect(config).toContain("export function loadGolfFeatures()");
  });

  it("does not keep the Broadcast blur poll alive outside Broadcast", () => {
    const source = fs.readFileSync("js/arena/mobile-broadcast-performance.js", "utf8");
    expect(source).toMatch(/if \(isPhoneBroadcast\(\)\) blurTimer = window\.setInterval/);
  });

  it("keeps Pixi out of ordinary metadata consumers", () => {
    const sections = fs.readFileSync("js/sections.js", "utf8");
    const results = fs.readFileSync("js/pages/arena-results.js", "utf8");
    expect(sections).toContain("arena/sprite-themes.js");
    expect(results).toContain("arena/sprite-themes.js");
    expect(sections).not.toMatch(/from ["'][^"']*arena\/sprites\.js["']/);
    expect(results).not.toMatch(/from ["'][^"']*arena\/sprites\.js["']/);
  });
});

describe("the supported golf GPS courses", () => {
  const configs = [
    "js/golf-gps-beta.js",
    "js/golf-gps-red-trail-beta.js",
    "js/golf-gps-rolla-beta.js",
  ];

  it.each(configs)("keeps nine explicit green targets in %s", (file) => {
    const source = fs.readFileSync(file, "utf8");
    const greenConfig = source.split("holeTargets:")[1];
    const targets = [...greenConfig.matchAll(/^\s*(\d+):\{lat:([-\d.]+),lng:([-\d.]+)\}/gm)];
    expect(targets.map((match) => Number(match[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(targets.map((match) => `${match[2]},${match[3]}`)).size).toBe(9);
    expect(source).toMatch(/yards to Hole \$\{hole\} green|label:/);
  });

  it("keeps nine explicit Rolla fairway targets for hole-only framing", () => {
    const source = fs.readFileSync("js/golf-gps-rolla-beta.js", "utf8");
    const fairwayConfig = source.split("fairwayTargets:")[1].split("holeTargets:")[0];
    const targets = [...fairwayConfig.matchAll(/^\s*(\d+):\{lat:([-\d.]+),lng:([-\d.]+)\}/gm)];
    expect(targets.map((match) => Number(match[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(source).toContain("projects the tee along that bearing");
  });

  it("routes imported courses through stored hole geometry", () => {
    const source = fs.readFileSync("js/golf-gps-imported.js", "utf8");
    expect(source).toContain('key:"imported"');
    expect(source).toContain("golf_course_holes");
    expect(source).toContain("setupCourseGps");
  });

  it("keeps the DFL app navigation visible during a Quick Round", () => {
    const source = fs.readFileSync("js/golf-event-modes.js", "utf8");
    expect(source).toContain("body.gqm-focus .golf-event-head,body.gqm-focus .guest-strip");
    expect(source).not.toMatch(/body\.gqm-focus \.topbar[^`]+display:none/);
    expect(source).not.toMatch(/body\.gqm-focus \.tabbar[^`]+display:none/);
    expect(source).not.toMatch(/body\.gqm-focus \.bottomline[^`]+display:none/);
  });

  it("lets Golf inherit the app theme and offers a temporary Fairway preview", () => {
    const source = fs.readFileSync("js/golf-theme.js", "utf8");
    const golfCss = fs.readFileSync("css/golf.css", "utf8");
    const navCss = fs.readFileSync("css/nav-neutral.css", "utf8");
    expect(source).toContain('pinMode(tryingFairway ? "fairway" : undefined)');
    expect(source).toContain('pinMode();');
    expect(source).toContain('"Try Fairway theme"');
    expect(source).toContain('"Use previous theme"');
    expect(source).not.toContain("localStorage.setItem");
    expect(source).toContain("classList.toggle(GOLF_CONTENT_CLASS, onGolf())");
    expect(golfCss).toContain("body.golf-content #view");
    expect(golfCss).toContain(".golf-fairway-try");
    expect(golfCss).not.toMatch(/body\.golf-content\s+\.(?:topbar|tabbar|whoami)/);
    expect(navCss).toContain("color:var(--muted) !important");
    expect(navCss).not.toContain("color:#f5f7fa !important");
  });

  it("offers a synchronized Fairway Light app palette", () => {
    const theme = fs.readFileSync("js/theme.js", "utf8");
    const memberScope = fs.readFileSync("js/member-theme-scope.js", "utf8");
    const schema = fs.readFileSync("theme_sync_schema.sql", "utf8");
    expect(theme).toContain('fairway: {');
    expect(theme).toContain('{ id: "fairway", name: "Fairway Light" }');
    expect(theme).toContain('name === "light" || name === "fairway"');
    expect(theme).toContain('setAttribute("data-palette", name)');
    expect(memberScope).toContain('"fairway"');
    expect(schema).toContain("'system', 'dark', 'light', 'fairway', 'medicine'");
  });

  it("offers Medicine Wheel Light, and treats it as a light surface", () => {
    const theme = fs.readFileSync("js/theme.js", "utf8");
    const memberScope = fs.readFileSync("js/member-theme-scope.js", "utf8");
    const styles = fs.readFileSync("css/style.css", "utf8");
    const schema = fs.readFileSync("theme_sync_schema.sql", "utf8");
    expect(theme).toContain('"medicine-light": {');
    expect(theme).toContain('{ id: "medicine-light", name: "Medicine Wheel Light" }');
    /*
      THE THREE LISTS THAT HAVE TO AGREE, and every one of them fails quietly
      rather than loudly. Out of PICKABLE and the palette cannot be chosen; out
      of the lightSurface test and the browser draws dark <select> popups and
      every [data-mode="light"] rule in the CSS stops applying to it; out of
      the CHECK and the choice is stored as "no preference", so it works on the
      device that picked it and never follows the member anywhere else.
    */
    expect(theme).toContain('const PICKABLE = ["dark", "light", "fairway", "medicine", "medicine-light"]');
    expect(theme).toContain('name === "medicine-light"');
    expect(memberScope).toContain('"medicine-light"');
    expect(schema).toContain("'fairway', 'medicine', 'medicine-light'");
    /* The bar is always dark, so it carries its own accents - see the note in
       apply(). Without this the creed's stars are drawn in a dark ink on a
       black band in every light palette, which is where they had been. */
    expect(theme).toContain('s.setProperty("--bar-ink", m.barInk || m.accent)');
    expect(styles).toContain("color: var(--bar-ink);");
  });

  it("keeps typography and component geometry consistent across app themes", () => {
    const tokens = fs.readFileSync("css/tokens.css", "utf8");
    const ui = fs.readFileSync("css/ui.css", "utf8");
    const styles = fs.readFileSync("css/style.css", "utf8");
    const admin = fs.readFileSync("css/admin.css", "utf8");
    expect(tokens).toContain("--font-body: var(--font-display)");
    expect(tokens).toContain("--r-control: 10px");
    expect(tokens).toContain(":where(button, input, select, textarea)");
    expect(styles).toContain("--card-surface:");
    expect(styles).toContain("radial-gradient(ellipse 88% 72% at 0% 0%");
    expect(styles).toContain("transparent 70%)");
    expect(styles).toContain("linear-gradient(180deg");
    expect(styles).toContain("--card-border:");
    expect(ui).toContain("background: var(--card-surface)");
    expect(ui).toContain("border: 1px solid var(--card-border)");
    expect(admin).toContain("background:var(--card-surface)");
    expect(ui).toContain("border-radius: var(--r-control)");
    expect(styles).not.toContain(':root[data-mode="fairway"] {\n  --font-body');
  });

  it("keeps a locked Profile actionable when its status check is interrupted", () => {
    const profileLock = fs.readFileSync("js/pages/profile-locked.js", "utf8");
    const screens = fs.readFileSync("css/screens.css", "utf8");
    expect(profileLock).toContain('statusUnknown?"Unlock profile":"Profile locked"');
    expect(profileLock).toContain('id="profile-lock-retry"');
    expect(profileLock).toContain('profile_verify_pin');
    expect(profileLock).toContain('else if(!unlocked(member.id)){gate(view,member,{statusUnknown:true});return;}');
    expect(screens).toContain(".pin-panel {");
    expect(screens).toContain("background: var(--card-surface);");
  });

  it("uses an in-app PIN keypad for initial member and commissioner access", () => {
    const memberLock = fs.readFileSync("js/member-lock.js", "utf8");
    const app = fs.readFileSync("js/app.js", "utf8");
    expect(memberLock).toContain("data-pin-pad");
    expect(memberLock).toContain('type="hidden"');
    expect(memberLock).toContain("data-pin-key");
    expect(memberLock).toContain('addEventListener("pointerdown",pointerdown)');
    expect(memberLock).toContain("lastTouchButton");
    expect(memberLock).toContain("data-trust-device");
    expect(memberLock).toContain("dfl.profile.trustedDevice");
    expect(memberLock).toContain("localStorage.removeItem(trustedKey(memberId))");
    expect(memberLock).not.toContain("localStorage.setItem(pinKey");
    expect(memberLock).not.toContain("is-current");
    expect(memberLock).not.toContain("data-pin-key=\"1\"]')?.focus");
    expect(memberLock).not.toContain('id="member-lock-pin" name="dfl-member-pin" type="text"');
    expect(app).toContain('classList.add("access-card","welcome-card")');
  });

  it("loads the app shell immediately from cache and protects active scores during updates", () => {
    const worker = fs.readFileSync("sw.js", "utf8");
    const updater = fs.readFileSync("js/update.js", "utf8");
    expect(worker).toContain("const SHELL_URLS = new Set");
    expect(worker).toContain("event.waitUntil(refresh.then(()=>{}))");
    expect(worker).toContain("if(cached)return cached");
    expect(updater).toContain("const UPDATE_CHECK_MS=10*60*1000");
    expect(updater).toContain("export function updateBlocked()");
    expect(updater).toContain('localStorage.getItem("dfl.golf.pending")');
  });

  it("shows the live GPS reading in the Quick Round GPS badge", () => {
    const source = fs.readFileSync("js/golf-gps-course-map.js", "utf8");
    // The badge used to render officialYards() - the yardage printed on the
    // card - so it never counted down while you walked the hole. It now shows
    // the live reading and falls back to the card only before the first fix.
    expect(source).toContain('${shown?formatYards(shown):"—"}</strong>');
    expect(source).toContain('value!=null?"LIVE":uiEsc(badgeLabel)');
    expect(source).not.toContain("if(slot&&!beta)startGps()");
    expect(source).toContain("watchGolfMount(mount)");
    expect(source).toContain('title:"Your GPS location"');
  });

  it("tears the real page rather than laying a coloured sheet over it", () => {
    const ui = fs.readFileSync("js/member-preview.js", "utf8");
    // The overlay version distorted nothing the eye cared about - the text and
    // cards underneath stayed perfectly still, which is what made it read as
    // stuck on. An SVG filter works on the element's own rendered pixels.
    expect(ui).toContain("feDisplacementMap");
    expect(ui).toContain("feTurbulence");
    expect(ui).toContain("body.is-tearing #view,body.is-tearing .topbar{filter:url(#${FILTER_ID})}");
    // The coloured panes are gone; the split happens on real artwork now.
    expect(ui).not.toContain("dfl-glitch-rgb");
    // Full-page filters are real GPU work, so it measures itself once and
    // stops tearing for good on a device that cannot keep up.
    expect(ui).toContain("function watchFilterCost()");
    expect(ui).toContain("median > 28");
    expect(ui).toContain("const filterAllowed =");
  });

  it("draws the switch and its CRT transition from the palette, not its own colours", () => {
    const ui = fs.readFileSync("js/member-preview.js", "utf8");
    // The channel split is the crest pair for whichever palette is on.
    expect(ui).toContain("var(--accent-fill)");
    expect(ui).toContain("var(--accent-2-fill)");
    // No hardcoded cyan, magenta or gold left driving anything.
    expect(ui).not.toContain("#3fc9ea");
    expect(ui).not.toContain("#5ad1a0");
    expect(ui).not.toContain("rgba(255,212,0,");
    expect(ui).not.toContain("rgba(138,255,216,");
    // screen has no headroom on a near-white ground, so light grounds multiply.
    expect(ui).toContain("--dfl-glitch-blend:screen");
    expect(ui).toContain('[data-mode="light"]{--dfl-glitch-blend:multiply}');
    // theme.js collapses every light-surface palette to data-mode="light", so
    // naming Fairway here would be dead code.
    expect(ui).not.toContain('[data-mode="fairway"]');
    // Scanlines mix from --text so they invert with the ground automatically.
    expect(ui).toContain("--dfl-scan:color-mix(in srgb,var(--text)");
  });

  it("shows the member-view switch to any commissioner and names the view they are in", () => {
    const ui = fs.readFileSync("js/member-preview.js", "utf8");
    const lock = fs.readFileSync("js/member-lock.js", "utf8");
    const worker = fs.readFileSync("sw.js", "utf8");
    // Visibility follows being a commissioner, not holding credentials right now.
    expect(ui).toContain("commissionerMember ? \"locked\" : \"none\"");
    expect(lock).toContain("export async function isCommissionerMember");
    // A commissioner who picked Member View at sign-in has no credentials to
    // set aside, so the switch asks for the PIN before it can move.
    expect(lock).toContain("export async function requestCommissionerAccess");
    expect(ui).toContain("await requestCommissionerAccess()");
    // The PIN prompt must not bounce the caller to #/home.
    expect(lock).toContain("stayPut=false");
    expect(lock).toContain("if(stayPut){onDone?.(true)}");
    // The view is named in words at every width - dropping the label on narrow
    // phones is what left the current view unidentified.
    expect(ui).toContain("dfl-preview-word");
    expect(ui).toContain("dfl-preview-short");
    expect(ui).not.toContain(".dfl-preview-label{display:none}");
    expect(worker).toContain("./js/member-lock.js");
  });

  it("re-decides whether the member-view switch is on screen when access changes", () => {
    const gate = fs.readFileSync("js/supabase.js", "utf8");
    const ui = fs.readFileSync("js/member-preview.js", "utf8");
    // The switch shipped invisible because it decided once at boot, before the
    // commissioner PIN had been entered, and never looked again. Access is
    // granted from a form submit in member-lock.js and on the Admin page, so
    // supabase.js has to say when it changes.
    expect(gate).toContain('export const ACCESS_EVENT = "dfl:access-change"');
    for (const fn of ["adminLogin", "commissionerLogin", "adminLogout"]) {
      expect(gate.slice(gate.indexOf(`function ${fn}`))).toContain("announceAccessChange()");
    }
    expect(ui).toContain("window.addEventListener(ACCESS_EVENT");
    expect(ui).toContain('window.addEventListener("dfl:pick-member"');
    expect(ui).toContain("onRoute(() => refreshMemberPreview())");
    // A second tap mid-transition would commit twice and leave the switch
    // disagreeing with the gates.
    expect(ui).toContain("if (switching) return;");
  });

  it("lets a commissioner view the app as a member without keeping write access", () => {
    const gate = fs.readFileSync("js/supabase.js", "utf8");
    const ui = fs.readFileSync("js/member-preview.js", "utf8");
    const worker = fs.readFileSync("sw.js", "utf8");
    // A preview that hides the buttons but keeps the commissioner client is a
    // preview that lies, so db() must hand back the public client first.
    expect(gate).toContain("if (isMemberPreview()) return makePublicClient();");
    for (const accessor of ["isAdmin", "isMasterAdmin", "isCommissioner", "isCommissionerOwner"]) {
      expect(gate).toContain(`export function ${accessor}() { return !isMemberPreview()`);
    }
    expect(gate).toContain("if (isMemberPreview()) return false;");
    // canPreviewAsMember() decides whether the toggle exists at all, so it must
    // read the raw credentials rather than the gates it turns off.
    expect(gate).toContain("export function canPreviewAsMember()");
    expect(gate).not.toContain("export function canPreviewAsMember() { return isAdmin()");
    // Per tab, so it survives a reload without outliving the app.
    expect(gate).toContain("sessionStorage.getItem(MEMBER_PREVIEW_KEY)");
    expect(ui).toContain("void renderRoute()");
    expect(ui).toContain("is-member-preview");
    expect(worker).toContain("./js/member-preview.js");
  });

  it("maps front, center and back of every green and rings the player with layup arcs", () => {
    const source = fs.readFileSync("js/golf-gps-course-map.js", "utf8");
    const schema = fs.readFileSync("golf_gps_green_points_schema.sql", "utf8");
    expect(source).toContain('data-map-endpoint="front"');
    expect(source).toContain('data-map-endpoint="back"');
    expect(source).toContain("function greenReadings()");
    expect(source).toContain("GREEN_HALF_DEPTH=16");
    expect(source).toContain("[100,150,200,250]");
    expect(source).toContain("dfl-gps-arc-label");
    // A database without the migration must still answer, on the original columns.
    expect(source).toContain("if(holes.error)holes=await db().from(\"golf_course_holes\").select(GEOMETRY_COLUMNS)");
    expect(schema).toContain("front_lat double precision");
    expect(schema).toContain("back_lng double precision");
  });

  it("turns the hole to face the green and still detects holes with no mapped tees", () => {
    const source = fs.readFileSync("js/golf-gps-course-map.js", "utf8");
    expect(source).toContain("function applyHoleView()");
    expect(source).toContain("rotateX(56deg) rotate(var(--gps-rot,0deg))");
    // Calibration taps have to land on real coordinates, so the tilt drops flat.
    expect(source).toContain("holeView&&!mappingKind&&bearing!=null");
    // Center and Red Trail ship greens only; detection falls back to them.
    expect(source).toContain("nearest=nearestTeeHole(point,greenTargets,120)");
  });

  it("renders a full-hole satellite GPS experience with an imagery fallback", () => {
    const source = fs.readFileSync("js/golf-gps-course-map.js", "utf8");
    expect(source).toContain("Promise.all([stylesheet,library])");
    expect(source).toContain("World_Imagery/MapServer/export");
    expect(source).toContain('className="dfl-gps-panel is-hole-experience"');
    expect(source).toContain("dfl-gps-distance-pill");
    expect(source).toContain("data-gps-score");
    expect(source).toContain('color:"#fff",weight:3');
  });

  it("shares commissioner tee and green calibration and follows a player from the tee", () => {
    const source = fs.readFileSync("js/golf-gps-course-map.js", "utf8");
    const schema = fs.readFileSync("golf_gps_geometry_schema.sql", "utf8");
    expect(source).toContain('hasPermission("golf")');
    expect(source).toContain('data-map-endpoint="tee"');
    expect(source).toContain('data-map-endpoint="green"');
    expect(source).toContain('nearestTeeHole(point,tees,140)');
    expect(source).toContain('followMode=true');
    expect(source).toContain('rawLat==null||rawLat===""||rawLng==null||rawLng===""');
    expect(schema).toContain("tee_lat double precision");
    expect(schema).toContain("green_lat double precision");
  });

  it("uses active theme tokens throughout Quick Round scoring", () => {
    const source = fs.readFileSync("js/golf-event-modes.js", "utf8");
    const personal = fs.readFileSync("js/golf-quick-round.js", "utf8");
    const privacy = fs.readFileSync("golf_quick_round_privacy_schema.sql", "utf8");
    expect(source).toContain(".gqm-focus-shell{background:var(--bg);color:var(--text)");
    expect(source).toContain(".gqm-add-score{border-color:var(--control-line);background:var(--bg-2);color:var(--text)");
    expect(source).toContain(".gqm-scorecard-page{background:var(--bg);color:var(--text)");
    expect(source).toContain(".gqm-sheet{border:1px solid var(--line);background:var(--bg-2);color:var(--text)");
    expect(source).toContain("Compact themed score entry sheet");
    expect(source).toContain('class="gqm-score-control"><span class="gqm-control-label">Strokes</span>');
    expect(source).toContain(".gqm-vstep button:last-child{border-color:transparent;background:var(--accent-2-fill);color:var(--on-accent)}");
    expect(source).toContain(".gqm-actions{padding-bottom:calc(82px + env(safe-area-inset-bottom))}");
    expect(source).toContain(".gqm-focus-shell.is-scorecard{width:100%;max-width:none}");
    expect(source).toContain(".gqm-focus-shell.is-scorecard .gqm-score-paper{overflow-y:auto;padding-bottom:calc(78px + env(safe-area-inset-bottom))}");
    expect(personal).toContain("Keep this round private");
    expect(personal).toContain("My Quick Rounds");
    expect(personal).toContain("is_private:isPrivate");
    expect(privacy).toContain("not is_private or created_by = dfl_current_member()");
    expect(fs.readFileSync("js/golf-tournament-beta.js", "utf8")).toContain(".tb-scorecard{bottom:calc(68px + env(safe-area-inset-bottom))}");
    expect(fs.readFileSync("js/golf-tournament-beta.js", "utf8")).toContain(".tb-bottom.is-member{grid-template-columns:1fr 1fr;");
    expect(fs.readFileSync("js/golf-tournament-beta.js", "utf8")).toContain("Scorecard Legend");
    expect(fs.readFileSync("js/golf-tournament-beta.js", "utf8")).toContain("Fairway bunker");
    expect(source).toContain('.gqm-hidden-engine button,.gqm-hidden-engine input,.gqm-hidden-engine select');
  });

  it("opens each golf event in its own shell and keeps event creation concise", () => {
    const golf = fs.readFileSync("js/pages/golf.js", "utf8");
    const outingRoute = golf.slice(golf.indexOf("async function renderOuting"));
    const modes = fs.readFileSync("js/golf-event-modes.js", "utf8");
    const courses = fs.readFileSync("js/golf-courses.js", "utf8");
    const inline = fs.readFileSync("js/inline.js", "utf8");
    expect(golf).toContain('data-event-type="${esc(o.event_type||"tournament")}"');
    expect(golf).toContain('o.event_type==="quick"?"Quick Round":o.event_type==="tournament_beta"?"Tournament Beta":"Tournament"');
    expect(golf).toContain('class="gqm-route-loading" role="status"');
    expect(outingRoute.indexOf('if(outing.event_type==="quick")')).toBeLessThan(outingRoute.indexOf('db().from("golf_participants")'));
    expect(inline).toContain('new Set(["name","event_date","event_time","notes"])');
    expect(inline).toContain('label:"Notes (optional)"');
    expect(inline).toContain('f.name==="event_time"?{...f,label:"Tee time (optional)",required:false}');
    expect(inline).toContain('payload.holes=18;payload.status="setup"');
    expect(modes).toContain("data-gqm-event-setup");
    expect(modes).toContain("data-gqm-setup-course");
    expect(modes).toContain("data-gqm-setup-holes");
    expect(courses).toContain('root.querySelector(".tb-setup")');
    expect(courses).toContain("scorecards, yardages and GPS");
    expect(courses).toContain('window.dispatchEvent(new HashChangeEvent("hashchange"))');
    expect(courses).not.toContain("location.reload()");
  });

  it("keeps score results on scorecards and shows complete nine totals", () => {
    const quick = fs.readFileSync("js/golf-event-modes.js", "utf8");
    const team = fs.readFileSync("js/golf-scorecard.js", "utf8");
    const beta = fs.readFileSync("js/golf-tournament-beta.js", "utf8");
    expect(quick).not.toContain("data-gqm-entry-result");
    expect(quick).toContain("data-gqm-table-front");
    expect(quick).toContain("data-gqm-table-back");
    expect(team).toContain("data-final-front");
    expect(team).toContain("data-final-back");
    expect(team).toContain("<small>Total 18</small>");
    expect(beta).toContain("<th>Front 9</th>");
    expect(beta).toContain("<th>Back 9</th><th>+/−</th><th>Total ${count}</th>");
    expect(beta).toContain(".tb-quick-add{border-color:var(--control-line)!important;background:var(--bg-3)!important;color:var(--text)!important");
    expect(beta).toContain('Number(row.strokes) ? `<span>${Number(row.strokes)}</span>Edit score');
    expect(beta).toContain('function headToHead(entry, mine)');
    expect(beta).toContain('matchPlay ? [result.cardWonA || 0, result.cardWonB || 0] : [result.a || 0, result.b || 0]');
    expect(beta).toContain('${tabs}${gps}${quickMatch}${memberEntry}');
    expect(beta).toContain("data-tb-reset-scores");
    expect(beta).toContain('dropPendingSides(sideIds)');
    expect(beta).toContain('persistedScoreCount: scr.data.length');
  });

  it("loads current commissioner access and preserves an unchanged PIN", () => {
    const panel = fs.readFileSync("js/pages/admin_commissioners.js", "utf8");
    const migration = fs.readFileSync("commissioner_access_editor_schema.sql", "utf8");
    expect(panel).toContain('rpc("list_commissioner_access")');
    expect(panel).toContain('Leave blank to keep current PIN');
    expect(panel).toContain('permissions.has(box.value)');
    expect(panel).toContain('new_pin: pin.value');
    expect(migration).toContain("returns table(member_id bigint, is_owner boolean, permissions jsonb, active boolean)");
    expect(migration).toContain("elsif resolved_hash is null then");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("revoke execute on function public.list_commissioner_access() from public");
  });

  it("exposes guest setup, selected scoring, and no setup GPS bubble", () => {
    const beta = fs.readFileSync("js/golf-tournament-beta.js", "utf8");
    const gps = fs.readFileSync("js/golf-gps-course-map.js", "utf8");
    expect(beta).toContain("Guest access code");
    expect(beta).toContain("data-tb-set-code");
    expect(beta).toContain("eventHasCode(db(), id)");
    expect(beta).toContain('aria-pressed="${selectedScoring === s}"');
    expect(beta).toContain("ROUND SCORING");
    expect(gps).toContain('(beta&&!card.querySelector("[data-tb-gps-slot]"))');
  });

  it("supports remote Tournament Beta golfers on different courses", () => {
    const beta = fs.readFileSync("js/golf-tournament-beta.js", "utf8");
    const board = fs.readFileSync("js/golf-board.js", "utf8");
    const migration = fs.readFileSync("golf_tournament_beta_multi_course_schema.sql", "utf8");
    expect(beta).toContain("data-tb-player-course");
    expect(beta).toContain("OPTIONAL · REMOTE PLAY");
    expect(beta).toContain("tb-course-divider");
    expect(beta).toContain("courseHolesById");
    expect(board).toContain("ball.holes || holes");
    expect(migration).toContain("add column if not exists course_id bigint");
    expect(migration).toContain("references public.golf_courses(id) on delete set null");
  });

  it("supports event Quick Round golfers on separate courses", () => {
    const quickEvent = fs.readFileSync("js/golf-event-modes.js", "utf8");
    expect(quickEvent).toContain("quickCourseGroups");
    expect(quickEvent).toContain("quickHolesFor");
    expect(quickEvent).toContain("data-gqm-member-course");
    expect(quickEvent).toContain("data-gqm-player-course-edit");
    expect(quickEvent).toContain("data-gqm-course-section");
    expect(quickEvent).toContain('.in("course_id",courseIds)');
  });
});
