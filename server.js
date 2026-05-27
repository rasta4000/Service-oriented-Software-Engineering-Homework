// ============================================================================
// server.js – DaaS (Data as a Service) REST API
// Carica il dataset RDF (data.ttl) e lo interroga con query SPARQL,
// esponendo i risultati come JSON tramite endpoint REST (Express).
// ============================================================================

const express = require("express");       // framework REST
const cors    = require("cors");          // abilita richieste cross-origin
const oxigraph = require("oxigraph");     // triplestore RDF con supporto SPARQL
const fs      = require("fs");            // lettura file
const path    = require("path");          // gestione percorsi

// ---------- Inizializzazione dello store RDF ----------
const store = new oxigraph.Store();

// Legge il file Turtle e lo carica nello store in-memory
const ttlPath  = path.join(__dirname, "data.ttl");
const ttlData  = fs.readFileSync(ttlPath, "utf-8");
store.load(ttlData, { format: "text/turtle" });

console.log(`[RDF] Caricati ${store.size} triple dallo store.`);

// ---------- Helper: esegue una query SPARQL e restituisce un array di oggetti ----------
/**
 * Esegue una query SPARQL SELECT sullo store e restituisce
 * un array di oggetti JS "piatti" (chiave → valore stringa).
 *
 * Ogni riga del result-set SPARQL è una Map<string, Term>;
 * questa funzione converte ogni Term nel suo valore leggibile.
 */
function sparqlQuery(query) {
  const results = store.query(query);       // restituisce un iterabile di Map
  const rows = [];

  for (const binding of results) {
    const row = {};
    for (const [key, term] of binding) {
      // term può essere un NamedNode, Literal o BlankNode
      row[key] = term.value;                // .value restituisce la stringa grezza
    }
    rows.push(row);
  }
  return rows;
}

// ---------- Configurazione Express ----------
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());            // permette chiamate da qualsiasi origine
app.use(express.json());    // parsing body JSON per eventuali POST
app.use(express.static(path.join(__dirname, "public"))); // serve il frontend

// Prefissi SPARQL comuni (riutilizzati in ogni query)
const PREFIXES = `
  PREFIX ex:   <http://example.org/tourism#>
  PREFIX rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
  PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  PREFIX xsd:  <http://www.w3.org/2001/XMLSchema#>
  PREFIX geo:  <http://www.w3.org/2003/01/geo/wgs84_pos#>
`;

// ============================================================================
// ENDPOINT 1 – GET /api/poi/:id
// Restituisce un singolo Punto di Interesse identificato dal suo localname
// (es. /api/poi/GranSasso)
// Query SPARQL: cerca il soggetto ex:<id> e ne estrae tutte le proprietà.
// ============================================================================
app.get("/api/poi/:id", (req, res) => {
  const id = req.params.id;                          // es. "GranSasso"
  const uri = `http://example.org/tourism#${id}`;    // ricostruisce l'URI completo

  const query = `${PREFIXES}
    SELECT ?prop ?value
    WHERE {
      <${uri}> ?prop ?value .
    }
  `;

  const rows = sparqlQuery(query);

  if (rows.length === 0) {
    return res.status(404).json({ error: "Punto di interesse non trovato", id });
  }

  // Converte le coppie proprietà-valore in un unico oggetto
  const poi = { id, uri };
  for (const row of rows) {
    // Usa solo il localname della proprietà come chiave JSON
    const propName = row.prop.split("#").pop() || row.prop.split("/").pop();
    poi[propName] = row.value;
  }

  res.json(poi);
});

// ============================================================================
// ENDPOINT 2 – GET /api/poi/provincia/:provincia
// Restituisce tutti i PointOfInterest (e sotto-classi) di una data provincia.
// Query SPARQL: usa rdfs:subClassOf per includere NaturalSite e HistoricalSite,
// filtra per ex:provincia con FILTER + LCASE per match case-insensitive.
// ============================================================================
app.get("/api/poi/provincia/:provincia", (req, res) => {
  const prov = req.params.provincia;

  const query = `${PREFIXES}
    SELECT ?id ?nome ?tipo ?comune ?rischio ?accessibilita
    WHERE {
      ?id rdf:type ?tipo .

      # Seleziona sia PointOfInterest che le sue sotto-classi
      FILTER (?tipo IN (ex:PointOfInterest, ex:NaturalSite, ex:HistoricalSite))

      ?id ex:nome       ?nome .
      ?id ex:provincia  ?prov .
      ?id ex:comune     ?comune .

      OPTIONAL { ?id ex:rischioSovraffollamento ?rischio }
      OPTIONAL { ?id ex:accessibilitaDisabili   ?accessibilita }

      # Confronto case-insensitive sulla provincia
      FILTER (LCASE(?prov) = LCASE("${prov}"))
    }
    ORDER BY ?nome
  `;

  const rows = sparqlQuery(query);
  // Estrai il localname dall'URI
  const result = rows.map(r => ({
    ...r,
    id: r.id.split("#").pop(),
    tipo: r.tipo.split("#").pop()
  }));

  res.json({ provincia: prov, count: result.length, data: result });
});

// ============================================================================
// ENDPOINT 3 – GET /api/trails?difficulty=EE
// Restituisce tutti i percorsi escursionistici (HikingTrail).
// Filtro opzionale per difficoltà (query-string "difficulty").
// Query SPARQL: seleziona le istanze di ex:HikingTrail con proprietà
// tecniche (lunghezza, dislivello, difficoltà) e info sul POI attraversato.
// ============================================================================
app.get("/api/trails", (req, res) => {
  const diff = req.query.difficulty;  // opzionale: T, E, EE, EEA

  let filterClause = "";
  if (diff) {
    filterClause = `FILTER (UCASE(?difficolta) = UCASE("${diff}"))`;
  }

  const query = `${PREFIXES}
    SELECT ?id ?nome ?comune ?lunghezzaKm ?dislivelloM ?difficolta
           ?rischio ?accessibilita ?poiAttraversato
    WHERE {
      ?id rdf:type ex:HikingTrail .
      ?id ex:nome          ?nome .
      ?id ex:comune        ?comune .
      ?id ex:lunghezzaKm   ?lunghezzaKm .
      ?id ex:dislivelloM   ?dislivelloM .
      ?id ex:difficolta    ?difficolta .

      OPTIONAL { ?id ex:rischioSovraffollamento ?rischio }
      OPTIONAL { ?id ex:accessibilitaDisabili   ?accessibilita }
      OPTIONAL { ?id ex:passesThrough           ?poiAttraversato }

      ${filterClause}
    }
    ORDER BY ?difficolta ?lunghezzaKm
  `;

  const rows = sparqlQuery(query);
  const result = rows.map(r => ({
    ...r,
    id: r.id.split("#").pop(),
    poiAttraversato: r.poiAttraversato ? r.poiAttraversato.split("#").pop() : null
  }));

  res.json({ count: result.length, filters: { difficulty: diff || "all" }, data: result });
});

// ============================================================================
// ENDPOINT 4 – GET /api/events
// Restituisce tutti gli eventi locali con le rispettive date e location.
// Query SPARQL: seleziona le istanze di ex:LocalEvent, con OPTIONAL
// per l'eventLocation (relazione con un altro POI).
// ============================================================================
app.get("/api/events", (req, res) => {
  const query = `${PREFIXES}
    SELECT ?id ?nome ?descrizione ?comune ?provincia
           ?dataInizio ?dataFine ?rischio ?accessibilita
           ?location ?locationNome
    WHERE {
      ?id rdf:type ex:LocalEvent .
      ?id ex:nome          ?nome .
      ?id ex:descrizione   ?descrizione .
      ?id ex:comune        ?comune .
      ?id ex:provincia     ?provincia .
      ?id ex:dataInizio    ?dataInizio .
      ?id ex:dataFine      ?dataFine .

      OPTIONAL { ?id ex:rischioSovraffollamento ?rischio }
      OPTIONAL { ?id ex:accessibilitaDisabili   ?accessibilita }

      # Segue la relazione eventLocation per ottenere il nome del POI collegato
      OPTIONAL {
        ?id ex:eventLocation ?location .
        ?location ex:nome    ?locationNome .
      }
    }
    ORDER BY ?dataInizio
  `;

  const rows = sparqlQuery(query);
  const result = rows.map(r => ({
    ...r,
    id: r.id.split("#").pop(),
    location: r.location ? r.location.split("#").pop() : null
  }));

  res.json({ count: result.length, data: result });
});

// ============================================================================
// ENDPOINT 5 – GET /api/sites/risky
// Query MULTI-CONDIZIONE: restituisce i siti a rischio sovraffollamento.
// Un sito è "a rischio" se:
//   - il suo rischioSovraffollamento è "alto" o "critico"  OPPURE
//   - i visitatori medi giornalieri superano la capacità massima.
// Combina più condizioni/relazioni (requisito homework).
// Include anche i produttori locali vicini al sito (join tra classi).
// ============================================================================
app.get("/api/sites/risky", (req, res) => {
  const query = `${PREFIXES}
    SELECT ?id ?nome ?tipo ?comune ?provincia
           ?rischio ?capacita ?visitatori ?accessibilita ?sensibilita
           ?produttoreVicino ?nomeProduttore
    WHERE {
      ?id rdf:type ?tipo .
      FILTER (?tipo IN (ex:NaturalSite, ex:HistoricalSite, ex:HikingTrail))

      ?id ex:nome                      ?nome .
      ?id ex:comune                    ?comune .
      ?id ex:provincia                 ?provincia .
      ?id ex:rischioSovraffollamento   ?rischio .

      OPTIONAL { ?id ex:capacitaMassima          ?capacita }
      OPTIONAL { ?id ex:visitatoriMediGiornalieri ?visitatori }
      OPTIONAL { ?id ex:accessibilitaDisabili     ?accessibilita }
      OPTIONAL { ?id ex:sensibilitaAmbientale     ?sensibilita }

      # Join opzionale: produttori locali vicini al sito a rischio
      OPTIONAL {
        ?produttoreVicino rdf:type ex:LocalProducer .
        ?produttoreVicino ex:producerNear ?id .
        ?produttoreVicino ex:nome ?nomeProduttore .
      }

      # CONDIZIONE MULTIPLA: rischio alto/critico OPPURE visitatori > capacità
      FILTER (
        ?rischio IN ("alto", "critico")
        ||
        (BOUND(?visitatori) && BOUND(?capacita) && ?visitatori > ?capacita)
      )
    }
    ORDER BY DESC(?rischio) ?nome
  `;

  const rows = sparqlQuery(query);
  const result = rows.map(r => ({
    ...r,
    id: r.id.split("#").pop(),
    tipo: r.tipo.split("#").pop(),
    produttoreVicino: r.produttoreVicino ? r.produttoreVicino.split("#").pop() : null,
    overCapacity: r.visitatori && r.capacita
      ? Number(r.visitatori) > Number(r.capacita)
      : false
  }));

  res.json({
    description: "Siti con rischio sovraffollamento alto/critico o visitatori oltre la capacità massima",
    count: result.length,
    data: result
  });
});

// ============================================================================
// ENDPOINT 6 – GET /api/search?q=...
// Ricerca full-text su nome e descrizione di tutte le risorse.
// Query SPARQL: usa FILTER + CONTAINS per match parziale case-insensitive.
// ============================================================================
app.get("/api/search", (req, res) => {
  const q = req.query.q;
  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: "Parametro di ricerca 'q' obbligatorio" });
  }

  // Sanitizzazione base contro SPARQL injection
  const sanitized = q.replace(/["\\<>{}]/g, "").trim();

  const query = `${PREFIXES}
    SELECT ?id ?nome ?tipo ?descrizione ?comune ?provincia
    WHERE {
      ?id ex:nome ?nome .
      ?id rdf:type ?tipo .
      OPTIONAL { ?id ex:descrizione ?descrizione }
      OPTIONAL { ?id ex:comune ?comune }
      OPTIONAL { ?id ex:provincia ?provincia }
      FILTER (
        CONTAINS(LCASE(STR(?nome)), LCASE("${sanitized}"))
        || (BOUND(?descrizione) && CONTAINS(LCASE(STR(?descrizione)), LCASE("${sanitized}")))
      )
    }
    ORDER BY ?nome
  `;

  const rows = sparqlQuery(query);
  const result = rows.map(r => ({
    ...r,
    id: r.id.split("#").pop(),
    tipo: r.tipo.split("#").pop()
  }));

  res.json({ query: q, count: result.length, data: result });
});

// ============================================================================
// Endpoint radice – documentazione degli endpoint disponibili
// ============================================================================
app.get("/", (req, res) => {
  res.json({
    service: "Turismo Sostenibile Abruzzo – DaaS API",
    version: "1.0.0",
    endpoints: [
      {
        method: "GET",
        path: "/api/poi/:id",
        description: "Restituisce un singolo punto di interesse per ID (es. GranSasso)"
      },
      {
        method: "GET",
        path: "/api/poi/provincia/:provincia",
        description: "Tutti i POI di una provincia (es. L'Aquila, Chieti, Teramo, Pescara)"
      },
      {
        method: "GET",
        path: "/api/trails?difficulty=",
        description: "Percorsi escursionistici, filtrabili per difficoltà (T, E, EE, EEA)"
      },
      {
        method: "GET",
        path: "/api/events",
        description: "Tutti gli eventi locali con date e location collegata"
      },
      {
        method: "GET",
        path: "/api/sites/risky",
        description: "Siti a rischio: sovraffollamento alto/critico o visitatori > capacità (query multi-condizione)"
      },
      {
        method: "GET",
        path: "/api/search?q=",
        description: "Ricerca full-text su nome e descrizione di tutte le risorse"
      }
    ]
  });
});

// ---------- Avvio del server ----------
app.listen(PORT, () => {
  console.log(`\n🚀  DaaS server in ascolto su http://localhost:${PORT}`);
  console.log(`📖  Documentazione API:  http://localhost:${PORT}/\n`);
});
