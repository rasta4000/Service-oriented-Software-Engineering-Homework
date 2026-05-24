// ============================================================================
// eaas-server.js – EaaS (Ethical as a Service) Microservizio
// Servizio indipendente che riceve richieste dal client, interroga il DaaS,
// applica le policy etiche definite nei file JSON esterni, genera un rationale
// e scrive un audit trail su file di log.
// ============================================================================

const express = require("express");
const cors    = require("cors");
const fs      = require("fs");
const path    = require("path");

// ---------- Configurazione ----------
const EAAS_PORT = process.env.EAAS_PORT || 4000;
const DAAS_BASE = process.env.DAAS_BASE || "http://localhost:3000";

// ---------- Caricamento delle Policy JSON ----------
const POLICIES_DIR = path.join(__dirname, "policies");

/**
 * Carica tutte le policy JSON dalla directory policies/.
 * Restituisce un oggetto { category: policyObject }.
 */
function loadPolicies() {
  const policies = {};
  const files = fs.readdirSync(POLICIES_DIR).filter(f => f.endsWith(".json"));

  for (const file of files) {
    const filePath = path.join(POLICIES_DIR, file);
    const policy = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    policies[policy.category] = policy;
    console.log(`[EaaS] Policy caricata: ${policy.name} (${policy.policyId})`);
  }

  return policies;
}

const policies = loadPolicies();

// ---------- Audit Trail ----------
const AUDIT_DIR = path.join(__dirname, "audit");
if (!fs.existsSync(AUDIT_DIR)) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
}

/**
 * Scrive un record di audit trail su file JSON (append).
 * Ogni file di audit è giornaliero: audit-YYYY-MM-DD.json
 */
function writeAuditLog(auditRecord) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const auditFile = path.join(AUDIT_DIR, `audit-${today}.json`);

  let existingRecords = [];
  if (fs.existsSync(auditFile)) {
    try {
      existingRecords = JSON.parse(fs.readFileSync(auditFile, "utf-8"));
    } catch {
      existingRecords = [];
    }
  }

  existingRecords.push(auditRecord);
  fs.writeFileSync(auditFile, JSON.stringify(existingRecords, null, 2), "utf-8");

  console.log(`[Audit] Record scritto in ${auditFile}`);
}

// ---------- Policy Evaluation Engine ----------

/**
 * Valuta una singola regola su un dato entità (un sito/trail/event/producer).
 * Restituisce un oggetto con: ruleId, passed (bool), message, details.
 */
function evaluateRule(rule, entity) {
  const result = {
    ruleId: rule.ruleId,
    ruleName: rule.name,
    severity: rule.severity,
    passed: true,
    message: null,
    details: {}
  };

  const value = entity[rule.field];
  const relatedValue = rule.relatedField ? entity[rule.relatedField] : undefined;

  switch (rule.condition) {

    // Verifica che il rapporto tra field e relatedField sia >= threshold
    case "ratio_min": {
      if (value !== undefined && relatedValue !== undefined) {
        const num = Number(value);
        const den = Number(relatedValue);
        if (den > 0) {
          const ratio = num / den;
          // Se il rapporto è troppo basso → potenziale de-anonimizzazione
          if (ratio < 1 && num < rule.threshold) {
            result.passed = false;
            result.details = { value: num, relatedValue: den, computedRatio: num };
          }
        }
      }
      break;
    }

    // Verifica che il rapporto field/relatedField non superi threshold
    case "ratio_max": {
      if (value !== undefined && relatedValue !== undefined) {
        const num = Number(value);
        const den = Number(relatedValue);
        if (den > 0) {
          const ratio = num / den;
          if (ratio > rule.threshold) {
            result.passed = false;
            result.details = { value: num, relatedValue: den, ratio: ratio.toFixed(2) };
          }
        }
      }
      break;
    }

    // Verifica uguaglianza
    case "equals": {
      if (value !== undefined) {
        const match = String(value).toLowerCase() === String(rule.threshold).toLowerCase();
        if (match) {
          result.passed = false;
          result.details = { value };
        }
      }
      break;
    }

    // Verifica disuguaglianza
    case "not_equals": {
      if (value !== undefined) {
        const match = String(value).toLowerCase() !== String(rule.threshold).toLowerCase();
        if (match) {
          result.passed = false;
          result.details = { value };
        }
      }
      break;
    }

    // Verifica appartenenza a un insieme
    case "in": {
      if (value !== undefined && Array.isArray(rule.threshold)) {
        const valLower = String(value).toLowerCase();
        const inSet = rule.threshold.map(t => String(t).toLowerCase()).includes(valLower);

        if (rule.favorCondition) {
          // In questo caso, il match è POSITIVO (es. micro/piccolo è buono)
          result.passed = true; // favorevole
          if (!inSet) {
            result.passed = false;
            result.details = { value, expectedOneOf: rule.threshold };
          }
        } else {
          if (inSet) {
            result.passed = false;
            result.details = { value, matchedIn: rule.threshold };
          }
        }
      }
      break;
    }

    // Verifica che visitatori non superino la capacità (ratio > threshold)
    case "exceeds": {
      if (value !== undefined && relatedValue !== undefined) {
        const num = Number(value);
        const den = Number(relatedValue);
        if (den > 0 && (num / den) > rule.threshold) {
          result.passed = false;
          result.details = {
            visitatori: num,
            capacita: den,
            ratio: (num / den).toFixed(2)
          };
        }
      }
      break;
    }

    // Rischio combinato: areaProtetta=true E rischioSovraffollamento non basso
    case "combined_risk": {
      const fieldMatch = value !== undefined &&
        String(value).toLowerCase() === String(rule.thresholdField1).toLowerCase();
      const relatedMatch = relatedValue !== undefined &&
        Array.isArray(rule.thresholdField2) &&
        rule.thresholdField2.map(t => t.toLowerCase()).includes(String(relatedValue).toLowerCase());

      if (fieldMatch && relatedMatch) {
        result.passed = false;
        result.details = {
          [rule.field]: value,
          [rule.relatedField]: relatedValue
        };
      }
      break;
    }

    // Distribuzione – applicata a livello aggregato, skip per entità singola
    case "distribution_check": {
      // Questo check viene gestito a livello aggregato
      result.passed = true;
      result.details = { note: "Valutato a livello aggregato" };
      break;
    }

    default:
      result.details = { warning: `Condizione '${rule.condition}' non implementata` };
  }

  if (!result.passed) {
    result.message = rule.violationMessage;
  }

  return result;
}

/**
 * Valuta tutte le policy su una singola entità.
 * Restituisce un report con punteggio per ogni policy e un rationale.
 */
function evaluateEntity(entity, allPolicies) {
  const report = {
    entityId: entity.id || entity.uri || "unknown",
    entityName: entity.nome || entity.name || "N/D",
    evaluations: {},
    overallScore: 0,
    overallCompliance: "",
    rationale: []
  };

  let totalWeight = 0;
  let weightedScore = 0;

  for (const [category, policy] of Object.entries(allPolicies)) {
    const policyResult = {
      policyId: policy.policyId,
      policyName: policy.name,
      category,
      ruleResults: [],
      score: 0,
      compliance: ""
    };

    let policyScore = 0;
    let ruleCount = 0;

    for (const rule of policy.rules) {
      const ruleResult = evaluateRule(rule, entity);
      policyResult.ruleResults.push(ruleResult);

      // Calcola il peso della regola
      const weight = policy.scoringWeights[rule.ruleId] || 0;
      if (ruleResult.passed) {
        policyScore += weight * 100;
      }
      ruleCount++;

      // Aggiungi al rationale se violata
      if (!ruleResult.passed) {
        report.rationale.push({
          policy: category,
          rule: rule.ruleId,
          ruleName: rule.name,
          severity: rule.severity,
          message: ruleResult.message,
          details: ruleResult.details
        });
      }
    }

    // Normalizza il punteggio della policy
    policyResult.score = Math.round(policyScore);

    // Determina il livello di compliance
    const thresholds = policy.complianceThresholds;
    if (policyResult.score >= thresholds.compliant) {
      policyResult.compliance = "COMPLIANT";
    } else if (policyResult.score >= thresholds.partiallyCompliant) {
      policyResult.compliance = "PARTIALLY_COMPLIANT";
    } else {
      policyResult.compliance = "NON_COMPLIANT";
    }

    report.evaluations[category] = policyResult;

    // Contributo al punteggio complessivo (peso uguale per ogni policy)
    totalWeight++;
    weightedScore += policyResult.score;
  }

  // Punteggio complessivo (media delle policy)
  report.overallScore = totalWeight > 0
    ? Math.round(weightedScore / totalWeight)
    : 0;

  // Compliance complessiva
  if (report.overallScore >= 75) {
    report.overallCompliance = "COMPLIANT";
  } else if (report.overallScore >= 50) {
    report.overallCompliance = "PARTIALLY_COMPLIANT";
  } else {
    report.overallCompliance = "NON_COMPLIANT";
  }

  // Decisione etica finale (semaforo)
  if (report.overallCompliance === "COMPLIANT") {
    report.decision = "PROCEED";
  } else if (report.overallCompliance === "PARTIALLY_COMPLIANT") {
    report.decision = "ESCALATE";
  } else {
    report.decision = "REJECT";
  }

  // Aggiungi un rationale positivo se non ci sono violazioni
  if (report.rationale.length === 0) {
    report.rationale.push({
      policy: "all",
      message: "L'entità soddisfa tutte le policy etiche definite. Nessuna violazione rilevata."
    });
  }

  return report;
}

// ---------- Helper: chiamata al DaaS ----------

/**
 * Effettua una richiesta HTTP GET al DaaS e restituisce il JSON.
 * Usa il modulo nativo http per evitare dipendenze extra.
 */
async function fetchFromDaaS(endpoint) {
  const url = `${DAAS_BASE}${endpoint}`;
  console.log(`[EaaS] Fetching DaaS: ${url}`);

  // Usa fetch nativo (Node 18+)
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`DaaS responded with ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

// ---------- Configurazione Express ----------
const app = express();
app.use(cors());
app.use(express.json());

// ============================================================================
// ENDPOINT 1 – POST /api/evaluate/site/:id
// Riceve l'ID di un sito, lo recupera dal DaaS, applica tutte le policy,
// genera il rationale e scrive l'audit trail.
// ============================================================================
app.post("/api/evaluate/site/:id", async (req, res) => {
  const id = req.params.id;
  const requestedBy = req.body.requestedBy || "anonymous";
  const timestamp = new Date().toISOString();

  try {
    // 1. Recupera i dati dal DaaS
    const siteData = await fetchFromDaaS(`/api/poi/${id}`);

    // 2. Applica le policy
    const evaluation = evaluateEntity(siteData, policies);

    // 3. Costruisci la risposta completa
    const result = {
      requestId: `REQ-${Date.now()}`,
      timestamp,
      requestedBy,
      service: "EaaS – Ethical as a Service",
      entityType: "site",
      entityId: id,
      sourceData: siteData,
      evaluation
    };

    // 4. Scrivi l'audit trail
    writeAuditLog({
      requestId: result.requestId,
      timestamp,
      requestedBy,
      action: "EVALUATE_SITE",
      entityId: id,
      entityName: siteData.nome || id,
      overallScore: evaluation.overallScore,
      overallCompliance: evaluation.overallCompliance,
      decision: evaluation.decision,
      violationsCount: evaluation.rationale.filter(r => r.severity).length,
      policiesApplied: Object.keys(evaluation.evaluations),
      rationale: evaluation.rationale
    });

    res.json(result);
  } catch (err) {
    console.error(`[EaaS] Errore nella valutazione del sito ${id}:`, err.message);

    // Log anche gli errori nell'audit trail
    writeAuditLog({
      requestId: `REQ-${Date.now()}`,
      timestamp,
      requestedBy,
      action: "EVALUATE_SITE",
      entityId: id,
      status: "ERROR",
      error: err.message
    });

    res.status(502).json({
      error: "Impossibile completare la valutazione etica",
      detail: err.message,
      suggestion: "Verificare che il DaaS sia in esecuzione su " + DAAS_BASE
    });
  }
});

// ============================================================================
// ENDPOINT 2 – POST /api/evaluate/trail/:id
// Valuta un percorso escursionistico con tutte le policy.
// ============================================================================
app.post("/api/evaluate/trail/:id", async (req, res) => {
  const id = req.params.id;
  const requestedBy = req.body.requestedBy || "anonymous";
  const timestamp = new Date().toISOString();

  try {
    // Recupera i dati dal DaaS (usa l'endpoint POI generico)
    const trailData = await fetchFromDaaS(`/api/poi/${id}`);

    const evaluation = evaluateEntity(trailData, policies);

    const result = {
      requestId: `REQ-${Date.now()}`,
      timestamp,
      requestedBy,
      service: "EaaS – Ethical as a Service",
      entityType: "trail",
      entityId: id,
      sourceData: trailData,
      evaluation
    };

    writeAuditLog({
      requestId: result.requestId,
      timestamp,
      requestedBy,
      action: "EVALUATE_TRAIL",
      entityId: id,
      entityName: trailData.nome || id,
      overallScore: evaluation.overallScore,
      overallCompliance: evaluation.overallCompliance,
      violationsCount: evaluation.rationale.filter(r => r.severity).length,
      policiesApplied: Object.keys(evaluation.evaluations)
    });

    res.json(result);
  } catch (err) {
    console.error(`[EaaS] Errore nella valutazione del trail ${id}:`, err.message);

    writeAuditLog({
      requestId: `REQ-${Date.now()}`,
      timestamp,
      requestedBy,
      action: "EVALUATE_TRAIL",
      entityId: id,
      status: "ERROR",
      error: err.message
    });

    res.status(502).json({
      error: "Impossibile completare la valutazione etica del percorso",
      detail: err.message,
      suggestion: "Verificare che il DaaS sia in esecuzione su " + DAAS_BASE
    });
  }
});

// ============================================================================
// ENDPOINT 3 – POST /api/evaluate/batch
// Valuta in batch tutti i siti a rischio dal DaaS e produce un report aggregato.
// ============================================================================
app.post("/api/evaluate/batch", async (req, res) => {
  const requestedBy = req.body.requestedBy || "anonymous";
  const timestamp = new Date().toISOString();

  try {
    // Recupera tutti i siti a rischio dal DaaS
    const riskySites = await fetchFromDaaS("/api/sites/risky");
    const sites = riskySites.data || [];

    const evaluations = [];
    const summary = {
      total: sites.length,
      compliant: 0,
      partiallyCompliant: 0,
      nonCompliant: 0,
      criticalViolations: []
    };

    for (const site of sites) {
      // Normalizza i nomi dei campi dal DaaS (risky endpoint usa nomi abbreviati)
      const normalized = {
        ...site,
        rischioSovraffollamento: site.rischio || site.rischioSovraffollamento,
        capacitaMassima: site.capacita || site.capacitaMassima,
        visitatoriMediGiornalieri: site.visitatori || site.visitatoriMediGiornalieri,
        accessibilitaDisabili: site.accessibilita || site.accessibilitaDisabili,
        sensibilitaAmbientale: site.sensibilita || site.sensibilitaAmbientale
      };
      const evaluation = evaluateEntity(normalized, policies);
      evaluations.push({
        entityId: site.id,
        entityName: site.nome,
        entityType: site.tipo,
        ...evaluation
      });

      // Aggiorna il sommario
      if (evaluation.overallCompliance === "COMPLIANT") summary.compliant++;
      else if (evaluation.overallCompliance === "PARTIALLY_COMPLIANT") summary.partiallyCompliant++;
      else summary.nonCompliant++;

      // Raccogli le violazioni critiche
      const criticals = evaluation.rationale.filter(r => r.severity === "critical");
      for (const c of criticals) {
        summary.criticalViolations.push({
          entity: site.nome || site.id,
          ...c
        });
      }
    }

    const result = {
      requestId: `REQ-${Date.now()}`,
      timestamp,
      requestedBy,
      service: "EaaS – Ethical as a Service",
      evaluationType: "batch",
      summary,
      evaluations
    };

    // Audit trail per la valutazione batch
    writeAuditLog({
      requestId: result.requestId,
      timestamp,
      requestedBy,
      action: "EVALUATE_BATCH",
      totalEvaluated: summary.total,
      compliant: summary.compliant,
      partiallyCompliant: summary.partiallyCompliant,
      nonCompliant: summary.nonCompliant,
      criticalViolationsCount: summary.criticalViolations.length
    });

    res.json(result);
  } catch (err) {
    console.error("[EaaS] Errore nella valutazione batch:", err.message);

    writeAuditLog({
      requestId: `REQ-${Date.now()}`,
      timestamp,
      requestedBy,
      action: "EVALUATE_BATCH",
      status: "ERROR",
      error: err.message
    });

    res.status(502).json({
      error: "Impossibile completare la valutazione batch",
      detail: err.message,
      suggestion: "Verificare che il DaaS sia in esecuzione su " + DAAS_BASE
    });
  }
});

// ============================================================================
// ENDPOINT 4 – GET /api/policies
// Restituisce l'elenco delle policy caricate con le relative regole.
// ============================================================================
app.get("/api/policies", (req, res) => {
  const policySummary = {};

  for (const [category, policy] of Object.entries(policies)) {
    policySummary[category] = {
      policyId: policy.policyId,
      name: policy.name,
      version: policy.version,
      description: policy.description,
      rulesCount: policy.rules.length,
      rules: policy.rules.map(r => ({
        ruleId: r.ruleId,
        name: r.name,
        description: r.description,
        severity: r.severity
      })),
      complianceThresholds: policy.complianceThresholds
    };
  }

  res.json({
    service: "EaaS – Ethical as a Service",
    policiesLoaded: Object.keys(policySummary).length,
    policies: policySummary
  });
});

// ============================================================================
// ENDPOINT 5 – GET /api/audit
// Restituisce il log di audit trail del giorno corrente.
// Parametro opzionale ?date=YYYY-MM-DD per un giorno specifico.
// ============================================================================
app.get("/api/audit", (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const auditFile = path.join(AUDIT_DIR, `audit-${date}.json`);

  if (!fs.existsSync(auditFile)) {
    return res.json({
      date,
      message: "Nessun record di audit trovato per questa data.",
      records: []
    });
  }

  try {
    const records = JSON.parse(fs.readFileSync(auditFile, "utf-8"));
    res.json({
      date,
      totalRecords: records.length,
      records
    });
  } catch (err) {
    res.status(500).json({ error: "Errore nella lettura del file di audit", detail: err.message });
  }
});

// ============================================================================
// Endpoint radice – documentazione degli endpoint disponibili
// ============================================================================
app.get("/", (req, res) => {
  res.json({
    service: "EaaS – Ethical as a Service",
    version: "1.0.0",
    description: "Microservizio indipendente per la valutazione etica del turismo sostenibile. " +
      "Applica policy di privacy, equità distributiva e rischio ambientale/sanitario ai dati " +
      "provenienti dal DaaS, genera un rationale e mantiene un audit trail completo.",
    daasConnection: DAAS_BASE,
    endpoints: [
      {
        method: "POST",
        path: "/api/evaluate/site/:id",
        description: "Valuta un sito (POI) applicando tutte le policy etiche. Body opzionale: { requestedBy: 'nome' }",
        example: "POST /api/evaluate/site/GranSasso"
      },
      {
        method: "POST",
        path: "/api/evaluate/trail/:id",
        description: "Valuta un percorso escursionistico. Body opzionale: { requestedBy: 'nome' }",
        example: "POST /api/evaluate/trail/SentieroDelloSpirito"
      },
      {
        method: "POST",
        path: "/api/evaluate/batch",
        description: "Valuta in batch tutti i siti a rischio e produce un report aggregato con sommario",
        example: "POST /api/evaluate/batch"
      },
      {
        method: "GET",
        path: "/api/policies",
        description: "Elenco delle policy caricate con regole e soglie di compliance"
      },
      {
        method: "GET",
        path: "/api/audit?date=YYYY-MM-DD",
        description: "Consulta l'audit trail. Senza parametro date restituisce il log odierno"
      }
    ]
  });
});

// ---------- Avvio del server ----------
app.listen(EAAS_PORT, () => {
  console.log(`\n🛡️   EaaS server in ascolto su http://localhost:${EAAS_PORT}`);
  console.log(`📖  Documentazione API:  http://localhost:${EAAS_PORT}/`);
  console.log(`🔗  Connesso al DaaS:    ${DAAS_BASE}`);
  console.log(`📁  Policy caricate:     ${Object.keys(policies).length}`);
  console.log(`📝  Audit trail dir:     ${AUDIT_DIR}\n`);
});
