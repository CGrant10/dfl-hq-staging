// Arena custom duration UI.
// Database compatibility stays in ticks, but humans enter seconds.
import "./arena/landscape-lock.js";

const TICKS_PER_SECOND = 25;

function wireDurationInput(root = document) {
  for (const tickInput of root.querySelectorAll('input[name="length_ticks"]')) {
    if (tickInput.dataset.secondsWired === "1") continue;
    tickInput.dataset.secondsWired = "1";

    const label = root.querySelector(`label[for="${CSS.escape(tickInput.id)}"]`);
    if (label) label.textContent = "Custom duration (seconds)";

    const storedTicks = Number(tickInput.value || 0);
    const secondsInput = document.createElement("input");
    secondsInput.type = "number";
    secondsInput.min = "5";
    secondsInput.max = "180";
    secondsInput.step = "1";
    secondsInput.inputMode = "numeric";
    secondsInput.placeholder = "60";
    secondsInput.value = storedTicks > 0 ? String(Math.max(1, Math.round(storedTicks / TICKS_PER_SECOND))) : "";
    secondsInput.setAttribute("aria-label", "Custom race duration in seconds");

    // readForm() still expects length_ticks, so the original control becomes
    // the hidden compatibility field and mirrors the human seconds value.
    tickInput.type = "hidden";
    tickInput.insertAdjacentElement("afterend", secondsInput);

    const sync = () => {
      const seconds = Number(secondsInput.value);
      tickInput.value = Number.isFinite(seconds) && seconds > 0
        ? String(Math.round(seconds * TICKS_PER_SECOND))
        : "";
    };
    secondsInput.addEventListener("input", sync);
    secondsInput.addEventListener("change", sync);
  }
}

function sweep() { wireDurationInput(document); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sweep);
else sweep();
new MutationObserver(sweep).observe(document.documentElement, { childList:true, subtree:true });
