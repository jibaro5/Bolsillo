// Pure bill-splitting math (no React, no I/O). Everything is computed in whole
// cents so the shares always add up to the exact total.

export const toCents = v => {
  const n = parseFloat(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

// `total` cents split evenly across n shares; the leftover cents go one each
// to the first shares, starting at `offset` (wrapping) so they don't always
// land on the same person.
export function evenShares(total, n, offset = 0) {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  let rest = total - base * n;
  const out = Array(n).fill(base);
  for (let i = 0; rest > 0; i++, rest--) out[(offset + i) % n] += 1;
  return out;
}

// `total` cents shared out in proportion to `weights` (largest-remainder
// method: shares are whole cents and sum exactly to `total`). All-zero weights
// fall back to an even split.
export function allocate(total, weights) {
  const n = weights.length;
  if (!n) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return evenShares(total, n);
  const raw = weights.map(w => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k++, rest--) out[order[k % n][1]] += 1;
  return out;
}

// A tax / tip entry is a percentage of the assigned subtotal ("pct") or a fixed amount ("amt").
const extraCents = (spec, baseCents) => {
  if (!spec || spec.value === "" || spec.value == null) return 0;
  if (spec.mode === "amt") return Math.max(0, toCents(spec.value));
  const pct = parseFloat(spec.value);
  return Number.isFinite(pct) && pct > 0 ? Math.round((baseCents * pct) / 100) : 0;
};

// items:  [{ id, name, price, people: [personId...] }]   (empty people = not assigned yet)
// people: [{ id, name, mergedInto }]                     (mergedInto = another person's id that pays for them)
// Returns per-person totals, per-group (merged plates) totals and bill totals, all in cents.
export function computeSplit({ items, people, tax, tip }) {
  const ids = people.map(p => p.id);
  const sub = Object.fromEntries(ids.map(id => [id, 0]));
  const lines = Object.fromEntries(ids.map(id => [id, []]));
  let unassigned = 0, unassignedCount = 0, rot = 0;

  for (const it of items) {
    const price = toCents(it.price);
    if (price <= 0) continue;
    const who = (it.people || []).filter(id => id in sub);
    if (!who.length) { unassigned += price; unassignedCount += 1; continue; }
    evenShares(price, who.length, rot).forEach((c, i) => {
      sub[who[i]] += c;
      lines[who[i]].push({ itemId: it.id, name: it.name || "Ítem", cents: c, shared: who.length > 1 });
    });
    rot += 1;
  }

  const assigned = ids.reduce((s, id) => s + sub[id], 0);
  const taxCents = extraCents(tax, assigned);
  const tipCents = extraCents(tip, assigned);
  const weights = ids.map(id => sub[id]);
  const taxShare = allocate(taxCents, weights);
  const tipShare = allocate(tipCents, weights);

  const per = {};
  ids.forEach((id, i) => {
    per[id] = { subtotal: sub[id], tax: taxShare[i], tip: tipShare[i], total: sub[id] + taxShare[i] + tipShare[i], lines: lines[id] };
  });

  // Merged plates: the head pays for every plate merged into it.
  const byId = Object.fromEntries(people.map(p => [p.id, p]));
  const headOf = id => { let p = byId[id], hops = 0; while (p?.mergedInto && byId[p.mergedInto] && hops++ < 10) p = byId[p.mergedInto]; return p?.id ?? id; };
  const groups = [];
  for (const p of people) {
    if (headOf(p.id) !== p.id) continue;
    const members = people.filter(m => headOf(m.id) === p.id);
    const sum = k => members.reduce((s, m) => s + per[m.id][k], 0);
    groups.push({ head: p, members, subtotal: sum("subtotal"), tax: sum("tax"), tip: sum("tip"), total: sum("total") });
  }

  return { per, groups, assigned, unassigned, unassignedCount, taxCents, tipCents, grand: assigned + taxCents + tipCents };
}

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const money = c => `$${(c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
export { money };

// Neutral message for the whole table: everyone's share and who paid. No payment details.
export function buildMessage({ merchant, date, payerId, result, withItems }) {
  const [, m, d] = String(date || "").split("-").map(Number);
  const when = m ? `${d} ${MONTHS_SHORT[m - 1]}` : "";
  const payerGroup = result.groups.find(g => g.members.some(x => x.id === payerId)) || result.groups[0];
  const out = [`${merchant?.trim() || "Cuenta"}${when ? ` · ${when}` : ""}`, `Total: ${money(result.grand)}${payerGroup ? ` · Pagó ${payerGroup.members.find(x => x.id === payerId)?.name || payerGroup.head.name}` : ""}`, ""];
  for (const g of result.groups) {
    const names = g.members.filter(x => x.id !== g.head.id).map(x => x.name);
    const isPayer = g === payerGroup;
    out.push(`${g.head.name}: ${money(g.total)}${names.length ? ` (incluye a ${names.join(", ")})` : ""}${isPayer ? " · pagó" : ""}`);
    if (withItems) {
      // Merged plates: the same shared item counts once, with their shares added.
      const byItem = new Map();
      for (const mbr of g.members) for (const l of result.per[mbr.id].lines) {
        const cur = byItem.get(l.itemId);
        byItem.set(l.itemId, cur ? { ...cur, cents: cur.cents + l.cents } : { ...l });
      }
      for (const l of byItem.values()) out.push(`   · ${l.name}${l.shared ? " (compartido)" : ""} ${money(l.cents)}`);
      if (g.tax || g.tip) out.push(`   · Impuesto y propina ${money(g.tax + g.tip)}`);
    }
  }
  if (result.taxCents || result.tipCents) out.push("", `Incluye ${[result.taxCents && "impuesto", result.tipCents && "propina"].filter(Boolean).join(" y ")}.`);
  if (payerGroup) out.push(`Cada quien le envía su parte a ${payerGroup.members.find(x => x.id === payerId)?.name || payerGroup.head.name}.`);
  return out.join("\n");
}
