(() => {
  const originalFetch = globalThis.fetch.bind(globalThis);
  const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
  const protectedHosts = [".supabase.co", "api.sleeper.app"];

  globalThis.DFL_STAGING = true;
  globalThis.fetch = (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    const method = String(init.method || request?.method || "GET").toUpperCase();
    const url = new URL(request?.url || String(input), location.href);
    const protectedHost = protectedHosts.some(host => url.hostname === host.replace(/^\./, "") || url.hostname.endsWith(host));
    if (protectedHost && !safeMethods.has(method)) {
      return Promise.reject(new Error("DFL Staging is view-only. Live league data was not changed."));
    }
    return originalFetch(input, init);
  };

  const markStaging = () => {
    if (document.querySelector("[data-dfl-staging]")) return;
    const badge = document.createElement("div");
    badge.dataset.dflStaging = "";
    badge.textContent = "STAGING";
    badge.setAttribute("aria-label", "DFL staging environment");
    Object.assign(badge.style, {
      position: "fixed", top: "max(8px, env(safe-area-inset-top))", right: "10px",
      zIndex: "2147483647", padding: "5px 9px", border: "1px solid rgba(255,255,255,.22)",
      borderRadius: "999px", background: "rgba(10,14,22,.82)", color: "#fff",
      font: "700 11px/1 system-ui, sans-serif", letterSpacing: ".12em",
      boxShadow: "0 6px 18px rgba(0,0,0,.2)", pointerEvents: "none", backdropFilter: "blur(10px)"
    });
    document.body.appendChild(badge);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", markStaging, { once: true });
  else markStaging();
})();
