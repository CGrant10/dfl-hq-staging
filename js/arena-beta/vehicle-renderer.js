// DFL Arena Beta illustrated 2D vehicle renderer.
// Isolated from the live Arena renderer by design.

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const esc=(s)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

export const BETA_VEHICLES=[
  {id:"kart",label:"Arcade Kart",wheelbase:[132,404],flag:[238,92],accessory:[291,112]},
  {id:"stock",label:"Mini Stock",wheelbase:[132,405],flag:[235,82],accessory:[302,96]},
  {id:"golf",label:"Golf Cart",wheelbase:[142,398],flag:[226,76],accessory:[302,88]},
  {id:"pickup",label:"Tiny Pickup",wheelbase:[130,410],flag:[222,84],accessory:[310,92]},
  {id:"open",label:"Open Wheel",wheelbase:[112,424],flag:[221,92],accessory:[286,105]},
  {id:"beater",label:"Box Beater",wheelbase:[130,410],flag:[226,80],accessory:[304,94]},
];

const PAINT={
  "DFL Red":["#ff5144","#be251d","#64100c"],"Burnt Orange":["#ff9c38","#c65412","#6e2909"],
  "Track Yellow":["#ffe05c","#cf980d","#755000"],"Pit Green":["#64d473","#23863a","#0d4c20"],
  Teal:["#4ad9d1","#18878a","#0d4a50"],"Royal Blue":["#5c8cff","#2a50b7","#132862"],
  Black:["#555b66","#262a31","#0b0c10"],White:["#fffdf7","#cbd0d7","#777d86"],
  "Championship Gold":["#ffe276","#d59b1b","#805207"],
};

function wheelSvg(cx,cy,type="Slicks",gold=false){
  const chunky=/Chunky|Offroad/.test(type),white=/Whitewalls/.test(type),small=/Smalliez/.test(type);
  const r=small?27:chunky?39:36, rim=gold||/Gold/.test(type)?"#e1af32":"#8b929d";
  const tread=chunky?`<circle cx="${cx}" cy="${cy}" r="${r+4}" fill="none" stroke="#07080a" stroke-width="10" stroke-dasharray="8 5"/>`:"";
  return `<g>${tread}<circle cx="${cx}" cy="${cy}" r="${r}" fill="#08090b" stroke="#1d2026" stroke-width="7"/>${white?`<circle cx="${cx}" cy="${cy}" r="${r-8}" fill="none" stroke="#eee9dd" stroke-width="7"/>`:""}<circle cx="${cx}" cy="${cy}" r="${r-13}" fill="#292e36" stroke="${rim}" stroke-width="5"/><circle cx="${cx}" cy="${cy}" r="8" fill="#0a0b0d" stroke="${rim}" stroke-width="4"/><path d="M${cx-18} ${cy}h36M${cx} ${cy-18}v36M${cx-13} ${cy-13}l26 26M${cx+13} ${cy-13}l-26 26" stroke="${rim}" stroke-width="3" opacity=".92"/></g>`;
}

function driver(x=272,y=139,scale=1){return `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M-31 64 Q-25 18 0 4 Q31 15 38 64" fill="#171a20" stroke="#07080a" stroke-width="6"/><circle cx="5" cy="4" r="31" fill="#15181d" stroke="#050607" stroke-width="6"/><path d="M-18 -2 Q5 -20 29 -2 L23 15 H-20Z" fill="#2a3038"/><path d="M-13 0 Q5 -9 23 0 L18 11 H-11Z" fill="#080a0d" stroke="#7a828d" stroke-width="3"/><path d="M-4 39 q23 8 37 30" fill="none" stroke="#ef4438" stroke-width="12" stroke-linecap="round"/></g>`}

function antenna(x,y,flag="DFL"){
  return `<g><path d="M${x} ${y} Q${x-10} ${y-82} ${x-4} ${y-160}" fill="none" stroke="#d1d4d9" stroke-width="4"/><circle cx="${x-4}" cy="${y-160}" r="5" fill="#0b0c0e" stroke="#eee" stroke-width="2"/><g transform="translate(${x-2} ${y-153}) skewY(4)"><path d="M0 0 Q43 -9 91 4 L86 57 Q43 45 0 51Z" fill="#f0e9dc" stroke="#17191d" stroke-width="4"/><text x="45" y="34" text-anchor="middle" font-size="17" font-weight="900" font-family="Arial,sans-serif" fill="#111">${esc(flag||"DFL")}</text></g></g>`;
}

function accessory(name,x,y){
  if(name==="Commissioner Beacon")return `<g transform="translate(${x} ${y})"><rect x="-17" y="-8" width="34" height="9" rx="3" fill="#15171b"/><path d="M-13 -8 Q-11 -35 0 -38 Q11 -35 13 -8Z" fill="#ef2929" stroke="#7b0909" stroke-width="4"/><ellipse cx="0" cy="-21" rx="18" ry="25" fill="#ff3333" opacity=".2"/></g>`;
  if(name==="Championship Trophy")return `<g transform="translate(${x} ${y})" fill="#d9aa2c" stroke="#6c4a05" stroke-width="3"><path d="M-10 -34h20v17q0 14-10 18q-10-4-10-18z"/><path d="M-10 -29h-12q0 17 14 18M10 -29h12q0 17-14 18" fill="none"/><path d="M0 1v12M-13 16h26"/></g>`;
  if(name==="Crown")return `<path d="M${x-20} ${y-18}l8-22l14 16l14-18l12 24z" fill="#e2b12a" stroke="#6b4804" stroke-width="3"/>`;
  if(name==="Garbage Exhaust")return `<g transform="translate(${x+56} ${y+80})"><path d="M0 0l36 10" stroke="#4b5159" stroke-width="13" stroke-linecap="round"/><path d="M34 10q24-22 39 4q-24 3-13 27q-28-2-26-31z" fill="#7d956f" opacity=".82"/></g>`;
  if(name==="Beer Cooler")return `<g transform="translate(${x+8} ${y+18})"><rect x="-22" y="-14" width="44" height="30" rx="5" fill="#2b83b9" stroke="#0b3148" stroke-width="4"/><rect x="-24" y="-18" width="48" height="8" rx="4" fill="#eee"/><rect x="-9" y="-33" width="8" height="17" fill="#cf3c2c"/><rect x="5" y="-32" width="8" height="16" fill="#d5dbe2"/></g>`;
  if(name==="Dice")return `<g transform="translate(${x} ${y-15})"><rect x="-16" y="-16" width="32" height="32" rx="7" fill="#f0eee8" stroke="#17191d" stroke-width="4"/><circle cx="-7" cy="-7" r="3"/><circle cx="7" cy="7" r="3"/><circle cx="0" cy="0" r="3"/></g>`;
  return "";
}

function shell(kind,grad,shine){
  const fill=`url(#${grad})`, glaze=`url(#${shine})`;
  if(kind==="golf")return `
    <path d="M86 231 L111 196 Q129 182 164 181 H355 Q389 181 423 204 L455 231 L448 250 H82Z" fill="${fill}" stroke="#08090b" stroke-width="8"/>
    <path d="M150 183 L184 116 H344 L375 184" fill="none" stroke="#15181c" stroke-width="13" stroke-linejoin="round"/>
    <path d="M174 114 H358" stroke="#15181c" stroke-width="13" stroke-linecap="round"/>
    <path d="M190 127 V181 M337 127 V181" stroke="#272b31" stroke-width="7"/>
    <path d="M174 104 Q264 87 366 105 L362 121 H174Z" fill="#d9b56a" stroke="#15181c" stroke-width="6"/>
    <path d="M125 202 H365" stroke="#fff" stroke-opacity=".15" stroke-width="5"/>
    <rect x="347" y="164" width="45" height="40" rx="4" fill="#7d4a1d" stroke="#1b1008" stroke-width="5"/><path d="M351 169h37M351 181h37M351 193h37" stroke="#b87835" stroke-width="3"/>
    <path d="M204 181 Q219 143 255 143 H326 V181Z" fill="#111820" stroke="#5d6672" stroke-width="4"/>
    ${driver(268,132,.95)}<path d="M112 205 Q232 190 438 219" fill="none" stroke="${glaze}" stroke-width="18" opacity=".35"/>`;
  if(kind==="pickup")return `
    <path d="M72 224 L100 189 L181 178 L216 128 H326 L354 174 H436 L470 220 L460 249 H70Z" fill="${fill}" stroke="#08090b" stroke-width="8"/>
    <path d="M200 176 L226 120 H320 L349 176Z" fill="#111820" stroke="#07080a" stroke-width="7"/><path d="M238 132 H304 L327 171 H218Z" fill="#263646" stroke="#6b7887" stroke-width="4"/>
    <path d="M354 174 H450 V217 H354Z" fill="#15181d" opacity=".34"/><path d="M361 181h75v28h-75z" fill="#3a2113" stroke="#170d08" stroke-width="5"/><path d="M370 186v18M389 186v18M408 186v18M427 186v18" stroke="#7b4a2b" stroke-width="4"/>
    ${driver(274,133,.86)}<path d="M86 215 Q220 186 447 211" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="5"/>`;
  if(kind==="open")return `
    <path d="M52 228 L101 210 L176 204 L239 173 L324 181 L388 207 L476 220 L461 249 H61Z" fill="${fill}" stroke="#08090b" stroke-width="8"/>
    <path d="M63 213 L125 190 L154 201 L98 220Z" fill="#1d2025" stroke="#07080a" stroke-width="5"/><path d="M391 204 L461 194 L470 207 L403 219Z" fill="#1d2025" stroke="#07080a" stroke-width="5"/>
    <path d="M217 194 Q234 127 282 130 Q320 133 337 188" fill="#171a20" stroke="#07080a" stroke-width="7"/>${driver(278,132,.9)}
    <path d="M330 191 L365 165 L390 171 L370 211Z" fill="#20242a" stroke="#08090b" stroke-width="6"/><path d="M111 218 Q245 192 450 218" fill="none" stroke="#fff" stroke-opacity=".13" stroke-width="5"/>`;
  if(kind==="stock")return `
    <path d="M74 221 Q97 178 150 165 L205 154 H337 Q397 156 438 199 L466 227 L458 250 H72Z" fill="${fill}" stroke="#08090b" stroke-width="8"/>
    <path d="M185 164 L218 108 H339 L382 166Z" fill="#111820" stroke="#07080a" stroke-width="7"/><path d="M231 121 H326 L354 161 H202Z" fill="#263746" stroke="#687584" stroke-width="4"/>
    <path d="M91 204 Q214 168 448 210" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="5"/><path d="M97 232 H448" stroke="#15171a" stroke-width="10" opacity=".7"/>
    ${driver(276,126,.82)}<path d="M431 187 L474 169 L479 181 L443 199Z" fill="#17191e" stroke="#08090b" stroke-width="5"/>`;
  if(kind==="beater")return `
    <path d="M77 219 L103 178 L172 165 L208 124 H337 L376 167 L439 182 L470 218 L459 249 H73Z" fill="${fill}" stroke="#08090b" stroke-width="8"/>
    <path d="M191 166 L218 116 H327 L363 166Z" fill="#111820" stroke="#07080a" stroke-width="7"/><path d="M232 128 H311 L337 162 H207Z" fill="#27333e" stroke="#66717c" stroke-width="4"/>
    <path d="M101 206 l46 -8 l-10 9 l72 -14 M380 197 l38 7" stroke="#35120d" stroke-width="5" opacity=".75"/><circle cx="423" cy="220" r="8" fill="#d7b548" opacity=".55"/>
    ${driver(276,129,.82)}<path d="M91 214 Q210 184 451 213" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="5"/>`;
  return `
    <path d="M61 229 L98 206 L169 198 L213 164 L329 164 L374 193 L449 207 L472 229 L459 250 H61Z" fill="${fill}" stroke="#08090b" stroke-width="8"/>
    <path d="M189 200 L210 165 L235 154 H309 L343 176 L357 199Z" fill="#1a1d22" stroke="#07080a" stroke-width="7"/>
    ${driver(275,136,.96)}<path d="M77 214 L130 194 L159 199 L109 222Z" fill="#1f2328" stroke="#08090b" stroke-width="5"/><path d="M403 206 L459 198 L468 211 L415 221Z" fill="#1f2328" stroke="#08090b" stroke-width="5"/>
    <path d="M90 220 Q226 190 450 219" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="5"/>`;
}

function decals(kind,number){
  const x=kind==="golf"?278:kind==="pickup"?280:kind==="open"?300:kind==="kart"?300:305;
  const n=kind==="golf"?190:kind==="open"?185:192;
  return `<g transform="translate(${x} 218) skewX(-8)"><text x="0" y="0" text-anchor="middle" font-size="31" font-style="italic" font-weight="900" font-family="Arial,sans-serif" fill="#f5f2e9" stroke="#111" stroke-width="2" paint-order="stroke">DFL</text></g><text x="${n}" y="233" text-anchor="middle" font-size="45" font-weight="900" font-family="Arial,sans-serif" fill="#f7f3e8" stroke="#101114" stroke-width="4" paint-order="stroke">${clamp(Number(number)||12,0,99)}</text>`;
}

export function renderBetaVehicle({vehicle="kart",wheels="Slicks",paint="DFL Red",accessory:accessoryName="None",flag="DFL",number=12}={}){
  const spec=BETA_VEHICLES.find(v=>v.id===vehicle)||BETA_VEHICLES[0], colors=PAINT[paint]||PAINT["DFL Red"];
  const gold=paint==="Championship Gold"||wheels==="Gold Rims",[rear,front]=spec.wheelbase;
  const uid=Math.random().toString(36).slice(2,9),grad=`betaPaint-${uid}`,shine=`betaShine-${uid}`;
  return `<svg class="ab-vehicle-svg" viewBox="0 0 540 330" role="img" aria-label="${esc(spec.label)} preview" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="${grad}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset=".55" stop-color="${colors[1]}"/><stop offset="1" stop-color="${colors[2]}"/></linearGradient><linearGradient id="${shine}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".34" stop-color="#fff" stop-opacity=".02"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient></defs>
    <ellipse cx="272" cy="277" rx="218" ry="23" fill="#000" opacity=".44"/>
    ${antenna(spec.flag[0],spec.flag[1]+145,flag)}${shell(spec.id,grad,shine)}${decals(spec.id,number)}
    ${accessory(accessoryName,spec.accessory[0],spec.accessory[1]+115)}${wheelSvg(rear,248,wheels,gold)}${wheelSvg(front,248,wheels,gold)}
  </svg>`;
}
