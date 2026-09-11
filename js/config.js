// DFL HQ configuration
// Golf owns a sizeable set of self-mounting enhancements. Loading them from
// config.js made every visit (including Home) download and start their DOM
// observers. Keep the global navigation enhancement eager, but start the golf
// bundle only when the router actually enters Golf.
void import("./nav-neutral.js").catch(err => console.warn("Optional module failed: ./nav-neutral.js", err));
/* The week view above the Team Analyzer report. Self-mounting and route-gated,
   so it costs one module on boot and nothing until Analyzer is opened. */
void import("./weekly-outlook-panel.js")
  .then(module => module.mountWeeklyOutlook())
  .catch(err => console.warn("Optional module failed: ./weekly-outlook-panel.js", err));

const GOLF_FEATURES = [
  "./golf-gps-beta.js",
  "./golf-gps-red-trail-beta.js",
  "./golf-gps-rolla-beta.js",
  "./golf-gps-imported.js",
  "./golf-event-course-picker.js",
  "./golf-tournament-beta.js",
  "./golf-event-modes.js",
  "./golf-live-to-par.js",
  "./golf-scorecard.js",
  "./golf-matches.js",
  "./golf-live.js",
  "./golf-theme.js",
  "./golf-match.js",
  "./golf-courses.js",
  "./golf-draft.js",
  "./golf-bag.js",
];
let golfFeaturesPromise = null;
export function loadGolfFeatures() {
  if (!golfFeaturesPromise) {
    golfFeaturesPromise = Promise.allSettled(GOLF_FEATURES.map(modulePath => import(modulePath)))
      .then(results => {
        results.forEach((result, index) => {
          if (result.status === "rejected") console.warn(`Optional module failed: ${GOLF_FEATURES[index]}`, result.reason);
        });
      });
  }
  return golfFeaturesPromise;
}
export const SUPABASE_URL = "https://rqavvpdbfdrwzalikkjg.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_I14JPQNBW-fhIwZ7WkBlAg_M9zolGNL";
export const LEAGUE_NAME = "DFL HQ";
export const LEAGUE_FOUNDED = 2017;
export const FIRST_SYNCED_SEASON = 2019;
export const LEGACY_SEASONS = Math.max(0, FIRST_SYNCED_SEASON - LEAGUE_FOUNDED);
export const dflSeasonCount = (syncedSeasons = 0) => Math.max(0, Number(syncedSeasons) || 0) + LEGACY_SEASONS;
const META_VERSION = globalThis.document?.querySelector('meta[name="dfl-app-version"]')?.content || "0";
const RELEASE_FLOOR = "1.238.9";
const newer = (a,b) => { const x=String(a).split(".").map(Number),y=String(b).split(".").map(Number); for(let i=0;i<Math.max(x.length,y.length);i++){ const d=(x[i]||0)-(y[i]||0); if(d)return d>0?a:b; } return a; };
export const APP_VERSION = newer(META_VERSION, RELEASE_FLOOR);
