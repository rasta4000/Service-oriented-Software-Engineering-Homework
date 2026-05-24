// ============================================================================
// app.js – Frontend Logic for Turismo Etico Abruzzo
// Comunicazione con DaaS (porta 3000) e EaaS (porta 4000)
// ============================================================================

const DAAS = "http://localhost:3000";
const EAAS = "http://localhost:4000";

// ---------- Navigation ----------

document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", e => {
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

function navigateTo(page) {
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const navEl = document.querySelector(`[data-page="${page}"]`);
  const pageEl = document.getElementById(`page-${page}`);
  if (navEl) navEl.classList.add("active");
  if (pageEl) pageEl.classList.add("active");

  // Load data on page open
  if (page === "dashboard") loadDashboard();
  if (page === "explore") activateTab("poi");
  if (page === "evaluate") loadEntityOptions();
  if (page === "audit") { setAuditDateToday(); loadAudit(); }
}

// ---------- API Helpers ----------

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function postJSON(url, body = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ---------- Service Status ----------

async function checkServices() {
  const daasEl = document.getElementById("daas-status");
  const eaasEl = document.getElementById("eaas-status");
  try {
    await fetchJSON(`${DAAS}/api/events`);
    daasEl.classList.add("online");
  } catch { daasEl.classList.remove("online"); }
  try {
    await fetchJSON(`${EAAS}/api/policies`);
    eaasEl.classList.add("online");
  } catch { eaasEl.classList.remove("online"); }
}

// ---------- Dashboard ----------

async function loadDashboard() {
  try {
    const [trails, events, risky] = await Promise.all([
      fetchJSON(`${DAAS}/api/trails`),
      fetchJSON(`${DAAS}/api/events`),
      fetchJSON(`${DAAS}/api/sites/risky`)
    ]);

    // Count all POI (use search with a broad query, or sum up from provinces)
    let poiCount = 0;
    for (const prov of ["L'Aquila", "Chieti", "Teramo", "Pescara"]) {
      try {
        const r = await fetchJSON(`${DAAS}/api/poi/provincia/${encodeURIComponent(prov)}`);
        poiCount += r.count;
      } catch {}
    }

    document.getElementById("stat-poi").textContent = poiCount;
    document.getElementById("stat-trails").textContent = trails.count;
    document.getElementById("stat-events").textContent = events.count;
    document.getElementById("stat-risky").textContent = risky.count;
  } catch (err) {
    console.error("Dashboard load error:", err);
  }
}

// ---------- Quick Scenario (from dashboard) ----------

async function runQuickScenario(id) {
  const panel = document.getElementById("quick-result");
  panel.classList.remove("hidden");
  panel.innerHTML = '<div class="loading-placeholder"><span class="spinner"></span> Valutazione in corso...</div>';

  try {
    const result = await postJSON(`${EAAS}/api/evaluate/site/${id}`, { requestedBy: "dashboard-quick" });
    panel.innerHTML = renderCompactResult(result);
  } catch (err) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Errore: ${err.message}</p><p><small>Assicurati che entrambi i servizi (DaaS e EaaS) siano in esecuzione.</small></p></div>`;
  }
}
window.runQuickScenario = runQuickScenario;

function renderCompactResult(result) {
  const ev = result.evaluation;
  const dec = ev.decision;
  const cls = dec === "PROCEED" ? "proceed" : dec === "ESCALATE" ? "escalate" : "reject";
  const icon = dec === "PROCEED" ? "✅" : dec === "ESCALATE" ? "⚠️" : "🛑";

  return `
    <div class="result-header">
      ${createTrafficLight(dec)}
      <div>
        <div class="result-decision ${cls}">${icon} ${dec}</div>
        <div style="color:var(--text-secondary);font-size:0.85rem;margin-top:0.25rem;">
          ${ev.entityName} — Score: <strong>${ev.overallScore}/100</strong>
        </div>
      </div>
    </div>
    <div style="font-size:0.85rem;color:var(--text-secondary);">
      Violazioni: <strong>${ev.rationale.filter(r => r.severity).length}</strong> |
      Policy applicate: ${Object.keys(ev.evaluations).join(", ")}
    </div>
  `;
}

// ---------- Explore Data ----------

function activateTab(tab) {
  document.querySelectorAll("#explore-tabs .tab").forEach(t => t.classList.remove("active"));
  const tabEl = document.querySelector(`[data-tab="${tab}"]`);
  if (tabEl) tabEl.classList.add("active");

  // Show/hide filters
  document.getElementById("search-bar").classList.toggle("hidden", tab !== "search");
  document.getElementById("poi-filter").classList.toggle("hidden", tab !== "poi");
  document.getElementById("trail-filter").classList.toggle("hidden", tab !== "trails");

  if (tab === "poi") loadPOIByProvincia();
  else if (tab === "trails") loadTrails();
  else if (tab === "events") loadEvents();
  else if (tab === "risky") loadRiskySites();
  else if (tab === "search") { document.getElementById("explore-results").innerHTML = '<div class="loading-placeholder">Inserisci un termine e premi Cerca</div>'; }
}

document.querySelectorAll("#explore-tabs .tab").forEach(t => {
  t.addEventListener("click", () => activateTab(t.dataset.tab));
});

async function loadPOIByProvincia() {
  const prov = document.getElementById("provincia-select").value;
  const grid = document.getElementById("explore-results");
  grid.innerHTML = '<div class="loading-placeholder"><span class="spinner"></span></div>';

  try {
    let data = [];
    if (prov) {
      const r = await fetchJSON(`${DAAS}/api/poi/provincia/${encodeURIComponent(prov)}`);
      data = r.data;
    } else {
      for (const p of ["L'Aquila", "Chieti", "Teramo", "Pescara"]) {
        const r = await fetchJSON(`${DAAS}/api/poi/provincia/${encodeURIComponent(p)}`);
        data = data.concat(r.data);
      }
    }
    if (data.length === 0) { grid.innerHTML = '<div class="empty-state"><div class="empty-icon">📍</div><p>Nessun punto di interesse trovato</p></div>'; return; }
    grid.innerHTML = data.map(d => `
      <div class="data-card">
        <div class="data-card-title">${typeIcon(d.tipo)} ${cleanLang(d.nome)}</div>
        <div class="data-card-meta">${d.comune} — ${d.tipo}</div>
        <div class="data-card-tags">
          ${riskBadge(d.rischio)}
          ${accessBadge(d.accessibilita)}
        </div>
      </div>
    `).join("");
  } catch (err) { grid.innerHTML = errorMsg(err); }
}
window.loadPOIByProvincia = loadPOIByProvincia;

async function loadTrails() {
  const diff = document.getElementById("difficulty-select").value;
  const grid = document.getElementById("explore-results");
  grid.innerHTML = '<div class="loading-placeholder"><span class="spinner"></span></div>';

  try {
    const url = diff ? `${DAAS}/api/trails?difficulty=${diff}` : `${DAAS}/api/trails`;
    const r = await fetchJSON(url);
    if (r.data.length === 0) { grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🥾</div><p>Nessun sentiero trovato</p></div>'; return; }
    grid.innerHTML = r.data.map(d => `
      <div class="data-card">
        <div class="data-card-title">🥾 ${cleanLang(d.nome)}</div>
        <div class="data-card-meta">${d.comune} — ${d.lunghezzaKm} km, ${d.dislivelloM} m dislivello</div>
        <div class="data-card-tags">
          <span class="badge badge-info">Difficoltà: ${d.difficolta}</span>
          ${riskBadge(d.rischio)}
          ${accessBadge(d.accessibilita)}
          ${d.poiAttraversato ? `<span class="badge badge-neutral">→ ${d.poiAttraversato}</span>` : ""}
        </div>
      </div>
    `).join("");
  } catch (err) { grid.innerHTML = errorMsg(err); }
}
window.loadTrails = loadTrails;

async function loadEvents() {
  const grid = document.getElementById("explore-results");
  grid.innerHTML = '<div class="loading-placeholder"><span class="spinner"></span></div>';
  try {
    const r = await fetchJSON(`${DAAS}/api/events`);
    grid.innerHTML = r.data.map(d => `
      <div class="data-card">
        <div class="data-card-title">🎭 ${cleanLang(d.nome)}</div>
        <div class="data-card-meta">${d.comune}, ${d.provincia} — ${d.dataInizio} → ${d.dataFine}</div>
        <div class="data-card-desc">${cleanLang(d.descrizione)}</div>
        <div class="data-card-tags">
          ${riskBadge(d.rischio)}
          ${d.locationNome ? `<span class="badge badge-neutral">📍 ${cleanLang(d.locationNome)}</span>` : ""}
        </div>
      </div>
    `).join("");
  } catch (err) { grid.innerHTML = errorMsg(err); }
}

async function loadRiskySites() {
  const grid = document.getElementById("explore-results");
  grid.innerHTML = '<div class="loading-placeholder"><span class="spinner"></span></div>';
  try {
    const r = await fetchJSON(`${DAAS}/api/sites/risky`);
    grid.innerHTML = r.data.map(d => `
      <div class="data-card" style="border-color:rgba(239,68,68,0.2);">
        <div class="data-card-title">${typeIcon(d.tipo)} ${cleanLang(d.nome)}</div>
        <div class="data-card-meta">${d.comune}, ${d.provincia}</div>
        <div class="data-card-tags">
          ${riskBadge(d.rischio)}
          ${d.overCapacity ? '<span class="badge badge-danger">⚠️ Oltre capacità</span>' : ""}
          ${d.capacita ? `<span class="badge badge-neutral">Cap: ${d.capacita}</span>` : ""}
          ${d.visitatori ? `<span class="badge badge-neutral">Vis: ${d.visitatori}</span>` : ""}
          ${d.nomeProduttore ? `<span class="badge badge-info">🏪 ${cleanLang(d.nomeProduttore)}</span>` : ""}
        </div>
      </div>
    `).join("");
  } catch (err) { grid.innerHTML = errorMsg(err); }
}

async function doSearch() {
  const q = document.getElementById("search-input").value.trim();
  if (!q) return;
  const grid = document.getElementById("explore-results");
  grid.innerHTML = '<div class="loading-placeholder"><span class="spinner"></span></div>';
  try {
    const r = await fetchJSON(`${DAAS}/api/search?q=${encodeURIComponent(q)}`);
    if (r.data.length === 0) { grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>Nessun risultato per "${q}"</p></div>`; return; }
    grid.innerHTML = r.data.map(d => `
      <div class="data-card">
        <div class="data-card-title">${typeIcon(d.tipo)} ${cleanLang(d.nome)}</div>
        <div class="data-card-meta">${d.comune || ""} ${d.provincia ? "— " + d.provincia : ""} — ${d.tipo}</div>
        ${d.descrizione ? `<div class="data-card-desc">${cleanLang(d.descrizione)}</div>` : ""}
      </div>
    `).join("");
  } catch (err) { grid.innerHTML = errorMsg(err); }
}
window.doSearch = doSearch;

document.getElementById("search-input").addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

// ---------- Evaluation ----------

const EVAL_ENTITIES = {
  site: [
    { id: "GranSasso", label: "Parco Nazionale del Gran Sasso" },
    { id: "LagoScanno", label: "Lago di Scanno" },
    { id: "CostaDeiTrabocchi", label: "Costa dei Trabocchi" },
    { id: "RiservaDaniele", label: "Riserva Lecceta Torino di Sangro" },
    { id: "RoccaCalascio", label: "Rocca di Calascio" },
    { id: "SanClementeACasauria", label: "Abbazia San Clemente a Casauria" },
    { id: "SantoStefanoSessanio", label: "Borgo di Santo Stefano di Sessanio" },
    { id: "CattedraleSanBerardo", label: "Cattedrale di San Berardo – Teramo" }
  ],
  trail: [
    { id: "SentieroDelloSpirito", label: "Sentiero dello Spirito – Maiella" },
    { id: "SentieroDellaLiberta", label: "Sentiero della Libertà" },
    { id: "AnelloCampoImperatore", label: "Anello di Campo Imperatore" },
    { id: "CiclabileTrabocchi", label: "Via Verde Costa dei Trabocchi" }
  ]
};

function loadEntityOptions() {
  const typeEl = document.getElementById("eval-type");
  const idEl = document.getElementById("eval-id");
  const type = typeEl.value;
  const entities = EVAL_ENTITIES[type] || [];
  idEl.innerHTML = entities.map(e => `<option value="${e.id}">${e.label}</option>`).join("");
}

document.getElementById("eval-type").addEventListener("change", loadEntityOptions);

async function runEvaluation() {
  const type = document.getElementById("eval-type").value;
  const id = document.getElementById("eval-id").value;
  const user = document.getElementById("eval-user").value || "studente";
  const panel = document.getElementById("eval-result");
  panel.classList.remove("hidden");
  panel.innerHTML = '<div class="loading-placeholder"><span class="spinner"></span> Valutazione in corso...</div>';

  try {
    const result = await postJSON(`${EAAS}/api/evaluate/${type}/${id}`, { requestedBy: user });
    panel.innerHTML = renderFullResult(result);
  } catch (err) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Errore: ${err.message}</p></div>`;
  }
}
window.runEvaluation = runEvaluation;

// ---------- Test Scenarios ----------

async function runScenario(id, slot) {
  const container = document.getElementById(`result-${slot}`);
  container.innerHTML = '<div class="loading-placeholder"><span class="spinner"></span> Esecuzione scenario...</div>';

  try {
    const result = await postJSON(`${EAAS}/api/evaluate/site/${id}`, { requestedBy: `scenario-test-${slot}` });
    container.innerHTML = renderFullResult(result);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Errore: ${err.message}</p><p><small>Assicurati che DaaS (porta 3000) e EaaS (porta 4000) siano attivi.</small></p></div>`;
  }
}
window.runScenario = runScenario;

// ---------- Full Result Renderer ----------

function renderFullResult(result) {
  const ev = result.evaluation;
  const dec = ev.decision;
  const cls = dec === "PROCEED" ? "proceed" : dec === "ESCALATE" ? "escalate" : "reject";
  const icon = dec === "PROCEED" ? "✅" : dec === "ESCALATE" ? "⚠️" : "🛑";
  const scoreColor = ev.overallScore >= 75 ? "var(--success)" : ev.overallScore >= 50 ? "var(--warning)" : "var(--danger)";

  // Score ring SVG
  const circumference = 2 * Math.PI * 34;
  const offset = circumference - (ev.overallScore / 100) * circumference;

  let html = `
    <div class="result-header">
      ${createTrafficLight(dec)}
      <div style="flex:1;">
        <div class="result-decision ${cls}">${icon} ${dec}</div>
        <div style="color:var(--text-secondary);font-size:0.88rem;margin-top:0.3rem;">
          <strong>${ev.entityName}</strong> — ${result.entityType || "site"} — ${ev.overallCompliance}
        </div>
        <div style="color:var(--text-muted);font-size:0.78rem;margin-top:0.15rem;">
          Request ID: ${result.requestId} | ${new Date(result.timestamp).toLocaleString("it-IT")}
        </div>
      </div>
      <div class="score-ring">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle class="track" cx="40" cy="40" r="34"/>
          <circle class="fill" cx="40" cy="40" r="34" stroke="${scoreColor}"
            stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"/>
        </svg>
        <div class="score-label" style="color:${scoreColor}">${ev.overallScore}</div>
      </div>
    </div>
  `;

  // Policy breakdown
  html += `<h3 style="font-size:0.95rem;margin-bottom:0.75rem;">Dettaglio per Policy</h3>`;
  html += `<div class="policy-grid">`;
  for (const [cat, pol] of Object.entries(ev.evaluations)) {
    const polColor = pol.score >= 75 ? "var(--success)" : pol.score >= 50 ? "var(--warning)" : "var(--danger)";
    html += `
      <div class="policy-card">
        <div class="policy-card-header">
          <h3>${pol.policyName}</h3>
          <span class="policy-score" style="color:${polColor}">${pol.score}</span>
        </div>
        <div style="margin-bottom:0.5rem;">
          <span class="badge ${pol.compliance === 'COMPLIANT' ? 'badge-safe' : pol.compliance === 'PARTIALLY_COMPLIANT' ? 'badge-warn' : 'badge-danger'}">
            ${pol.compliance}
          </span>
        </div>
        ${pol.ruleResults.map(r => `
          <div class="rule-item">
            <span class="rule-icon">${r.passed ? "✅" : "❌"}</span>
            <span class="rule-name">${r.ruleName}</span>
          </div>
        `).join("")}
      </div>
    `;
  }
  html += `</div>`;

  // Rationale
  html += `<h3 style="font-size:0.95rem;margin:1rem 0 0.5rem;">Rationale</h3>`;
  html += `<div class="rationale-list">`;
  for (const r of ev.rationale) {
    const severity = r.severity || "positive";
    const sevClass = severity === "critical" || severity === "high" ? "" : severity === "medium" || severity === "low" ? severity : "positive";
    html += `
      <div class="rationale-item ${sevClass}">
        <div class="rationale-header">
          <strong>${r.ruleName || "Tutte le policy"}</strong>
          ${r.severity ? `<span class="badge badge-${r.severity === 'critical' || r.severity === 'high' ? 'danger' : 'warn'}">${r.severity}</span>` : ""}
        </div>
        <div style="color:var(--text-secondary);font-size:0.82rem;">${r.message}</div>
      </div>
    `;
  }
  html += `</div>`;

  return html;
}

// ---------- Audit Trail ----------

function setAuditDateToday() {
  document.getElementById("audit-date").value = new Date().toISOString().slice(0, 10);
}

async function loadAudit() {
  const date = document.getElementById("audit-date").value;
  const container = document.getElementById("audit-results");
  container.innerHTML = '<div class="loading-placeholder"><span class="spinner"></span></div>';

  try {
    const r = await fetchJSON(`${EAAS}/api/audit?date=${date}`);
    if (!r.records || r.records.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>Nessun record di audit per questa data</p></div>';
      return;
    }
    container.innerHTML = `
      <div class="audit-table-wrap">
        <table class="audit-table">
          <thead>
            <tr>
              <th>Ora</th>
              <th>Azione</th>
              <th>Entità</th>
              <th>Utente</th>
              <th>Score</th>
              <th>Decisione</th>
              <th>Violazioni</th>
            </tr>
          </thead>
          <tbody>
            ${r.records.map(rec => `
              <tr>
                <td>${rec.timestamp ? new Date(rec.timestamp).toLocaleTimeString("it-IT") : "–"}</td>
                <td><span class="badge badge-info">${rec.action}</span></td>
                <td>${rec.entityName || rec.entityId || "batch"}</td>
                <td>${rec.requestedBy}</td>
                <td>${rec.overallScore !== undefined ? `<strong>${rec.overallScore}</strong>` : "–"}</td>
                <td>${rec.decision ? `<span class="decision-badge ${rec.decision.toLowerCase()}">${rec.decision}</span>` : rec.overallCompliance || "–"}</td>
                <td>${rec.violationsCount !== undefined ? rec.violationsCount : (rec.criticalViolationsCount !== undefined ? rec.criticalViolationsCount : "–")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Errore: ${err.message}</p></div>`;
  }
}
window.loadAudit = loadAudit;

// ---------- Utilities ----------

function createTrafficLight(decision) {
  const g = decision === "PROCEED" ? "active-green" : "";
  const y = decision === "ESCALATE" ? "active-yellow" : "";
  const r = decision === "REJECT" ? "active-red" : "";
  return `
    <div class="traffic-light">
      <div class="light ${r}"></div>
      <div class="light ${y}"></div>
      <div class="light ${g}"></div>
    </div>
  `;
}

function typeIcon(tipo) {
  if (!tipo) return "📍";
  const t = tipo.toLowerCase();
  if (t.includes("natural")) return "🌿";
  if (t.includes("historical")) return "🏛️";
  if (t.includes("hiking")) return "🥾";
  if (t.includes("event")) return "🎭";
  if (t.includes("producer")) return "🏪";
  return "📍";
}

function cleanLang(str) {
  if (!str) return "";
  return str.replace(/@it$/, "").replace(/^"|"$/g, "");
}

function riskBadge(risk) {
  if (!risk) return "";
  const r = risk.toLowerCase();
  if (r === "critico") return '<span class="badge badge-danger">⚠️ Critico</span>';
  if (r === "alto") return '<span class="badge badge-danger">Rischio alto</span>';
  if (r === "medio") return '<span class="badge badge-warn">Rischio medio</span>';
  return '<span class="badge badge-safe">Rischio basso</span>';
}

function accessBadge(access) {
  if (!access) return "";
  const a = access.toLowerCase();
  if (a === "completa") return '<span class="badge badge-safe">♿ Completa</span>';
  if (a === "parziale") return '<span class="badge badge-warn">♿ Parziale</span>';
  return '<span class="badge badge-danger">♿ Assente</span>';
}

function errorMsg(err) {
  return `<div class="empty-state"><div class="empty-icon">❌</div><p>Errore di connessione: ${err.message}</p><p><small>Verifica che il DaaS sia in esecuzione su ${DAAS}</small></p></div>`;
}

// ---------- Init ----------

document.addEventListener("DOMContentLoaded", () => {
  checkServices();
  loadDashboard();
  setInterval(checkServices, 15000);
});
