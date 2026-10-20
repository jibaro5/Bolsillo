// Makes the people who already sign in (the "Auth" tab) active users, with the given name as administrator.
// Run BEFORE the access check goes live:  node --env-file=.env.local scripts/seed-admin.mjs Omar
import { listUserLabels } from "../lib/authStore.js";
import { ensureUser, listUsers } from "../lib/usersStore.js";

const admin = process.argv[2];
if (!admin) { console.log("Uso: node scripts/seed-admin.mjs <nombre del administrador>"); process.exit(1); }
const labels = await listUserLabels();
console.log("Cuentas que ya entran:", labels.join(", ") || "(ninguna)");
if (!labels.some(l => l.toLowerCase() === admin.toLowerCase())) { console.log(`"${admin}" no está entre esas cuentas; no se crea nada.`); process.exit(1); }
for (const l of labels) await ensureUser(l, l.toLowerCase() === admin.toLowerCase() ? "admin" : "miembro");
console.log((await listUsers({ fresh: true })).map(u => `${u.userLabel}: ${u.rol}/${u.estado}`).join(" | "));
