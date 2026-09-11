import { H as e, u as t } from "./Geometry-D1neCpWU.js";
//#region node_modules/.pnpm/pixi.js@8.20.0/node_modules/pixi.js/lib/rendering/batcher/gpu/getTextureBatchBindGroup.mjs
var n = {};
function r(e, t, r) {
	let a = 2166136261;
	for (let n = 0; n < t; n++) a ^= e[n].uid, a = Math.imul(a, 16777619), a >>>= 0;
	return n[a] || i(e, t, a, r);
}
function i(r, i, a, o) {
	let s = {}, c = 0;
	for (let t = 0; t < o; t++) {
		let n = t < i ? r[t] : e.EMPTY.source;
		s[c++] = n.source, s[c++] = n.style;
	}
	let l = new t(s);
	return n[a] = l, l;
}
//#endregion
export { r as t };

//# sourceMappingURL=getTextureBatchBindGroup-CtL7Ot9Y.js.map