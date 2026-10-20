// "Ocultar números": for showing the app to someone. Amounts on screen become $xxx.
// It only changes what's DRAWN: the Sheet, the messages you share and what you copy keep the real numbers.

const KEY = "bolsillo_hide_numbers";
export const MASK = "$xxx";

let hidden = false;
try { hidden = localStorage.getItem(KEY) === "1"; } catch { /* storage unavailable */ }
const paint = () => { if (typeof document !== "undefined") document.documentElement.classList.toggle("hide-numbers", hidden); };
paint();

export const isHidden = () => hidden;
export function setHidden(v) {
  hidden = !!v;
  try { localStorage.setItem(KEY, hidden ? "1" : "0"); } catch { /* storage unavailable */ }
  paint();
}
// A text that carries amounts, as drawn on screen (the original text is what gets shared).
export const maskAmounts = text => (hidden ? String(text).replace(/\$\s?[\d,]+(\.\d+)?/g, MASK) : text);
