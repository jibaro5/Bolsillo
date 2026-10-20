import { useState, useEffect } from "react";

// Cuentas (administrators only): who can enter Bolsillo, invitations, blocking, and each
// person's Apple Pay key. The server checks the administrator role on every action; this
// screen only exists in the menu for admins, but that's not what protects it.

const rel = iso => {
  if (!iso) return "nunca";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return "ahora";
  if (m < 60) return `hace ${m} min`;
  if (m < 60 * 24) return `hace ${Math.round(m / 60)} h`;
  return `hace ${Math.round(m / 1440)} d`;
};
const left = iso => {
  const h = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3600000));
  return h >= 24 ? `${Math.round(h / 24)} d` : `${h} h`;
};

export default function Accounts({ fetcher, showToast, me }) {
  const [data, setData] = useState({ users: [], invites: [] });
  const [state, setState] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [shown, setShown] = useState(null);          // { kind: "invite"|"key", ... } secret shown once
  const [confirm, setConfirm] = useState(null);      // { action, userLabel, text }

  async function call(action, payload = {}) {
    const res = await fetcher("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `${action} failed`);
    return out;
  }
  async function load() {
    try {
      const res = await fetcher("/api/admin?action=overview");
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
      setState("ok");
    } catch (err) { console.error(err); setState("error"); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ERR = {
    cannot_block_self: "No puedes bloquear tu propia cuenta.",
    cannot_delete_self: "No puedes eliminar tu propia cuenta.",
    last_admin: "Debe quedar al menos un administrador activo.",
    nombre_invalido: "Escribe un nombre (máx. 40 caracteres).",
  };
  async function act(action, payload, okMsg) {
    if (busy) return null;
    setBusy(true);
    try {
      const out = await call(action, payload);
      if (okMsg) showToast(okMsg);
      await load();
      return out;
    } catch (err) {
      showToast(ERR[err.message] || "No se pudo completar", "warn");
      return null;
    } finally { setBusy(false); }
  }

  async function createInvite(e) {
    e.preventDefault();
    const out = await act("invite-create", { userLabel: inviteName.trim() });
    if (out) { setShowInvite(false); setInviteName(""); setShown({ kind: "invite", ...out }); }
  }
  async function createKey(userLabel) {
    const out = await act("apple-key-create", { userLabel });
    if (out) setShown({ kind: "key", ...out });
  }
  async function runConfirm() {
    const c = confirm; setConfirm(null);
    await act(c.action, { userLabel: c.userLabel }, c.done);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); showToast("Copiado"); } catch { showToast("No se pudo copiar", "warn"); }
  }
  async function share(text) {
    try { if (navigator.share) await navigator.share({ text }); else await copy(text); }
    catch (err) { if (err?.name !== "AbortError") showToast("No se pudo compartir", "warn"); }
  }

  const css = `
    .ac-card{background:#fff;border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(15,23,42,.06);}
    .ac-pill{display:inline-block;font-size:10px;font-weight:700;border-radius:99px;padding:2px 9px;margin-left:6px;vertical-align:middle;}
    .ac-meta{font-size:12px;color:#64748b;margin-top:3px;}
    .ac-code{font-family:ui-monospace,Menlo,monospace;font-size:24px;font-weight:700;letter-spacing:2px;text-align:center;background:#f1f5f9;border-radius:12px;padding:14px 8px;margin:12px 0;word-break:break-all;}
  `;

  if (state === "loading") return <div className="empty-state">Cargando cuentas…</div>;
  if (state === "error") return (
    <div className="empty-state">No se pudo cargar. <div style={{ marginTop: 12 }}><button className="btn btn-p" onClick={() => { setState("loading"); load(); }}>Reintentar</button></div></div>
  );

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div>
      <style>{css}</style>

      <div className="ac-card">
        <div style={{ fontSize: 14, fontWeight: 700 }}>Quién puede entrar</div>
        <div className="ac-meta" style={{ marginBottom: 12 }}>Para sumar a alguien, créale una invitación de un solo uso (vence en 48 horas). Con ella registra su Face ID o contraseña.</div>
        <button className="btn btn-p" style={{ width: "100%" }} onClick={() => { setInviteName(""); setShowInvite(true); }}>+ Invitar a alguien</button>
      </div>

      {data.users.map(u => {
        const self = me && u.userLabel.toLowerCase() === me.userLabel.toLowerCase();
        const blocked = u.estado !== "activo";
        return (
          <div key={u.userLabel} className="ac-card" style={blocked ? { opacity: 0.8 } : undefined}>
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{u.userLabel}</span>
              {u.rol === "admin" && <span className="ac-pill" style={{ background: "#eff6ff", color: "#0f4c81" }}>Administrador</span>}
              {self && <span className="ac-pill" style={{ background: "#f1f5f9", color: "#475569" }}>Tú</span>}
              {blocked && <span className="ac-pill" style={{ background: "#fef2f2", color: "#dc2626" }}>Bloqueado</span>}
            </div>
            <div className="ac-meta">
              Face ID: {u.devices} dispositivo{u.devices !== 1 ? "s" : ""} · Contraseña: {u.password ? "sí" : "no"} · Último acceso: {rel(u.ultimoAcceso)}
            </div>
            <div className="ac-meta">Apple Pay: {u.appleKey ? `clave personal ••••${u.appleKey.hint}` : (self ? "clave original del atajo" : "sin clave")}</div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              <button className="btn btn-g btn-sm" disabled={busy || blocked} onClick={() => createKey(u.userLabel)}>{u.appleKey ? "Nueva clave Apple Pay" : "Crear clave Apple Pay"}</button>
              {u.appleKey && <button className="btn btn-g btn-sm" disabled={busy} onClick={() => setConfirm({ action: "apple-key-revoke", userLabel: u.userLabel, done: "Clave revocada", text: `La clave de Apple Pay de ${u.userLabel} dejará de funcionar de inmediato.`, button: "Revocar clave" })}>Revocar clave</button>}
              {!self && (blocked
                ? <button className="btn btn-g btn-sm" disabled={busy} onClick={() => act("user-unblock", { userLabel: u.userLabel }, "Desbloqueado")}>Desbloquear</button>
                : <button className="btn btn-amber btn-sm" disabled={busy} onClick={() => setConfirm({ action: "user-block", userLabel: u.userLabel, done: "Bloqueado", text: `${u.userLabel} perderá el acceso en menos de un minuto, aunque tenga la sesión abierta. Podrás desbloquearla después.`, button: "Bloquear" })}>Bloquear</button>)}
              {!self && <button className="btn btn-d btn-sm" disabled={busy} onClick={() => setConfirm({ action: "user-delete", userLabel: u.userLabel, done: "Cuenta eliminada", text: `Se borran el Face ID, la contraseña y la clave de Apple Pay de ${u.userLabel}. Sus gastos ya registrados se quedan. Para que vuelva a entrar necesitará una invitación nueva.`, button: "Eliminar cuenta" })}>Eliminar</button>}
            </div>
          </div>
        );
      })}

      {data.invites.length > 0 && (
        <div className="ac-card">
          <div style={{ fontSize: 11, letterSpacing: 1, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>INVITACIONES PENDIENTES</div>
          {data.invites.map(i => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid #f1f5f9" }}>
              <span style={{ flex: 1, fontSize: 14 }}>{i.userLabel}<span className="ac-meta" style={{ display: "block" }}>vence en {left(i.expira)}</span></span>
              <button className="btn btn-g btn-sm" disabled={busy} onClick={() => act("invite-revoke", { id: i.id }, "Invitación cancelada")}>Cancelar</button>
            </div>
          ))}
        </div>
      )}

      {showInvite && (
        <div className="modal-overlay" onClick={() => setShowInvite(false)}>
          <form className="modal" onClick={e => e.stopPropagation()} onSubmit={createInvite}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: "#0f4c81", marginBottom: 14, fontWeight: 700 }}>INVITAR A ALGUIEN</div>
            <div className="field"><label>Nombre de la persona</label>
              <input className="inp" value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Ej. Shelsy" maxLength={40} autoFocus required />
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 14 }}>Se crea un código de un solo uso. Verás el código una vez; envíaselo tú.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-p" style={{ flex: 1 }} type="submit" disabled={busy || !inviteName.trim()}>{busy ? "Creando…" : "Crear invitación"}</button>
              <button className="btn btn-g" type="button" onClick={() => setShowInvite(false)}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {shown?.kind === "invite" && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 400 }}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: "#0f4c81", fontWeight: 700 }}>INVITACIÓN PARA {shown.userLabel.toUpperCase()}</div>
            <div className="ac-code">{shown.code}</div>
            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
              Un solo uso. Vence en {left(shown.expira)}. Solo se muestra ahora: si la pierdes, crea otra.
              <br /><br />Cómo la usa: abre {origin.replace(/^https?:\/\//, "")}, toca <b>Configurar este dispositivo</b> y escribe su nombre y este código.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn btn-p" style={{ flex: 1 }} onClick={() => share(`Tu invitación a Bolsillo: ${shown.code}\n1. Abre ${origin}\n2. Toca "Configurar este dispositivo"\n3. Escribe tu nombre (${shown.userLabel}) y este código.\nVence en ${left(shown.expira)}, un solo uso.`)}>Compartir</button>
              <button className="btn btn-g" onClick={() => copy(shown.code)}>Copiar código</button>
            </div>
            <button className="btn btn-g" style={{ width: "100%", marginTop: 8 }} onClick={() => setShown(null)}>Listo</button>
          </div>
        </div>
      )}

      {shown?.kind === "key" && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 400 }}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: "#0f4c81", fontWeight: 700 }}>CLAVE APPLE PAY DE {shown.userLabel.toUpperCase()}</div>
            <div className="ac-code" style={{ fontSize: 14, letterSpacing: 0 }}>{shown.key}</div>
            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
              Solo se muestra ahora. En el atajo de {shown.userLabel}, en la acción <b>Get Contents of URL</b> → <b>Headers</b>, pon esta clave en <b>X-Bolsillo-Key</b>. Desde ese momento sus compras de Apple Pay llegan a su nombre.
              {" "}Si ya tenía otra clave, esa deja de funcionar.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn btn-p" style={{ flex: 1 }} onClick={() => copy(shown.key)}>Copiar clave</button>
              <button className="btn btn-g" onClick={() => setShown(null)}>Listo</button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="modal-overlay" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: "#dc2626", marginBottom: 12, fontWeight: 700 }}>{confirm.button.toUpperCase()}</div>
            <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.5, marginBottom: 18 }}>{confirm.text}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-d" style={{ flex: 1 }} onClick={runConfirm}>{confirm.button}</button>
              <button className="btn btn-g" onClick={() => setConfirm(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
