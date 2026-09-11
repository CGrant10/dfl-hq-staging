(() => {
  /* This private environment exists to preview motion, so show the selected
     direction even when the test browser asks pages to reduce animation. */
  document.documentElement.dataset.motionPreview = "full";

  const selector = [
    ".page-head", ".dfl-anniv", "[data-bx-stage]", ".fp-snap", ".creed-doors",
    ".home-lower > *", "#home-wrap > .card", "#home-wrap > .block", ".ta-report-section",
    ".td-ticket", "#view > :not(#home-wrap)", ".view > .card", ".view > .block"
  ].join(",");
  let launched = false;
  const waiting = new Set();

  const reveal = element => {
    waiting.delete(element);
    requestAnimationFrame(() => element.classList.add("m3-in"));
  };

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      if (launched) reveal(entry.target);
      else waiting.add(entry.target);
    }
  }, { threshold: .08, rootMargin: "0px 0px -5% 0px" });

  const prepare = root => {
    const view = root.matches?.("#view") ? root : root.querySelector?.("#view") || document.querySelector("#view");
    if (!view) return;
    [...view.querySelectorAll(selector)].forEach((element, index) => {
      if (element.classList.contains("m3-reveal")) return;
      element.classList.add("m3-reveal");
      element.dataset.m3Side = index % 2 ? "right" : "left";
      element.style.setProperty("--m3-delay", `${Math.min(index, 6) * 65}ms`);
      observer.observe(element);
    });
  };

  const launch = () => {
    if (launched) return;
    launched = true;
    prepare(document);
    let index = 0;
    for (const element of waiting) {
      element.style.setProperty("--m3-delay", `${Math.min(index++, 6) * 65}ms`);
      reveal(element);
    }
  };

  const start = () => {
    prepare(document);
    new MutationObserver(() => prepare(document)).observe(document.body, { childList: true, subtree: true });

    const splash = document.querySelector("#splash");
    if (!splash || getComputedStyle(splash).visibility === "hidden") launch();
    else {
      const onSplashEnd = event => {
        if (event.target !== splash || event.animationName !== "dfl-splash-out") return;
        splash.removeEventListener("animationend", onSplashEnd);
        launch();
      };
      splash.addEventListener("animationend", onSplashEnd);
      setTimeout(launch, 2400);
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
