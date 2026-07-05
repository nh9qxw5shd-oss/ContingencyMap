/* Contingency Map — data layer & shared helpers.
 * All reads use the anon key (public read policies).
 * All writes go through SECURITY DEFINER RPCs that require the admin passcode,
 * so the anon key alone cannot modify anything.
 */

const SUPABASE_URL = "https://ungtmfwxqawkdiflmora.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuZ3RtZnd4cWF3a2RpZmxtb3JhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxMDY4NjQsImV4cCI6MjA3NzY4Mjg2NH0.Yaq0XfbbkwxJDUoiPCS7bLVBy70Wa-NOOWIxkpRRxdc";

if (!window.supabase) {
  throw new Error("Supabase library failed to load — check your internet connection.");
}

window.CMap = window.CMap || {};

CMap.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== State =====
CMap.state = {
  sections: [],        // [{...section, plans: [...]}]
  adminCode: sessionStorage.getItem("cmapAdminCode") || null,
};

// ===== Data access =====
CMap.loadAll = async function () {
  const [secRes, planRes] = await Promise.all([
    CMap.sb.from("cmap_sections").select("*").order("sort_order").order("name"),
    CMap.sb.from("cmap_plans").select("*").order("sort_order").order("plan_code"),
  ]);
  if (secRes.error) throw new Error("Could not load sections: " + secRes.error.message);
  if (planRes.error) throw new Error("Could not load plans: " + planRes.error.message);

  const bySection = new Map();
  (secRes.data || []).forEach((s) => {
    s.plans = [];
    bySection.set(s.id, s);
  });
  (planRes.data || []).forEach((p) => {
    const s = bySection.get(p.section_id);
    if (s) s.plans.push(p);
  });

  CMap.state.sections = secRes.data || [];
  return CMap.state.sections;
};

CMap.rpc = async function (fn, args) {
  const { data, error } = await CMap.sb.rpc(fn, args);
  if (error) {
    if ((error.message || "").includes("ADMIN_DENIED")) {
      CMap.setAdminCode(null);
      throw new Error("Admin passcode was not accepted. Please sign in to admin again.");
    }
    throw new Error(error.message);
  }
  return data;
};

CMap.setAdminCode = function (code) {
  CMap.state.adminCode = code;
  if (code) sessionStorage.setItem("cmapAdminCode", code);
  else sessionStorage.removeItem("cmapAdminCode");
};

CMap.verifyAdmin = (code) => CMap.rpc("cmap_verify_admin", { p_code: code });
CMap.saveSection = (section) => CMap.rpc("cmap_save_section", { p_code: CMap.state.adminCode, p_section: section });
CMap.deleteSection = (id) => CMap.rpc("cmap_delete_section", { p_code: CMap.state.adminCode, p_id: id });
CMap.savePlan = (plan) => CMap.rpc("cmap_save_plan", { p_code: CMap.state.adminCode, p_plan: plan });
CMap.deletePlan = (id) => CMap.rpc("cmap_delete_plan", { p_code: CMap.state.adminCode, p_id: id });
CMap.changeAdminCode = (oldCode, newCode) => CMap.rpc("cmap_change_admin_code", { p_old: oldCode, p_new: newCode });

// ===== Shared UI helpers =====
CMap.esc = function (str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[m]));
};

CMap.toast = function (message, kind) {
  const root = document.getElementById("toastRoot");
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4200);
};

/* Simple modal. body may be an HTMLElement or an HTML string.
 * Returns {overlay, close}. */
CMap.modal = function ({ title, body, onClose }) {
  const root = document.getElementById("modalRoot");
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const card = document.createElement("div");
  card.className = "modal-card";

  const head = document.createElement("div");
  head.className = "modal-head";
  const h3 = document.createElement("h3");
  h3.textContent = title || "";
  const closeBtn = document.createElement("button");
  closeBtn.className = "icon-btn";
  closeBtn.textContent = "×";
  head.appendChild(h3);
  head.appendChild(closeBtn);

  const bodyEl = document.createElement("div");
  bodyEl.className = "modal-body";
  if (typeof body === "string") bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  card.appendChild(head);
  card.appendChild(bodyEl);
  overlay.appendChild(card);
  root.appendChild(overlay);

  function close() {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    if (onClose) onClose();
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  return { overlay, body: bodyEl, close };
};

/* Confirmation dialog -> Promise<boolean> */
CMap.confirm = function (title, message, confirmLabel) {
  return new Promise((resolve) => {
    const body = document.createElement("div");
    const p = document.createElement("p");
    p.style.cssText = "margin:0 0 14px; font-size:13px;";
    p.textContent = message;
    const row = document.createElement("div");
    row.className = "btn-row";
    const yes = document.createElement("button");
    yes.className = "btn btn-danger";
    yes.textContent = confirmLabel || "Delete";
    const no = document.createElement("button");
    no.className = "btn";
    no.textContent = "Cancel";
    row.appendChild(yes);
    row.appendChild(no);
    body.appendChild(p);
    body.appendChild(row);

    const m = CMap.modal({ title, body, onClose: () => resolve(false) });
    yes.addEventListener("click", () => { m.close(); resolve(true); });
    no.addEventListener("click", () => m.close());
  });
};

/* Stations & junctions on the NR network: rows [name, lat, lng, kind('s'|'j'), crs, elr].
 * Loaded lazily; used by the search box and the section auto-router. */
let locationsPromise = null;
CMap.loadLocations = function () {
  if (!locationsPromise) {
    locationsPromise = fetch("./assets/data/locations.json", { cache: "force-cache" })
      .then((res) => {
        if (!res.ok) throw new Error("locations.json " + res.status);
        return res.json();
      })
      .then((rows) => rows.map(([name, lat, lng, kind, crs, elr]) => ({ name, lat, lng, kind, crs, elr })));
  }
  return locationsPromise;
};

CMap.severityClass = function (sev) {
  const s = String(sev || "").toLowerCase();
  if (s.startsWith("high")) return "sev-high";
  if (s.startsWith("med")) return "sev-medium";
  if (s.startsWith("low")) return "sev-low";
  return "";
};
