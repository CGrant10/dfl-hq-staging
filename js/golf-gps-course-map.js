/* Shared hole-aware GPS and satellite map for supported DFL courses. */
import { db, hasPermission } from "./supabase.js";
import { currentMember } from "./members.js";
import { toast } from "./ui.js";
import { recommendClub } from "./golf-club-recommendation.js";
import { capHoleDistance, distanceYards, holeZoom, isOutsideHole, nearestTeeHole } from "./golf-gps-distance.js";

const LEAFLET_JS="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css";
const SATELLITE_TILES="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
let leafletPromise=null;
const gpsMountCallbacks=new Set();
let gpsMountObserver=null,gpsMountQueued=false;
function watchGolfMount(callback){
  gpsMountCallbacks.add(callback);
  if(gpsMountObserver)return;
  const run=()=>{if(gpsMountQueued)return;gpsMountQueued=true;queueMicrotask(()=>{gpsMountQueued=false;if(!location.hash.startsWith("#/golf"))return;gpsMountCallbacks.forEach(mount=>mount())})};
  gpsMountObserver=new MutationObserver(run);gpsMountObserver.observe(document.body,{childList:true,subtree:true});
}
const uiEsc=value=>String(value??"").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const toYards=meters=>Math.round(Number(meters||0)*1.0936133);
const formatYards=value=>String(Math.round(Number(value)||0)).replace(/\B(?=(\d{3})+(?!\d))/g,",");
const fixPoint=p=>({lat:Number(p?.coords?.latitude),lng:Number(p?.coords?.longitude)});
const fixQuality=accuracy=>accuracy<=10?"Excellent":accuracy<=25?"Good":accuracy<=55?"Fair":"Weak";
function load(key){try{return JSON.parse(localStorage.getItem(key)||"{}")||{}}catch{return {}}}
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}
function scorecardHole(card){const beta=Number(card?.dataset.tbHole);if(beta>0)return beta;const selected=Number(card.querySelector("[data-gqm-entry]")?.dataset.activeHole);if(selected>0)return selected;for(const input of card.querySelectorAll("input[data-team-score]")){if(!String(input.value||"").trim())return Number(input.dataset.hole)||1}return 1}
function courseText(view){return [...view.querySelectorAll(".golf-event-head .golf-meta span,.tb-sub strong,.gqm-course strong")].map(node=>node.textContent||"").join(" ")}
function fullMapUrl(query){return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`}
function loadLeaflet(){
  if(globalThis.L)return Promise.resolve(globalThis.L);
  if(leafletPromise)return leafletPromise;
  const stylesheet=new Promise((resolve,reject)=>{
    const old=document.getElementById("dfl-leaflet-css");
    if(old?.sheet){resolve();return}
    const link=old||document.createElement("link");
    link.addEventListener("load",resolve,{once:true});link.addEventListener("error",()=>reject(Error("Could not load map styling")),{once:true});
    if(!old){link.id="dfl-leaflet-css";link.rel="stylesheet";link.href=LEAFLET_CSS;document.head.appendChild(link)}
  });
  const library=new Promise((resolve,reject)=>{
    const old=document.getElementById("dfl-leaflet-js");
    if(globalThis.L){resolve(globalThis.L);return}
    const script=old||document.createElement("script");
    script.addEventListener("load",()=>resolve(globalThis.L),{once:true});script.addEventListener("error",()=>reject(Error("Could not load the course map")),{once:true});
    if(!old){script.id="dfl-leaflet-js";script.src=LEAFLET_JS;document.head.appendChild(script)}
  });
  leafletPromise=Promise.all([stylesheet,library]).then(([,L])=>L);
  return leafletPromise;
}

function satelliteBounds(a,b){const first=a||b,second=b||a;if(!first)return null;const south=Math.min(first.lat,second.lat),north=Math.max(first.lat,second.lat),west=Math.min(first.lng,second.lng),east=Math.max(first.lng,second.lng),latSpan=Math.max(north-south,.0007),lngSpan=Math.max(east-west,.0007),latPad=latSpan*.34,lngPad=lngSpan*.46;return[[south-latPad,west-lngPad],[north+latPad,east+lngPad]]}
function satelliteExportUrl(bounds){if(!bounds)return"";const[[south,west],[north,east]]=bounds,bbox=[west,south,east,north].join(","),params=new URLSearchParams({bbox,bboxSR:"4326",imageSR:"4326",size:"900,1400",format:"jpg",f:"image"});return`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?${params}`}

function ensureStyles(){if(document.getElementById("dfl-course-gps-style"))return;const style=document.createElement("style");style.id="dfl-course-gps-style";style.textContent=`.dfl-gps-bubble{position:fixed;right:12px;bottom:calc(78px + env(safe-area-inset-bottom));z-index:70;min-width:104px;border:1px solid rgba(255,214,0,.42);border-radius:18px;padding:9px 12px;background:rgba(7,15,24,.97);color:var(--text);box-shadow:0 10px 28px rgba(0,0,0,.44);text-align:center;font:inherit}.dfl-gps-bubble strong{display:block;font-size:25px;line-height:1;font-variant-numeric:tabular-nums}.dfl-gps-bubble small{display:block;margin-top:4px;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:900}.dfl-gps-bubble em{color:#ffd400;font-style:normal}.dfl-gps-bubble.is-quick-round{position:static;right:auto;bottom:auto;z-index:auto;width:82px;min-width:82px;height:82px;padding:7px 5px;border:2px solid #dbe5ec;border-radius:50%;background:#132941;box-shadow:inset 0 0 0 3px #132941,0 0 0 2px #36526a}.dfl-gps-bubble.is-quick-round strong{font-size:27px;color:#fff}.dfl-gps-bubble.is-quick-round small{margin-top:3px;font-size:8px;color:#fff}.dfl-gps-bubble.is-quick-round .dfl-gps-badge-label{margin:0 0 3px;color:#9dcc45}.dfl-gps-panel{position:fixed;inset:0;z-index:100;background:#07101b;color:var(--text);display:grid;grid-template-rows:auto minmax(250px,1fr) auto;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}.dfl-gps-head{display:grid;grid-template-columns:46px 1fr 46px;align-items:center;gap:8px;padding:9px 10px;background:#0b1726;border-bottom:1px solid var(--line)}.dfl-gps-head-title{text-align:center;min-width:0}.dfl-gps-head-title small{display:block;color:#ffd400;font-size:9px;letter-spacing:.1em;text-transform:uppercase;font-weight:900}.dfl-gps-head-title strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dfl-gps-close,.dfl-gps-head>button{width:46px;height:44px;border:1px solid var(--line);border-radius:10px;background:#13243a;color:var(--text);font-size:25px}.dfl-hole-map{position:relative;background:#132233;overflow:hidden}.dfl-hole-map [data-gps-map]{width:100%;height:100%;min-height:250px}.dfl-gps-map-tools{position:absolute;left:10px;right:10px;bottom:10px;z-index:500;display:flex;gap:7px;pointer-events:none}.dfl-gps-map-tools button,.dfl-gps-map-tools a{pointer-events:auto;min-height:38px;border:1px solid rgba(255,255,255,.36);border-radius:9px;padding:8px 10px;background:rgba(7,15,24,.94);color:#fff;text-decoration:none;font:800 11px/1 inherit}.dfl-gps-map-tools button:disabled{opacity:.45}.dfl-gps-map-prompt{position:absolute;z-index:520;top:12px;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100% - 24px);padding:9px 12px;border:1px solid #ffd400;border-radius:10px;background:rgba(7,15,24,.96);color:#fff;text-align:center;font-size:11px;font-weight:900}.dfl-gps-map-prompt[hidden]{display:none}.dfl-gps-controls{padding:9px 12px 12px;background:#0b1726;border-top:1px solid var(--line)}.dfl-gps-reading{text-align:center}.dfl-gps-reading b{display:block;font-size:42px;line-height:1;font-variant-numeric:tabular-nums}.dfl-gps-reading span{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.dfl-gps-map-green{width:22px;height:22px;border:3px solid #fff;border-radius:50% 50% 50% 0;background:#ffd400;box-shadow:0 2px 8px #000;transform:rotate(-45deg)}.dfl-gps-map-player{width:20px;height:20px;border:3px solid #fff;border-radius:50%;background:#228cff;box-shadow:0 0 0 7px rgba(34,140,255,.25),0 2px 8px #000}.dfl-gps-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}.dfl-gps-actions button{min-height:42px;border:1px solid var(--line);border-radius:10px;background:#13243a;color:var(--text);font-weight:900}.dfl-gps-actions .is-mapping{background:#ffd400;color:#08111d;border-color:#ffd400}.dfl-gps-meta{display:block;margin-top:7px;color:var(--muted);font-size:10px;text-align:center}.dfl-gps-error{display:grid;place-items:center;height:100%;padding:24px;text-align:center;color:var(--muted)}@media(min-width:760px){.dfl-gps-panel{inset:4vh max(12px,calc((100vw - 720px)/2));border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 24px 70px #000}.dfl-hole-map{min-height:430px}}`;document.head.appendChild(style)}

function ensureAssistantStyles(){if(document.getElementById("dfl-gps-assistant-style"))return;const style=document.createElement("style");style.id="dfl-gps-assistant-style";style.textContent=`.dfl-gps-bubble.is-beta{position:static;display:grid;grid-template-columns:auto 1fr;align-items:center;gap:10px;width:100%;min-height:64px;padding:9px 12px;border-radius:13px;background:#132941;color:#fff;text-align:left}.dfl-gps-bubble.is-beta strong{font-size:25px;text-align:center}.dfl-gps-bubble.is-beta small{margin:0;color:#c9d7e2}.dfl-gps-bubble.is-beta .dfl-gps-beta-copy{display:grid;gap:2px}.dfl-gps-bubble.is-beta .dfl-gps-beta-copy b{color:#9dcc45;font-size:11px}.dfl-gps-club{margin-top:9px;padding:9px 12px;border:1px solid rgba(157,204,69,.45);border-radius:11px;background:rgba(157,204,69,.1);color:#fff;text-align:center}.dfl-gps-club strong{color:#bce56d}.dfl-gps-club small{display:block;margin-top:2px;color:#a9b8c7}.dfl-gps-club[hidden]{display:none}`;document.head.appendChild(style)}

function ensureHoleMarkerStyles(){if(document.getElementById("dfl-gps-hole-marker-style"))return;const style=document.createElement("style");style.id="dfl-gps-hole-marker-style";style.textContent=`.dfl-gps-map-tee{width:20px;height:20px;border:3px solid #fff;border-radius:50%;background:#13243a;box-shadow:0 0 0 5px rgba(255,255,255,.2),0 2px 8px #000}.dfl-gps-actions button[hidden]{display:none}.dfl-gps-actions button[hidden]+button{grid-column:1/-1}`;document.head.appendChild(style)}

function ensureHoleExperienceStyles(){
  if(document.getElementById("dfl-gps-hole-experience-style"))return;
  const style=document.createElement("style");style.id="dfl-gps-hole-experience-style";
  style.textContent=`
.dfl-gps-bubble.is-beta{background:#07344d;border:2px solid #119b57;box-shadow:0 7px 20px rgba(7,52,77,.24)}
.dfl-gps-panel.is-hole-experience{display:block;padding:0;background:#071015;color:#fff;overflow:hidden}
.is-hole-experience .dfl-hole-map{position:absolute;inset:0;background:#071015}
.is-hole-experience .dfl-hole-map [data-gps-map]{width:100%;height:100%;min-height:100%}
.is-hole-experience .leaflet-container{background:#071015;font-family:inherit}
.is-hole-experience .leaflet-control-attribution{display:none}
.is-hole-experience .dfl-gps-head{position:absolute;z-index:800;top:calc(12px + env(safe-area-inset-top));left:12px;right:12px;display:grid;grid-template-columns:50px minmax(0,1fr) 50px;gap:8px;padding:0;background:transparent;border:0;pointer-events:none}
.is-hole-experience .dfl-gps-head button{pointer-events:auto;width:50px;height:50px;border:1px solid rgba(255,255,255,.36);border-radius:50%;background:rgba(5,10,13,.88);color:#fff;font-size:27px;box-shadow:0 5px 18px rgba(0,0,0,.3)}
.is-hole-experience .dfl-gps-hole-nav{pointer-events:auto;display:grid;grid-template-columns:42px minmax(0,1fr) 42px;align-items:center;min-height:54px;border-radius:15px;background:rgba(5,10,13,.88);box-shadow:0 5px 18px rgba(0,0,0,.3);overflow:hidden}
.is-hole-experience .dfl-gps-hole-nav>button{width:42px;height:42px;border:0;border-radius:50%;background:rgba(255,255,255,.09);box-shadow:none}
.is-hole-experience .dfl-gps-head-title small{color:#d7e6de;font-size:10px;letter-spacing:.04em}
.is-hole-experience .dfl-gps-head-title strong{font-size:18px;color:#fff}
.is-hole-experience .dfl-gps-head-spacer{display:block}
.is-hole-experience .dfl-gps-map-tools{left:auto;right:12px;bottom:calc(144px + env(safe-area-inset-bottom));display:block}
.is-hole-experience .dfl-gps-map-tools button{min-width:104px;min-height:44px;border-radius:22px;background:rgba(5,10,13,.9);box-shadow:0 5px 16px rgba(0,0,0,.3)}
.is-hole-experience .dfl-gps-controls{position:absolute;z-index:800;left:0;right:0;bottom:0;padding:12px 14px calc(13px + env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(5,10,13,.9),rgba(5,10,13,.98));border:0;border-radius:20px 20px 0 0;box-shadow:0 -10px 32px rgba(0,0,0,.34)}
.is-hole-experience .dfl-gps-score-dock{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px}
.is-hole-experience .dfl-gps-player{min-width:0}.is-hole-experience .dfl-gps-player strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}.is-hole-experience .dfl-gps-player small{display:block;margin-top:3px;color:#a9b8c0;font-size:10px}
.is-hole-experience .dfl-gps-score{min-width:106px;min-height:48px;border:1px solid rgba(255,255,255,.3);border-radius:13px;background:#119b57;color:#fff;font-weight:950}
.is-hole-experience .dfl-gps-score[hidden]{display:none}
.is-hole-experience .dfl-gps-adjust{width:100%;margin-top:9px;min-height:34px;border:1px solid rgba(255,255,255,.22);border-radius:10px;background:rgba(255,255,255,.07);color:#d7e6de;font:900 10px/1 inherit;letter-spacing:.06em;text-transform:uppercase}
.is-hole-experience .dfl-gps-adjust[hidden],.is-hole-experience .dfl-gps-calibration[hidden]{display:none}
.is-hole-experience .dfl-gps-calibration{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px;padding:8px;border:1px solid rgba(157,204,69,.42);border-radius:12px;background:rgba(5,10,13,.82)}
.is-hole-experience .dfl-gps-calibration button{min-height:38px;border:1px solid rgba(255,255,255,.25);border-radius:9px;background:#17324b;color:#fff;font:900 11px/1 inherit}
.is-hole-experience .dfl-gps-calibration button.is-mapping{background:#119b57;border-color:#9dcc45}.is-hole-experience .dfl-gps-use-location{grid-column:1/-1}.is-hole-experience .dfl-gps-use-location[hidden]{display:none}
.is-hole-experience .dfl-gps-reading{position:absolute;left:50%;bottom:calc(188px + env(safe-area-inset-bottom));transform:translateX(-50%);min-width:112px;padding:8px 12px;border:2px solid #fff;border-radius:28px;background:rgba(5,10,13,.9);box-shadow:0 4px 15px rgba(0,0,0,.3)}
.is-hole-experience .dfl-gps-reading b{font-size:30px;color:#fff}.is-hole-experience .dfl-gps-reading span{color:#d7e6de}
.is-hole-experience .dfl-gps-club{margin:9px 0 0;padding:7px 10px;border-color:rgba(157,204,69,.42);background:rgba(5,10,13,.72)}
.is-hole-experience .dfl-gps-meta{margin-top:7px;color:#a9b8c0}
.is-hole-experience .dfl-gps-actions{display:none}
.is-hole-experience .dfl-gps-map-status{position:absolute;z-index:620;left:50%;top:50%;transform:translate(-50%,-50%);max-width:260px;padding:10px 14px;border-radius:12px;background:rgba(5,10,13,.82);color:#fff;font-size:11px;font-weight:900;text-align:center;pointer-events:none}
.is-hole-experience .dfl-gps-map-status[hidden]{display:none}
.is-hole-experience .dfl-gps-map-credit{position:absolute;z-index:610;left:10px;bottom:calc(142px + env(safe-area-inset-bottom));padding:4px 7px;border-radius:6px;background:rgba(5,10,13,.7);color:#fff;font-size:9px}
.dfl-gps-distance-pill{min-width:58px;padding:5px 8px;border:2px solid #fff;border-radius:22px;background:rgba(5,10,13,.94);color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.35);font:950 18px/1 inherit;text-align:center}
body[data-mode="light"] .is-hole-experience .dfl-gps-controls{background:linear-gradient(180deg,rgba(255,255,255,.94),rgba(255,255,255,.99));color:var(--text);box-shadow:0 -10px 32px rgba(11,43,64,.2)}
body[data-mode="light"] .is-hole-experience .dfl-gps-player small,body[data-mode="light"] .is-hole-experience .dfl-gps-meta{color:var(--muted)}
body[data-mode="light"] .is-hole-experience .dfl-gps-adjust{border-color:var(--line);background:var(--bg-3);color:var(--text)}
body[data-mode="light"] .is-hole-experience .dfl-gps-calibration{border-color:var(--line);background:var(--bg-3)}
body[data-mode="light"] .is-hole-experience .dfl-gps-calibration button{border-color:var(--control-line);background:var(--bg-2);color:var(--text)}
body[data-mode="light"] .is-hole-experience .dfl-gps-calibration button.is-mapping{background:var(--accent-fill);border-color:var(--accent-fill);color:var(--on-accent)}
/* The hole view. TheGrint's screen is not an overhead map: the hole is turned
   so the green is always straight ahead and the ground is raked back toward the
   horizon. Leaflet has no rotation, so the whole stage is a CSS transform and
   the map inside it is oversized - at 190% the rotated corners never expose the
   frame. Markers sit inside the same transform, so each one counter-rotates to
   stay upright and readable. */
.is-hole-experience .dfl-hole-map{perspective:1100px;perspective-origin:50% 78%}
.dfl-hole-stage{position:absolute;inset:0;transition:transform .45s cubic-bezier(.22,.61,.36,1)}
.dfl-hole-stage [data-gps-map]{position:absolute;left:-45%;top:-45%;width:190%;height:190%;min-height:0}
.dfl-hole-stage.is-hole-view{transform:rotateX(56deg) rotate(var(--gps-rot,0deg));transform-origin:50% 66%}
.dfl-hole-stage.is-hole-view .dfl-gps-map-player,.dfl-hole-stage.is-hole-view .dfl-gps-map-tee{transform:rotate(var(--gps-back,0deg)) rotateX(-56deg)}
.dfl-hole-stage.is-hole-view .dfl-gps-map-green{transform:rotate(var(--gps-back,0deg)) rotateX(-56deg) rotate(-45deg)}
.dfl-hole-stage.is-hole-view .dfl-gps-distance-pill,.dfl-hole-stage.is-hole-view .dfl-gps-arc-label{transform:rotate(var(--gps-back,0deg)) rotateX(-56deg)}
.dfl-gps-arc-label{min-width:30px;padding:2px 5px;border-radius:9px;background:rgba(5,10,13,.72);color:#fff;font:900 10px/1 inherit;text-align:center}
/* Front / centre / back, the three numbers TheGrint puts under the hole. */
.is-hole-experience .dfl-gps-fcb{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:9px}
.is-hole-experience .dfl-gps-fcb[hidden]{display:none}
.is-hole-experience .dfl-gps-fcb div{padding:6px 4px;border:1px solid rgba(255,255,255,.16);border-radius:11px;background:rgba(255,255,255,.06);text-align:center}
.is-hole-experience .dfl-gps-fcb small{display:block;color:#a9b8c0;font-size:9px;letter-spacing:.1em;text-transform:uppercase;font-weight:900}
.is-hole-experience .dfl-gps-fcb b{display:block;margin-top:2px;font-size:19px;font-variant-numeric:tabular-nums}
.is-hole-experience .dfl-gps-fcb div.is-center{border-color:rgba(255,212,0,.5);background:rgba(255,212,0,.12)}
.is-hole-experience .dfl-gps-fcb div.is-center b{color:#ffd400}
body[data-mode="light"] .is-hole-experience .dfl-gps-fcb div{border-color:var(--line);background:var(--bg-3)}
body[data-mode="light"] .is-hole-experience .dfl-gps-fcb small{color:var(--muted)}
@media(min-width:760px){.dfl-gps-panel.is-hole-experience{inset:3vh max(12px,calc((100vw - 520px)/2));border-radius:20px}.is-hole-experience .dfl-hole-map{min-height:0}}
`;
  document.head.appendChild(style);
}

export function setupCourseGps(config){
  let watchId=null,position=null,hole=1,attachedCard=null,cleanup=null,errorText="",geometryError="",map=null,tileLayer=null,fallbackOverlay=null,fallbackHole=0,imageryReady=false,playerMarker=null,teeMarker=null,accuracyCircle=null,greenMarker=null,distanceLine=null,distanceMarker=null,mappingKind="",hasFitted=false,followMode=true,holeView=true,arcLayers=[],holeLocked=false,refining=false,samples=[],memberBag=[],bagMemberId=null,courseId=null,geometryLoading=false,sharedHoles=new Map();
  const selector=`[data-gps-course="${config.key}"]`;
  const GEOMETRY_COLUMNS="hole,yardage_men,tee_lat,tee_lng,green_lat,green_lng,gps_updated_at";
  const GREEN_EDGE_COLUMNS="front_lat,front_lng,back_lat,back_lng";
  const ENDPOINT_LABELS={tee:"tee",green:"green centre",front:"green front",back:"green back"};
  const ENDPOINT_SHORT={tee:"tee",green:"center",front:"front",back:"back"};
  const ENDPOINT_PROMPTS={tee:"tee box",green:"center of the green",front:"front edge of the green",back:"back edge of the green"};
  const activeCourseId=()=>Number(attachedCard?.dataset.gpsCourseId||attachedCard?.closest("[data-gps-course-id]")?.dataset.gpsCourseId)||null;
  const activeCourseName=()=>attachedCard?.dataset.gpsCourseName||attachedCard?.closest("[data-gps-course-name]")?.dataset.gpsCourseName||config.courseName||config.label.split(" · ")[0];
  const activeLabel=()=>attachedCard?.dataset.gpsCourseLabel||attachedCard?.closest("[data-gps-course-label]")?.dataset.gpsCourseLabel||config.label;
  const greens=()=>load(config.storageKey);
  const targetHoleFor=value=>((Number(value)||1)-1)%9+1;
  const targetHole=()=>targetHoleFor(hole);
  const sharedHoleFor=value=>sharedHoles.get(targetHoleFor(value))||{};
  const pointFrom=(row,prefix)=>{const rawLat=row?.[`${prefix}_lat`],rawLng=row?.[`${prefix}_lng`];if(rawLat==null||rawLat===""||rawLng==null||rawLng==="")return null;const lat=Number(rawLat),lng=Number(rawLng);return Number.isFinite(lat)&&Number.isFinite(lng)?{lat,lng,shared:true}:null};
  const savedGreenFor=value=>greens()[targetHoleFor(value)];
  const greenFor=value=>pointFrom(sharedHoleFor(value),"green")||savedGreenFor(value)||config.holeTargets?.[targetHoleFor(value)]||null;
  const green=()=>greenFor(hole);
  const fairwayTargetFor=value=>config.fairwayTargets?.[targetHoleFor(value)]||null;
  const gpsSlot=()=>attachedCard?.querySelector("[data-tb-gps-slot],[data-gq-gps-slot]")||attachedCard?.closest("[data-gqm-root]")?.querySelector("[data-gqm-gps-slot]");
  const betaSlot=()=>attachedCard?.querySelector("[data-tb-gps-slot]");
  const betaValue=(name,fallback,value=hole)=>{const values=String(attachedCard?.dataset?.[name]||"").split(",");return Number(values[Number(value)-1])||Number(fallback)||0};
  const officialYardsFor=value=>betaSlot()?betaValue("tbYardages",targetHoleFor(value)===targetHole()?betaSlot()?.dataset.tbHoleYardage:0,value):targetHoleFor(value)===targetHole()?Number(gpsSlot()?.dataset.gqmHoleYardage)||0:Number(sharedHoleFor(value).yardage_men)||0;
  const officialYards=()=>officialYardsFor(hole);
  const officialPar=()=>betaSlot()?betaValue("tbPars",betaSlot()?.dataset.tbHolePar):Number(gpsSlot()?.dataset.gqmHolePar)||0;
  const teeFor=value=>{const shared=pointFrom(sharedHoleFor(value),"tee");if(shared)return shared;const aim=greenFor(value),landing=fairwayTargetFor(value),yards=officialYardsFor(value);if(!aim||!landing||!yards)return null;const remaining=distanceYards(landing,aim);if(!remaining)return null;const ratio=yards/remaining;return{lat:aim.lat+(landing.lat-aim.lat)*ratio,lng:aim.lng+(landing.lng-aim.lng)*ratio,inferred:true}};
  const tee=()=>teeFor(hole);
  /* TheGrint maps three points on every green - front, centre and back - plus the
     tee and the fairway landing zone. Commissioners can now calibrate all of
     them. Where only the centre has been mapped, front and back are projected
     along the approach line using a 32-yard-deep green, which is the depth
     TheGrint's own mapping guide assumes, and the reading is labelled estimated
     so nobody mistakes it for a surveyed point. */
  const GREEN_HALF_DEPTH=16;
  const radians=value=>value*Math.PI/180;
  const degrees=value=>value*180/Math.PI;
  function bearingBetween(from,to){
    if(!from||!to)return null;
    const lat1=radians(from.lat),lat2=radians(to.lat),dLng=radians(to.lng-from.lng);
    const y=Math.sin(dLng)*Math.cos(lat2),x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng);
    const bearing=degrees(Math.atan2(y,x));
    return Number.isFinite(bearing)?(bearing+360)%360:null;
  }
  function projectPoint(from,bearing,yards){
    if(!from||bearing==null||!Number.isFinite(yards))return null;
    const angular=(yards/1.0936133)/6371000,heading=radians(bearing),lat1=radians(from.lat),lng1=radians(from.lng);
    const lat2=Math.asin(Math.sin(lat1)*Math.cos(angular)+Math.cos(lat1)*Math.sin(angular)*Math.cos(heading));
    const lng2=lng1+Math.atan2(Math.sin(heading)*Math.sin(angular)*Math.cos(lat1),Math.cos(angular)-Math.sin(lat1)*Math.sin(lat2));
    return{lat:degrees(lat2),lng:((degrees(lng2)+540)%360)-180,derived:true};
  }
  const approachOrigin=value=>(position?fixPoint(position):null)||teeFor(value);
  const holeBearing=value=>bearingBetween(approachOrigin(value),greenFor(value));
  function greenEdgeFor(value,edge){
    const shared=pointFrom(sharedHoleFor(value),edge);
    if(shared)return shared;
    const centre=greenFor(value),bearing=holeBearing(value);
    if(!centre||bearing==null)return null;
    return projectPoint(centre,edge==="front"?(bearing+180)%360:bearing,GREEN_HALF_DEPTH);
  }
  function greenReadings(){
    const here=position?fixPoint(position):null,centre=greenFor(hole);
    if(!here||!centre)return null;
    const front=greenEdgeFor(hole,"front"),back=greenEdgeFor(hole,"back"),limit=maximumYards();
    return{
      front:front?capHoleDistance(distanceYards(here,front),limit):null,
      centre:capHoleDistance(distanceYards(here,centre),limit),
      back:back?capHoleDistance(distanceYards(here,back),limit):null,
      estimated:Boolean(front&&!front.shared)
    };
  }
  const courseTarget=()=>{const center=config.courseCenter||[],lat=Number(center[0]),lng=Number(center[1]);if(Number.isFinite(lat)&&Number.isFinite(lng))return{lat,lng,fallback:true};const shared=[...sharedHoles.values()].map(row=>pointFrom(row,"green")||pointFrom(row,"tee")).find(Boolean);if(shared)return shared;if(position)return fixPoint(position);return{lat:0,lng:0,fallback:true}};
  const target=()=>green()||courseTarget();
  const rawReading=()=>position?distanceYards({lat:position.coords.latitude,lng:position.coords.longitude},target()):null;
  const maximumYards=()=>officialYards()||((tee()&&green())?distanceYards(tee(),green()):500);
  const outsideHole=()=>isOutsideHole(rawReading(),maximumYards());
  const reading=()=>capHoleDistance(rawReading(),maximumYards());
  const club=()=>outsideHole()?null:recommendClub(memberBag,reading());
  const scoreContext=()=>{const quickRoot=attachedCard?.closest("[data-gqm-root]"),trigger=attachedCard?.querySelector(".tb-quick-add[data-tb-open],[data-tb-open]")||quickRoot?.querySelector(".gqm-add-score[data-gqm-score-player]");const name=attachedCard?.querySelector(".tb-quick-name,[data-tb-name]")?.textContent?.trim()||quickRoot?.querySelector(".gqm-person-copy strong")?.textContent?.trim()||currentMember()?.golf_name||currentMember()?.display_name||"Your score";return{trigger,name,editing:/edit score|hole score/i.test(trigger?.textContent||"")}};
  const canCalibrate=()=>hasPermission("golf");
  function setMapStatus(message=""){const status=document.querySelector(`.dfl-gps-panel${selector} [data-gps-map-status]`);if(!status)return;status.textContent=message;status.hidden=!message}
  async function loadCourseGeometry(){
    if(geometryLoading||courseId)return;
    geometryLoading=true;geometryError="";
    try{
      let foundId=activeCourseId();if(!foundId){const course=await db().from("golf_courses").select("id").eq("name",activeCourseName()).limit(1).maybeSingle();if(course.error)throw course.error;if(!course.data?.id)throw Error("Saved course not found");foundId=Number(course.data.id)}
      /* front_/back_ arrive with golf_gps_green_points_schema.sql. Selecting a
         column Postgres does not have fails the whole request, so a database
         that has not run the migration falls back to the original columns and
         keeps working on projected green edges. */
      let holes=await db().from("golf_course_holes").select(`${GEOMETRY_COLUMNS},${GREEN_EDGE_COLUMNS}`).eq("course_id",foundId).order("hole");
      if(holes.error)holes=await db().from("golf_course_holes").select(GEOMETRY_COLUMNS).eq("course_id",foundId).order("hole");
      if(holes.error)throw holes.error;courseId=foundId;sharedHoles=new Map((holes.data||[]).map(row=>[Number(row.hole),row]));fallbackHole=0;hasFitted=false;holeLocked=false;if(position)detectHole(fixPoint(position));refresh(true);
    }catch(err){geometryError=err?.message||"Shared hole calibration is unavailable.";console.warn("golf GPS geometry:",geometryError)}finally{geometryLoading=false}
  }
  async function saveEndpoint(kind,point){
    if(!canCalibrate())return toast("Golf commissioner access is required",true);
    if(!courseId)await loadCourseGeometry();
    if(!courseId)return toast(geometryError||"Could not find this saved course",true);
    const prefix=kind,patch={[`${prefix}_lat`]:point.lat,[`${prefix}_lng`]:point.lng,gps_updated_at:new Date().toISOString(),gps_updated_by:Number(currentMember()?.id)||null};
    setMapStatus(`Saving Hole ${hole} ${prefix}…`);
    let result=await db().from("golf_course_holes").update(patch).eq("course_id",courseId).eq("hole",targetHole()).select(`${GEOMETRY_COLUMNS},${GREEN_EDGE_COLUMNS}`).maybeSingle();
    if(result.error)result=await db().from("golf_course_holes").update(patch).eq("course_id",courseId).eq("hole",targetHole()).select(GEOMETRY_COLUMNS).maybeSingle();
    if(result.error||!result.data){setMapStatus("");const raw=String(result.error?.message||"");return toast(/front_|back_/.test(raw)?"Run golf_gps_green_points_schema.sql before mapping green edges":raw||"That GPS point was not saved",true)}
    sharedHoles.set(targetHole(),result.data);if(prefix==="green"){const local=greens();local[targetHole()]={lat:point.lat,lng:point.lng,at:Date.now(),source:"shared"};save(config.storageKey,local)}
    mappingKind="";fallbackHole=0;hasFitted=false;setMapStatus("");toast(`Hole ${hole} ${ENDPOINT_LABELS[prefix]||prefix} saved for everyone`);refresh(true);
  }
  function detectHole(point){
    if(holeLocked||!point)return false;
    const total=Number(attachedCard?.dataset.tbHoleCount)||Number(attachedCard?.closest("[data-gqm-root]")?.dataset.gqmHoleCount)||9,tees={};
    for(let physical=1;physical<=Math.min(9,total);physical++){const start=teeFor(physical);if(start)tees[physical]=start}
    /* Courses whose tees have never been calibrated - Center and Red Trail both
       ship greens only - used to fail hole detection outright, because the tee
       list came back empty. Falling back to the greens still identifies the
       hole: being inside 120 yards of a green means you are playing it. */
    let nearest=nearestTeeHole(point,tees,140);
    if(!nearest){const greenTargets={};for(let physical=1;physical<=Math.min(9,total);physical++){const centre=greenFor(physical);if(centre)greenTargets[physical]=centre}nearest=nearestTeeHole(point,greenTargets,120)}
    if(!nearest)return false;
    const cycle=Math.floor((hole-1)/9),detected=Math.min(total,nearest.hole+cycle*9);if(detected!==hole){hole=detected;fallbackHole=0;hasFitted=false}
    holeLocked=true;followMode=true;return true;
  }
  function refreshFallback(){if(!map||!globalThis.L||fallbackHole===targetHole())return;fallbackOverlay?.remove();fallbackOverlay=null;fallbackHole=targetHole();imageryReady=false;setMapStatus("Loading satellite hole…");const bounds=satelliteBounds(tee(),target());if(!bounds)return;const L=globalThis.L,url=satelliteExportUrl(bounds);fallbackOverlay=L.imageOverlay(url,bounds,{pane:"dflFallbackPane",opacity:1,interactive:false}).addTo(map);fallbackOverlay.once("load",()=>{imageryReady=true;setMapStatus("")});fallbackOverlay.once("error",()=>{if(!imageryReady)setMapStatus("Satellite imagery is unavailable. Check your connection and retry.")})}
  async function loadMemberBag(){const me=currentMember(),id=me==null?null:String(me.id);if(id===bagMemberId)return;bagMemberId=id;memberBag=[];if(!me){refresh();return}const{data,error}=await db().from("golf_bag").select("club,yards").eq("member_id",me.id).order("sort_order");if(!error&&String(currentMember()?.id)===id)memberBag=data||[];refresh()}
  function acceptFix(next){const point=fixPoint(next),accuracy=Number(next?.coords?.accuracy),now=Date.now(),timestamp=Number(next?.timestamp)||now;if(!Number.isFinite(point.lat)||!Number.isFinite(point.lng)||!Number.isFinite(accuracy)||accuracy<=0||now-timestamp>30000)return false;const last=samples.at(-1);if(last){const seconds=Math.max(.1,(timestamp-last.timestamp)/1000),jumpMeters=distanceYards(point,last.point)/1.0936133,limit=Math.max(120,(accuracy+last.accuracy)*3,seconds*55);if(seconds<5&&jumpMeters>limit)return false}const sample={position:next,point,accuracy,timestamp};samples.push(sample);samples=samples.filter(item=>now-item.timestamp<=8000).slice(-10);const current=position?{point:fixPoint(position),accuracy:Number(position.coords.accuracy)||999}:null,moved=current&&distanceYards(point,current.point)/1.0936133>Math.max(12,current.accuracy+accuracy);const best=moved&&accuracy<=Math.max(55,current.accuracy*2)?sample:[...samples].sort((a,b)=>(a.accuracy+(now-a.timestamp)/1000*2.5)-(b.accuracy+(now-b.timestamp)/1000*2.5))[0];position={coords:{latitude:best.point.lat,longitude:best.point.lng,accuracy:best.accuracy,altitude:best.position.coords.altitude??null,altitudeAccuracy:best.position.coords.altitudeAccuracy??null,heading:best.position.coords.heading??null,speed:best.position.coords.speed??null},timestamp:best.timestamp};refining=false;errorText="";return true}
  function handleFix(next){const first=!position;if(!acceptFix(next))return;const detected=detectHole(fixPoint(position));if(first||detected)hasFitted=false;refresh(followMode)}
  /* Turn the stage so the green is straight ahead. Calibration taps have to
     land on real coordinates, so the tilt is dropped flat whenever a tee or
     green is being placed - a tap through a rotated element does not hit the
     latitude you aimed at. */
  function applyHoleView(){
    const stage=document.querySelector(`.dfl-gps-panel${selector} [data-gps-stage]`);
    if(!stage)return;
    const bearing=holeBearing(hole),live=holeView&&!mappingKind&&bearing!=null;
    stage.classList.toggle("is-hole-view",live);
    stage.style.setProperty("--gps-rot",`${live?-bearing:0}deg`);
    stage.style.setProperty("--gps-back",`${live?bearing:0}deg`);
    const toggle=document.querySelector(`.dfl-gps-panel${selector} [data-gps-view]`);
    if(toggle){toggle.textContent=live?"Overhead":"Hole view";toggle.setAttribute("aria-pressed",String(live))}
  }
  function markerIcon(kind){const L=globalThis.L;return L.divIcon({className:"",html:`<div class="dfl-gps-map-${kind}"></div>`,iconSize:[24,24],iconAnchor:kind==="green"?[12,23]:[12,12]})}
  function drawMap(fit=false){
    if(!map||!globalThis.L)return;
    const L=globalThis.L,holeGreen=green(),aim=target(),start=tee(),here=position?{lat:position.coords.latitude,lng:position.coords.longitude}:null,onHole=Boolean(here&&!outsideHole()),lineStart=onHole?here:start,shown=reading()??maximumYards();
    refreshFallback();
    playerMarker?.remove();teeMarker?.remove();accuracyCircle?.remove();greenMarker?.remove();distanceLine?.remove();distanceMarker?.remove();arcLayers.forEach(layer=>layer.remove());arcLayers=[];
    playerMarker=teeMarker=accuracyCircle=greenMarker=distanceLine=distanceMarker=null;
    if(onHole){
      accuracyCircle=L.circle([here.lat,here.lng],{radius:Number(position.coords.accuracy)||1,color:"#61adff",weight:1,opacity:.85,fillColor:"#228cff",fillOpacity:.14,interactive:false}).addTo(map);
      playerMarker=L.marker([here.lat,here.lng],{icon:markerIcon("player"),zIndexOffset:1000,title:"Your GPS location",alt:"Your GPS location"}).addTo(map).bindTooltip(`You · GPS ${fixQuality(position.coords.accuracy)}`,{direction:"top"});
    }else if(start){
      teeMarker=L.marker([start.lat,start.lng],{icon:markerIcon("tee"),zIndexOffset:850,title:`Hole ${hole} tee`,alt:`Hole ${hole} tee`}).addTo(map).bindTooltip(`Hole ${hole} tee`,{direction:"top"});
    }
    greenMarker=L.marker([aim.lat,aim.lng],{icon:markerIcon("green"),zIndexOffset:900,title:holeGreen?`Hole ${hole} green`:`${activeLabel()} course target`,alt:holeGreen?`Hole ${hole} green`:`${activeLabel()} course target`}).addTo(map).bindTooltip(holeGreen?`Hole ${hole} green`:`${activeLabel()} course target`,{direction:"top"});
    if(lineStart){
      distanceLine=L.polyline([[lineStart.lat,lineStart.lng],[aim.lat,aim.lng]],{color:"#fff",weight:3,opacity:.96}).addTo(map);
      const mid=[(lineStart.lat+aim.lat)/2,(lineStart.lng+aim.lng)/2],icon=L.divIcon({className:"",html:`<div class="dfl-gps-distance-pill">${formatYards(shown)}</div>`,iconSize:[78,38],iconAnchor:[39,19]});
      distanceMarker=L.marker(mid,{icon,zIndexOffset:1100,interactive:false,keyboard:false}).addTo(map);
    }
    /* Layup arcs. TheGrint's Arcs widget rings you at 100/150/200/250; a ring
       longer than what is left to the green is noise, so it is not drawn. */
    if(onHole){
      const remaining=rawReading(),lineBearing=bearingBetween(here,aim);
      for(const ring of [100,150,200,250]){
        if(!Number.isFinite(remaining)||ring>=remaining-10)continue;
        arcLayers.push(L.circle([here.lat,here.lng],{radius:ring/1.0936133,color:"#fff",weight:1,opacity:.45,fill:false,dashArray:"4 8",interactive:false}).addTo(map));
        const at=projectPoint(here,lineBearing,ring);
        if(at)arcLayers.push(L.marker([at.lat,at.lng],{icon:L.divIcon({className:"",html:`<div class="dfl-gps-arc-label">${ring}</div>`,iconSize:[34,16],iconAnchor:[17,8]}),interactive:false,keyboard:false,zIndexOffset:600}).addTo(map));
      }
    }
    applyHoleView();
    if(!fit||(onHole&&!followMode))return;
    setTimeout(()=>{
      map?.invalidateSize();
      /* The map element is 190% of its frame so the tilted view never shows a
         corner, which means roughly 24% of it hangs outside the frame on every
         side. Padding by that much keeps the hole inside what you can see. */
      const size=map.getSize(),bleedX=Math.round(size.x*.237),bleedY=Math.round(size.y*.237);
      const points=lineStart?[[lineStart.lat,lineStart.lng],[aim.lat,aim.lng]]:[[aim.lat,aim.lng]],options={paddingTopLeft:[54+bleedX,128+bleedY],paddingBottomRight:[54+bleedX,190+bleedY],maxZoom:holeZoom(onHole?rawReading():maximumYards())};
      if(hasFitted&&onHole)map.flyToBounds(points,{...options,duration:.7});else map.fitBounds(points,options);
    },0);
  }
  function refresh(fit=false){
    const bubble=document.querySelector(`.dfl-gps-bubble${selector}`),panel=document.querySelector(`.dfl-gps-panel${selector}`),value=reading(),suggestion=club(),holeGreen=green(),outside=outsideHole();
    if(bubble){const quick=bubble.classList.contains("is-quick-round"),beta=bubble.classList.contains("is-beta"),fallback=officialYards(),shown=value??fallback,badgeLabel=String(config.key||"GPS").replace(/-/g," ").toUpperCase(),status=outside?"HOLE MAX":suggestion?uiEsc(suggestion.club):"LIVE GPS";bubble.innerHTML=quick?`<small class="dfl-gps-badge-label">${value!=null?"LIVE":uiEsc(badgeLabel)}</small><strong>${shown?formatYards(shown):"—"}</strong><small>${value!=null?(outside?"HOLE MAX":"TO PIN"):"YDS"}</small>`:beta?`<strong>${shown?formatYards(shown):"—"}<small>YDS</small></strong><span class="dfl-gps-beta-copy"><b>${value!=null?status:"OPEN HOLE MAP"}</b><small>${value!=null?(outside?`Hole ${hole} maximum until you reach the tee`:`To Hole ${hole} green · ${fixQuality(position.coords.accuracy)}`):"Satellite GPS · yardage · club"}</small></span>`:value!=null?`<strong>${formatYards(value)}</strong><small>yd · H${hole} · ${outside?"hole max":fixQuality(position.coords.accuracy)}</small>`:`<strong>H${hole}</strong><small><em>GPS</em> · ${refining?"refining":"locating you"}</small>`}
    if(!panel)return;
    panel.querySelector("[data-gps-hole]").textContent=String(hole);
    panel.querySelector("[data-gps-hole-par]").textContent=officialPar()||"—";
    panel.querySelector("[data-gps-hole-yards]").textContent=officialYards()||"—";
    panel.querySelector("[data-gps-distance]").textContent=formatYards(value??maximumYards());
    panel.querySelector("[data-gps-reading-label]").textContent=value==null?`Hole ${hole} tee to green`:holeGreen?`yards to Hole ${hole} green`:`yards to course · set Hole ${hole} green for exact`;
    const edges=greenReadings(),fcb=panel.querySelector("[data-gps-fcb]");
    fcb.hidden=!edges;
    if(edges){
      panel.querySelector("[data-gps-front]").textContent=edges.front!=null?formatYards(edges.front):"—";
      panel.querySelector("[data-gps-center]").textContent=edges.centre!=null?formatYards(edges.centre):"—";
      panel.querySelector("[data-gps-back]").textContent=edges.back!=null?formatYards(edges.back):"—";
    }
    const score=scoreContext(),playerName=panel.querySelector("[data-gps-player-name]"),scoreButton=panel.querySelector("[data-gps-score]");if(playerName)playerName.textContent=score.name;if(scoreButton){scoreButton.hidden=!score.trigger;scoreButton.textContent=score.editing?"Edit score":"Add score"}
    const clubLine=panel.querySelector("[data-gps-club]");clubLine.hidden=!suggestion;clubLine.innerHTML=suggestion?`Your club · <strong>${uiEsc(suggestion.club)}</strong><small>${formatYards(suggestion.yards)} yd personal carry</small>`:"";
    const prompt=panel.querySelector("[data-gps-map-prompt]");prompt.hidden=!mappingKind;prompt.textContent=mappingKind?`Tap Hole ${hole} · ${ENDPOINT_PROMPTS[mappingKind]||mappingKind}`:"";
    panel.querySelectorAll("[data-map-endpoint]").forEach(button=>{const kind=button.dataset.mapEndpoint,name=ENDPOINT_SHORT[kind]||kind,active=kind===mappingKind;button.classList.toggle("is-mapping",active);button.textContent=active?`Tap map for ${name}`:`Set ${name}`});
    const adjust=panel.querySelector("[data-gps-adjust]"),calibration=panel.querySelector("[data-gps-calibration]"),useLocation=panel.querySelector("[data-gps-use-location]");if(adjust){adjust.hidden=!canCalibrate();adjust.textContent=calibration?.hidden?"Adjust tee & green":"Close hole adjustment"}if(useLocation){useLocation.hidden=!mappingKind||!position;useLocation.textContent=mappingKind?`Use my GPS for ${mappingKind}`:"Use my GPS"}
    const follow=panel.querySelector("[data-map-me]");follow.textContent=position?(followMode?"Following":"Follow me"):"Start GPS";follow.setAttribute("aria-pressed",String(Boolean(position&&followMode)));
    const shared=sharedHoleFor(hole),edgeLabel=greenReadings()?.estimated?" · front/back estimated from a 32 yd green":"",sharedLabel=(shared.gps_updated_at?" · shared hole calibration":"")+edgeLabel;panel.querySelector("[data-gps-meta]").textContent=errorText?`${errorText} Tap Start GPS to retry.`:(position?outside?`Outside Hole ${hole} view · yardage capped at ${formatYards(maximumYards())} yd until you reach the hole`:`GPS ${fixQuality(position.coords.accuracy)} · ±${toYards(position.coords.accuracy)} yd · ${followMode?"following you":"map unlocked"}${sharedLabel}`:refining?"Refining a high-accuracy GPS fix…":geometryError&&canCalibrate()?geometryError:memberBag.length?"Waiting for your live GPS position…":"Add club carry distances under My Golf to receive a private club suggestion.");
    drawMap(fit||!hasFitted);hasFitted=true;
  }
  const gpsOptions={enableHighAccuracy:true,maximumAge:0,timeout:20000};
  function requestFreshFix(){if(!navigator.geolocation?.getCurrentPosition)return;refining=true;errorText="";refresh();navigator.geolocation.getCurrentPosition(next=>handleFix(next),err=>{refining=false;if(!position)errorText=err?.message||"Could not get a fresh GPS fix.";refresh()},gpsOptions)}
  function startGps(){if(watchId!=null)return;if(!navigator.geolocation){errorText="This device did not provide GPS.";refresh();return}refining=true;watchId=navigator.geolocation.watchPosition(next=>handleFix(next),err=>{refining=false;errorText=err?.message||"Location permission is needed for live yardage.";refresh()},gpsOptions);requestFreshFix()}
  function restartGps(){if(watchId!=null)navigator.geolocation?.clearWatch(watchId);watchId=null;position=null;samples=[];errorText="";hasFitted=false;startGps();refresh()}
  function destroyMap(){map?.remove();map=null;tileLayer=fallbackOverlay=null;fallbackHole=0;arcLayers=[];playerMarker=teeMarker=accuracyCircle=greenMarker=distanceLine=distanceMarker=null}
  function closePanel(){destroyMap();document.querySelector(`.dfl-gps-panel${selector}`)?.remove();if(attachedCard){hole=scorecardHole(attachedCard);hasFitted=false;refresh()}}
  async function initMap(panel){
    const host=panel.querySelector("[data-gps-map]");
    try{
      const L=await loadLeaflet();if(!host.isConnected)return;
      map=L.map(host,{zoomControl:false,attributionControl:false,preferCanvas:true});
      const pane=map.createPane("dflFallbackPane");pane.style.zIndex="150";pane.style.pointerEvents="none";
      tileLayer=L.tileLayer(SATELLITE_TILES,{maxZoom:20,keepBuffer:3,updateWhenIdle:false,attribution:"Imagery © Esri"}).addTo(map);
      tileLayer.on("load",()=>{imageryReady=true;setMapStatus("")});
      tileLayer.on("tileerror",()=>{if(!imageryReady)setMapStatus("Loading the lightweight satellite view…")});
      map.on("click",event=>{if(mappingKind)void saveEndpoint(mappingKind,{lat:event.latlng.lat,lng:event.latlng.lng})});
      map.on("dragstart",()=>{if(!position)return;followMode=false;const follow=panel.querySelector("[data-map-me]");if(follow){follow.textContent="Follow me";follow.setAttribute("aria-pressed","false")}});
      drawMap(true);
    }catch(err){
      setMapStatus(err.message||"Course map unavailable");
      host.style.backgroundImage=`url("${satelliteExportUrl(satelliteBounds(tee(),target()))}")`;
      host.style.backgroundPosition="center";host.style.backgroundSize="cover";
    }
  }
  function changeHole(delta){const total=Number(attachedCard?.dataset.tbHoleCount)||Number(attachedCard?.closest("[data-gqm-root]")?.dataset.gqmHoleCount)||9;hole=hole+delta;if(hole<1)hole=total;if(hole>total)hole=1;mappingKind="";holeLocked=true;followMode=true;hasFitted=false;fallbackHole=0;refresh(true)}
  function openPanel(){
    closePanel();startGps();mappingKind="";followMode=true;holeLocked=false;hasFitted=false;
    const panel=document.createElement("section");panel.className="dfl-gps-panel is-hole-experience";panel.dataset.gpsCourse=config.key;panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true");panel.setAttribute("aria-label",`${activeLabel()} hole GPS`);
    panel.innerHTML=`
      <div class="dfl-hole-map">
        <div class="dfl-hole-stage" data-gps-stage><div data-gps-map></div></div>
        <div class="dfl-gps-map-status" data-gps-map-status>Loading satellite hole…</div>
        <div class="dfl-gps-map-prompt" data-gps-map-prompt hidden></div>
        <div class="dfl-gps-map-tools"><button type="button" data-map-me>Refine GPS</button><button type="button" data-gps-view aria-pressed="true">Overhead</button></div>
        <span class="dfl-gps-map-credit">Imagery © Esri</span>
      </div>
      <header class="dfl-gps-head">
        <button type="button" class="dfl-gps-close" data-gps-close aria-label="Close hole GPS">×</button>
        <div class="dfl-gps-hole-nav">
          <button type="button" data-gps-prev aria-label="Previous hole">‹</button>
          <div class="dfl-gps-head-title"><small>Par <span data-gps-hole-par>${officialPar()||"—"}</span> · <span data-gps-hole-yards>${officialYards()||"—"}</span> yd</small><strong>Hole <span data-gps-hole>${hole}</span></strong></div>
          <button type="button" data-gps-next aria-label="Next hole">›</button>
        </div>
        <span class="dfl-gps-head-spacer"></span>
      </header>
      <div class="dfl-gps-controls">
        <div class="dfl-gps-reading"><b data-gps-distance>—</b><span data-gps-reading-label>yards to Hole ${hole}</span></div>
        <div class="dfl-gps-fcb" data-gps-fcb hidden><div><small>Front</small><b data-gps-front>—</b></div><div class="is-center"><small>Center</small><b data-gps-center>—</b></div><div><small>Back</small><b data-gps-back>—</b></div></div>
        <div class="dfl-gps-score-dock"><div class="dfl-gps-player"><strong data-gps-player-name>Your score</strong><small>${uiEsc(activeLabel())}</small></div><button type="button" class="dfl-gps-score" data-gps-score>Add score</button></div>
        <div class="dfl-gps-club" data-gps-club hidden></div>
        <button type="button" class="dfl-gps-adjust" data-gps-adjust hidden>Adjust tee & green</button>
        <div class="dfl-gps-calibration" data-gps-calibration hidden><button type="button" data-map-endpoint="tee">Set tee</button><button type="button" data-map-endpoint="green">Set center</button><button type="button" data-map-endpoint="front">Set front</button><button type="button" data-map-endpoint="back">Set back</button><button type="button" class="dfl-gps-use-location" data-gps-use-location hidden>Use my GPS</button></div>
        <small class="dfl-gps-meta" data-gps-meta></small>
      </div>`;
    document.body.appendChild(panel);
    panel.querySelector("[data-gps-close]").onclick=closePanel;
    panel.querySelector("[data-gps-prev]").onclick=()=>changeHole(-1);
    panel.querySelector("[data-gps-next]").onclick=()=>changeHole(1);
    panel.querySelector("[data-map-me]").onclick=()=>{if(position){followMode=true;hasFitted=false;requestFreshFix();refresh(true)}else restartGps()};
    panel.querySelector("[data-gps-view]").onclick=()=>{holeView=!holeView;hasFitted=false;refresh(true)};
    panel.querySelector("[data-gps-adjust]").onclick=()=>{const calibration=panel.querySelector("[data-gps-calibration]");calibration.hidden=!calibration.hidden;if(calibration.hidden)mappingKind="";refresh()};
    panel.querySelectorAll("[data-map-endpoint]").forEach(button=>button.onclick=()=>{const next=button.dataset.mapEndpoint;mappingKind=mappingKind===next?"":next;refresh()});
    panel.querySelector("[data-gps-use-location]").onclick=()=>{if(mappingKind&&position)void saveEndpoint(mappingKind,fixPoint(position))};
    panel.querySelector("[data-gps-score]").onclick=()=>{const trigger=scoreContext().trigger;closePanel();requestAnimationFrame(()=>trigger?.click())};
    refresh();void initMap(panel);
  }
  function stop(){
    if(globalThis.__dflCourseGpsStop===stop)globalThis.__dflCourseGpsStop=null;
    if(watchId!=null)navigator.geolocation?.clearWatch(watchId);watchId=null;position=null;samples=[];refining=false;errorText="";destroyMap();
    cleanup?.();cleanup=null;attachedCard=null;
    document.querySelectorAll(`.dfl-gps-bubble${selector},.dfl-gps-panel${selector}`).forEach(node=>node.remove());
  }
  function attach(card){
    if(attachedCard===card&&document.querySelector(`.dfl-gps-bubble${selector}`))return;
    globalThis.__dflCourseGpsStop?.();globalThis.__dflCourseGpsStop=stop;
    ensureStyles();ensureAssistantStyles();ensureHoleMarkerStyles();ensureHoleExperienceStyles();attachedCard=card;hole=scorecardHole(card);void loadMemberBag();void loadCourseGeometry();
    const bubble=document.createElement("button"),slot=gpsSlot(),beta=Boolean(betaSlot());bubble.type="button";bubble.className=`dfl-gps-bubble${beta?" is-beta":slot?" is-quick-round":""}`;bubble.dataset.gpsCourse=config.key;bubble.setAttribute("aria-label",`Open ${activeLabel()} Hole ${hole} GPS`);bubble.addEventListener("click",openPanel);slot?.querySelector("[data-gq-gps-top]")?.remove();(slot||document.body).appendChild(bubble);refresh();
    const update=e=>{if(!e.target.closest?.("[data-team-score],[data-step],[data-gqm-hole-nav]"))return;setTimeout(()=>{hole=scorecardHole(card);hasFitted=false;refresh()},80)};
    card.addEventListener("input",update);card.addEventListener("click",update);cleanup=()=>{card.removeEventListener("input",update);card.removeEventListener("click",update)};
  }
  function mount(){const view=document.getElementById("view"),query=new URLSearchParams(location.hash.split("?")[1]||"");if(!view||!location.hash.startsWith("#/golf")){stop();return}const card=view.querySelector(".tb-shell[data-tbeta-root]")||view.querySelector('.dfl-team-card[data-quick-active="true"]')||view.querySelector(".dfl-team-card:not([hidden])")||view.querySelector(".dfl-team-card"),quick=card?.matches("[data-quick-player-card]"),beta=card?.matches(".tb-shell[data-tbeta-root]");if(!card||(!query.get("team")&&!quick&&!beta)||(beta&&!card.querySelector("[data-tb-gps-slot]"))||!config.courseRe.test(courseText(view))){stop();return}attach(card)}
  function boot(){window.addEventListener("hashchange",()=>setTimeout(mount,0));window.addEventListener("dfl:quick-player-change",()=>setTimeout(mount,0));window.addEventListener("dfl:quick-hole-change",event=>{hole=((Number(event.detail?.hole)||1)-1)%9+1;hasFitted=false;setTimeout(refresh,0)});watchGolfMount(mount);mount()}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
  return{mount,stop};
}
