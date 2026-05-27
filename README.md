# 🏔️ Turismo Etico Abruzzo – DaaS + EaaS

Applicazione service-oriented per il **turismo sostenibile in Abruzzo** che integra:

- **DaaS (Data as a Service)** – espone un dataset RDF di punti di interesse, sentieri, eventi e produttori locali abruzzesi tramite REST API + SPARQL
- **EaaS (Ethics as a Service)** – valuta ogni operazione turistica applicando policy etiche esterne (privacy, equità, rischio ambientale), producendo una decisione tracciabile (PROCEED / REVISE / ESCALATE / REJECT)
- **Client Web** – dashboard interattiva per esplorare i dati e sottoporre siti a valutazione etica

## Architettura

```
┌────────────────┐     fetch()     ┌────────────────┐
│   Client Web   │ ──────────────► │   DaaS Server  │
│  (public/)     │                 │   :3000        │
│  HTML/CSS/JS   │ ──────────────► │  RDF + SPARQL  │
└────────────────┘     fetch()     └────────────────┘
        │                                  ▲
        │ POST /evaluate                   │ GET /api/poi/:id
        ▼                                  │
┌────────────────┐     fetch()     ────────┘
│   EaaS Server  │ ──────────────►
│   :4000        │
│  Policy Engine │
│  Audit Trail   │
└────────────────┘
```

## Prerequisiti

- **Node.js** ≥ 18 (per supporto `fetch` nativo)
- **npm**

## Installazione

```bash
# 1. Clona il repository
git clone https://github.com/rasta4000/Service-oriented-Software-Engineering-Homework.git
cd Service-oriented-Software-Engineering-Homework

# 2. Installa dipendenze DaaS (root)
npm install

# 3. Installa dipendenze EaaS
cd eaas
npm install
cd ..
```

## Avvio

Servono **due terminali** (o usa `&` per il background):

```bash
# Terminale 1 – DaaS (porta 3000)
npm start

# Terminale 2 – EaaS (porta 4000)
cd eaas
npm start
```

Il client web è servito automaticamente dal DaaS su **http://localhost:3000** (directory `public/`).

## Endpoint DaaS (porta 3000)

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/api/poi/:id` | Singolo punto di interesse per ID (es. `GranSasso`) |
| GET | `/api/poi/provincia/:prov` | Tutti i POI di una provincia (es. `L'Aquila`) |
| GET | `/api/trails?difficulty=` | Sentieri, filtrabili per difficoltà (`T`, `E`, `EE`, `EEA`) |
| GET | `/api/events` | Tutti gli eventi locali con date e location |
| GET | `/api/sites/risky` | Siti a rischio sovraffollamento (query multi-condizione) |
| GET | `/api/search?q=` | Ricerca full-text su nome e descrizione |

## Endpoint EaaS (porta 4000)

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| POST | `/api/evaluate/site/:id` | Valuta un sito applicando tutte le policy etiche |
| POST | `/api/evaluate/trail/:id` | Valuta un sentiero |
| POST | `/api/evaluate/batch` | Valutazione batch di tutti i siti a rischio |
| GET | `/api/policies` | Elenco delle policy caricate con regole |
| GET | `/api/audit?date=YYYY-MM-DD` | Consulta l'audit trail |

**Body opzionale** per gli endpoint POST:
```json
{ "requestedBy": "nome-utente" }
```

## Dataset RDF

Il file `data.ttl` contiene un'ontologia e istanze per il dominio del turismo abruzzese:

- **Classi**: `PointOfInterest`, `NaturalSite`, `HistoricalSite`, `HikingTrail`, `LocalEvent`, `LocalProducer`
- **Relazioni**: `passesThrough`, `producerNear`, `eventLocation`
- **Proprietà etiche**: `rischioSovraffollamento`, `capacitaMassima`, `accessibilitaDisabili`, `sensibilitaAmbientale`, `areaProtetta`

## Policy Etiche (3 file JSON)

| Policy | File | Regole |
|--------|------|--------|
| Privacy e GDPR | `eaas/policies/privacy-policy.json` | Anonimizzazione, geolocalizzazione, minimizzazione dati |
| Equità Distributiva | `eaas/policies/fairness-policy.json` | Concentrazione flussi, tutela micro-operatori, accessibilità |
| Rischio Ambientale | `eaas/policies/environmental-risk-policy.json` | Sovraffollamento, capacità di carico, ecosistemi sensibili |

## Struttura Output EaaS

L'output della valutazione etica è separato in due sezioni:

- **`caseAnalysis`** – analisi tecnica oggettiva: score per ogni policy, regole valutate, violazioni
- **`governanceDecision`** – decisione finale: `PROCEED` / `REVISE` / `ESCALATE` / `REJECT`, rationale, `requiredActions`

## Scenari di Test

### Scenario Virtuoso → PROCEED
```bash
curl -X POST http://localhost:4000/api/evaluate/site/CattedraleSanBerardo \
  -H "Content-Type: application/json" \
  -d '{"requestedBy": "demo"}'
```
**Risultato atteso**: `decision: "PROCEED"` – sito con basso rischio, accessibilità completa, non in area protetta.

### Scenario Critico → REJECT
```bash
curl -X POST http://localhost:4000/api/evaluate/site/RoccaCalascio \
  -H "Content-Type: application/json" \
  -d '{"requestedBy": "demo"}'
```
**Risultato atteso**: `decision: "REJECT"` – area protetta, rischio critico, visitatori > capacità, accessibilità assente.

## Demo

1. Avvia entrambi i server (vedi sopra)
2. Apri **http://localhost:3000** nel browser
3. Usa la **Dashboard** per gli scenari rapidi
4. Vai su **Esplora Dati** per interrogare il DaaS
5. Vai su **Valutazione** per sottoporre un sito all'EaaS
6. Vai su **Scenari Test** per i due scenari obbligatori (PROCEED + REJECT)
7. Vai su **Audit Trail** per consultare il log delle valutazioni

## Struttura del Progetto

```
├── server.js              # DaaS server (Express + Oxigraph)
├── data.ttl               # Dataset RDF (Turtle)
├── package.json           # Dipendenze DaaS
├── public/                # Client web
│   ├── index.html         # Dashboard HTML
│   ├── styles.css         # Stili CSS
│   └── app.js             # Logica frontend
├── eaas/                  # Microservizio EaaS
│   ├── eaas-server.js     # Server EaaS (Express)
│   ├── package.json       # Dipendenze EaaS
│   ├── policies/          # Policy etiche JSON
│   │   ├── privacy-policy.json
│   │   ├── fairness-policy.json
│   │   └── environmental-risk-policy.json
│   └── audit/             # Audit trail (file giornalieri)
└── README.md
```