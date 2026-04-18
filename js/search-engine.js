/**
 * Search Engine - Handles semantic search with medical synonym expansion
 * and concept-based search with clinical phase grouping
 */
import { getIntentClassifier } from './intent-classifier.js';

export class SearchEngine {
  constructor(regionData) {
    this.scenarios = regionData.scenarios || [];
    this.regionName = regionData.region || null;
    this.embeddings = null;
    this.synonyms = null;
    this.normSynonyms = null;
    this.conceptIndex = null;
    this.normSynonymToConcept = null;
    this.intentClassifier = null;
    this.initialized = false;
  }

  // Normalize text for matching: lowercase, NFD-strip diacritics, hyphens/underscores/slashes -> space, collapse spaces.
  // Makes "Guillain-Barre" == "guillain barre" and lets fuzzy match work cross-form.
  _norm(s) {
    if (!s) return '';
    return String(s)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[-_/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Bounded Levenshtein. Returns Infinity if distance exceeds maxDist (early exit).
  _levenshtein(a, b, maxDist = 2) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > maxDist) return Infinity;
    if (la === 0) return lb;
    if (lb === 0) return la;
    let prev = new Array(lb + 1);
    let curr = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;
    for (let i = 1; i <= la; i++) {
      curr[0] = i;
      let rowMin = curr[0];
      const ai = a.charCodeAt(i - 1);
      for (let j = 1; j <= lb; j++) {
        const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
          prev[j - 1] + cost
        );
        if (curr[j] < rowMin) rowMin = curr[j];
      }
      if (rowMin > maxDist) return Infinity;
      [prev, curr] = [curr, prev];
    }
    return prev[lb];
  }

  // Suggest closest concept-index synonyms for a query that didn't resolve.
  // Conservative: only returns matches with edit distance <= 1, and only if the
  // normalized query is >= 6 chars (avoids false matches on short codes like "ms" / "ct").
  suggestSimilar(query, max = 3) {
    if (!this.normSynonymToConcept) return [];
    const q = this._norm(query);
    if (q.length < 6) return [];
    const hits = [];
    for (const term of Object.keys(this.normSynonymToConcept)) {
      if (Math.abs(term.length - q.length) > 1) continue;
      const d = this._levenshtein(q, term, 1);
      if (d <= 1 && d > 0) {
        hits.push({ term, conceptId: this.normSynonymToConcept[term], distance: d });
      }
    }
    hits.sort((a, b) => a.distance - b.distance || a.term.length - b.term.length);
    // De-duplicate by conceptId so we don't show 3 chips that all resolve to the same concept.
    const seen = new Set();
    const out = [];
    for (const h of hits) {
      if (seen.has(h.conceptId)) continue;
      seen.add(h.conceptId);
      out.push(h);
      if (out.length >= max) break;
    }
    return out;
  }

  async init() {
    // Load medical synonyms for query expansion
    await this.loadSynonyms();
    // Load concept index for concept-based search
    await this.loadConceptIndex();
    // Load intent classifier for query phase detection
    await this.loadIntentClassifier();
    this.buildIndex();
    this.initialized = true;
  }

  async loadIntentClassifier() {
    try {
      this.intentClassifier = await getIntentClassifier();
      console.log('[SearchEngine] Intent classifier loaded, ready:', this.intentClassifier.isReady());
    } catch (error) {
      console.warn('[SearchEngine] Could not load intent classifier:', error);
      this.intentClassifier = null;
    }
  }

  async loadConceptIndex() {
    try {
      const cacheBuster = '20260417a';
      const response = await fetch(`data/search/concept_index.json?v=${cacheBuster}`);
      if (response.ok) {
        this.conceptIndex = await response.json();
        // Pre-normalize synonym keys once at load so per-keystroke lookup is O(1)
        // and matches diacritic/hyphen variants without re-normalizing the index each time.
        this.normSynonymToConcept = {};
        const raw = this.conceptIndex.synonym_to_concept || {};
        for (const [term, conceptId] of Object.entries(raw)) {
          const k = this._norm(term);
          if (k) this.normSynonymToConcept[k] = conceptId;
        }
        console.log('[SearchEngine] Concept index loaded:', Object.keys(this.conceptIndex.concepts).length, 'concepts,', Object.keys(this.normSynonymToConcept).length, 'normalized synonyms');
      } else {
        console.warn('[SearchEngine] Failed to load concept index:', response.status);
      }
    } catch (error) {
      console.warn('[SearchEngine] Could not load concept index:', error);
      this.conceptIndex = null;
    }
  }

  async loadSynonyms() {
    try {
      // Cache buster to ensure fresh synonyms after updates
      const cacheBuster = '20260417a';
      const response = await fetch(`data/search/medical-synonyms.json?v=${cacheBuster}`);
      if (response.ok) {
        const data = await response.json();
        this.synonyms = data.synonyms || {};
        // Pre-normalize keys once so query-expansion lookup is normalization-aware.
        this.normSynonyms = {};
        for (const [term, list] of Object.entries(this.synonyms)) {
          const k = this._norm(term);
          if (k) this.normSynonyms[k] = list;
        }
      }
    } catch (error) {
      console.warn('Could not load medical synonyms:', error);
      this.synonyms = {};
      this.normSynonyms = {};
    }
  }

  buildIndex() {
    // Build inverted index for fast keyword search
    this.index = new Map();
    this.phraseIndex = new Map(); // For multi-word terms

    this.scenarios.forEach((scenario, idx) => {
      const text = this._norm(`${scenario.name} ${scenario.description || ''}`);
      const words = text.split(/\s+/).filter(w => w.length >= 2);

      // Index single words
      words.forEach(word => {
        if (!this.index.has(word)) {
          this.index.set(word, new Set());
        }
        this.index.get(word).add(idx);
      });

      // Index bigrams for phrase matching
      const nameNorm = this._norm(scenario.name);
      const nameWords = nameNorm.split(/\s+/).filter(w => w.length >= 2);
      for (let i = 0; i < nameWords.length - 1; i++) {
        const bigram = `${nameWords[i]} ${nameWords[i + 1]}`;
        if (!this.phraseIndex.has(bigram)) {
          this.phraseIndex.set(bigram, new Set());
        }
        this.phraseIndex.get(bigram).add(idx);
      }
    });
  }

  expandQuery(query) {
    // Expand query with medical synonyms (diacritic/hyphen-normalized)
    const queryNorm = this._norm(query);
    const expanded = new Set();

    // Add original terms
    const originalWords = queryNorm.split(/\s+/).filter(w => w.length >= 2);
    originalWords.forEach(w => expanded.add(w));

    // Use the pre-normalized synonyms map; fall back to raw if not built yet.
    const synMap = this.normSynonyms || this.synonyms;
    if (synMap) {
      // Try to find phrase matches first (e.g., "heart attack")
      for (const [term, synonymList] of Object.entries(synMap)) {
        if (queryNorm.includes(term)) {
          synonymList.forEach(syn => {
            this._norm(syn).split(/\s+/).forEach(w => { if (w) expanded.add(w); });
          });
        }
      }

      // Then expand individual words
      originalWords.forEach(word => {
        if (synMap[word]) {
          synMap[word].forEach(syn => {
            this._norm(syn).split(/\s+/).forEach(w => { if (w) expanded.add(w); });
          });
        }
      });
    }

    return Array.from(expanded);
  }

  /**
   * Main search method - tries concept search first, falls back to keyword
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @param {number} options.limit - Max results
   * @param {Object} options.filters - Active filters (phase, context, etc)
   * @returns {Object} - { scenarios, grouped, concept, isConceptSearch }
   */
  async search(query, options = {}) {
    const { limit = 20, filters = {} } = options;

    if (!this.initialized || this.scenarios.length === 0) {
      return { scenarios: [], grouped: null, concept: null, isConceptSearch: false, intent: null };
    }

    // Classify query intent for phase-aware ranking
    let intent = null;
    if (this.intentClassifier) {
      try {
        intent = await this.intentClassifier.classify(query);
        console.log('[SearchEngine] Query intent:', intent);
      } catch (error) {
        console.warn('[SearchEngine] Intent classification failed:', error);
      }
    }

    // Try concept-based search first
    const conceptResult = this.searchByConcept(query, filters);
    if (conceptResult.scenarios.length > 0) {
      // Apply intent-based re-ranking
      if (intent && intent.phase !== 'unknown') {
        conceptResult.scenarios = this.applyIntentRanking(conceptResult.scenarios, intent);
        // Re-order groups if present
        if (conceptResult.grouped) {
          conceptResult.grouped = this.reorderGroupsByIntent(conceptResult.grouped, intent);
        }
      }
      conceptResult.intent = intent;
      return conceptResult;
    }

    // Fallback to keyword search with intent-aware ranking
    let scenarios = await this.keywordSearch(query, limit);
    if (intent && intent.phase !== 'unknown') {
      scenarios = this.applyIntentRanking(scenarios, intent);
    }
    return {
      scenarios,
      grouped: null,
      concept: null,
      isConceptSearch: false,
      intent
    };
  }

  /**
   * Apply intent-based ranking boost to scenarios
   */
  applyIntentRanking(scenarios, intent) {
    if (!this.intentClassifier || !intent) return scenarios;

    // Score and sort scenarios based on intent match
    const scoredScenarios = scenarios.map(scenario => {
      const boost = this.intentClassifier.getScenarioBoost(scenario, intent);
      return {
        scenario,
        boost,
        originalScore: scenario._relevanceScore || 1
      };
    });

    // Sort by boosted score
    scoredScenarios.sort((a, b) => {
      const scoreA = a.originalScore * a.boost;
      const scoreB = b.originalScore * b.boost;
      return scoreB - scoreA;
    });

    return scoredScenarios.map(s => s.scenario);
  }

  /**
   * Reorder phase groups based on detected intent
   */
  reorderGroupsByIntent(groups, intent) {
    if (!intent || intent.phase === 'unknown') return groups;

    // Sort groups so matching phase comes first
    return groups.slice().sort((a, b) => {
      const aMatches = a.phase === intent.phase ? 1 : 0;
      const bMatches = b.phase === intent.phase ? 1 : 0;
      return bMatches - aMatches;
    });
  }

  /**
   * Concept-based search - looks up concepts and returns grouped results
   */
  searchByConcept(query, filters = {}) {
    if (!this.conceptIndex) {
      console.log('[SearchEngine] No concept index available');
      return { scenarios: [], grouped: null, concept: null, isConceptSearch: false };
    }

    const queryNorm = this._norm(query);
    console.log('[SearchEngine] Searching for concept:', queryNorm, 'in region:', this.regionName);

    const synMap = this.normSynonymToConcept || {};

    // Try exact match against the pre-normalized synonym index
    let conceptId = synMap[queryNorm];
    console.log('[SearchEngine] Exact match:', conceptId);

    // If no exact match, try substring matches (either direction)
    if (!conceptId) {
      for (const [synonym, cId] of Object.entries(synMap)) {
        if (queryNorm.includes(synonym) || synonym.includes(queryNorm)) {
          conceptId = cId;
          console.log('[SearchEngine] Partial match:', synonym, '->', cId);
          break;
        }
      }
    }

    // Last resort: conservative fuzzy match for typos (edit distance <=1, query length >=6)
    if (!conceptId) {
      const suggestions = this.suggestSimilar(query, 1);
      if (suggestions.length > 0) {
        conceptId = suggestions[0].conceptId;
        console.log('[SearchEngine] Fuzzy match:', suggestions[0].term, '->', conceptId, '(distance', suggestions[0].distance + ')');
      }
    }

    if (!conceptId || !this.conceptIndex.concepts[conceptId]) {
      console.log('[SearchEngine] No concept found for query');
      return { scenarios: [], grouped: null, concept: null, isConceptSearch: false };
    }

    const concept = this.conceptIndex.concepts[conceptId];
    console.log('[SearchEngine] Found concept:', concept.display_name);

    // Get scenario mappings, filtering by current region if set
    let mappings = concept.scenario_mappings || [];
    console.log('[SearchEngine] Total mappings:', mappings.length);

    // Filter by region if we're in a specific region
    if (this.regionName) {
      const beforeFilter = mappings.length;
      mappings = mappings.filter(m => m.region === this.regionName);
      console.log('[SearchEngine] After region filter:', mappings.length, '(from', beforeFilter, ')');
    }

    // Apply phase filter if set
    if (filters.phase) {
      mappings = mappings.filter(m => m.metadata?.phase === filters.phase);
    }

    // Apply context filters
    if (filters.context) {
      for (const [key, value] of Object.entries(filters.context)) {
        mappings = mappings.filter(m => m.metadata?.context?.[key] === value);
      }
    }

    // Match mappings to actual loaded scenarios
    const matchedScenarios = this.matchMappingsToScenarios(mappings);
    console.log('[SearchEngine] Matched scenarios:', matchedScenarios.length);

    // Group by phase
    const grouped = this.groupByPhase(matchedScenarios, mappings);
    console.log('[SearchEngine] Grouped into', grouped.length, 'phases');

    // Generate filter chips from available phases
    const availablePhases = this.getAvailablePhases(concept.scenario_mappings, this.regionName);

    return {
      scenarios: matchedScenarios,
      grouped,
      concept: {
        id: conceptId,
        displayName: concept.display_name,
        bodyRegion: concept.body_region,
        availablePhases
      },
      isConceptSearch: true
    };
  }

  /**
   * Match concept mappings to actual loaded scenarios
   */
  matchMappingsToScenarios(mappings) {
    const matchedScenarios = [];
    const scenarioById = new Map();

    // Build lookup by ID
    this.scenarios.forEach(s => {
      if (s.id) scenarioById.set(s.id, s);
    });

    // Match mappings to scenarios
    for (const mapping of mappings) {
      const scenario = scenarioById.get(mapping.scenario_id);
      if (scenario) {
        // Attach metadata from mapping
        const enrichedScenario = {
          ...scenario,
          _conceptMetadata: mapping.metadata,
          _relevanceScore: mapping.relevance_score
        };
        matchedScenarios.push(enrichedScenario);
      }
    }

    return matchedScenarios;
  }

  /**
   * Group scenarios by clinical phase
   */
  groupByPhase(scenarios, mappings) {
    const groups = {};
    const phaseOrder = ['screening', 'initial', 'pretreatment', 'surveillance', 'complication'];

    // Create mapping lookup
    const mappingById = new Map();
    mappings.forEach(m => mappingById.set(m.scenario_id, m));

    // Group scenarios
    for (const scenario of scenarios) {
      const mapping = mappingById.get(scenario.id);
      const phase = mapping?.metadata?.phase || scenario._conceptMetadata?.phase || 'initial';
      const phaseDisplay = mapping?.metadata?.phase_display || scenario._conceptMetadata?.phase_display || 'Initial Workup';

      if (!groups[phase]) {
        groups[phase] = {
          phase,
          phaseDisplay,
          scenarios: []
        };
      }
      groups[phase].scenarios.push(scenario);
    }

    // Sort groups by phase order
    const sortedGroups = [];
    for (const phase of phaseOrder) {
      if (groups[phase]) {
        sortedGroups.push(groups[phase]);
      }
    }

    // Add any remaining phases not in the order
    for (const phase of Object.keys(groups)) {
      if (!phaseOrder.includes(phase)) {
        sortedGroups.push(groups[phase]);
      }
    }

    return sortedGroups;
  }

  /**
   * Get available phases for filter chips
   */
  getAvailablePhases(allMappings, regionName) {
    const phaseCounts = {};

    // Filter by region first
    let mappings = allMappings;
    if (regionName) {
      mappings = mappings.filter(m => m.region === regionName);
    }

    // Count scenarios per phase
    for (const mapping of mappings) {
      const phase = mapping.metadata?.phase;
      const phaseDisplay = mapping.metadata?.phase_display;
      if (phase) {
        if (!phaseCounts[phase]) {
          phaseCounts[phase] = { phase, phaseDisplay, count: 0 };
        }
        phaseCounts[phase].count++;
      }
    }

    // Convert to array and sort by order
    const phaseOrder = ['screening', 'initial', 'pretreatment', 'surveillance', 'complication'];
    const phases = Object.values(phaseCounts).sort((a, b) => {
      const aIdx = phaseOrder.indexOf(a.phase);
      const bIdx = phaseOrder.indexOf(b.phase);
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });

    return phases;
  }

  /**
   * Keyword-based search (original implementation)
   */
  async keywordSearch(query, limit = 10) {
    const queryNorm = this._norm(query);
    const expandedTerms = this.expandQuery(query);

    // Score scenarios
    const scores = new Map();

    // Expanded keyword matching
    expandedTerms.forEach(word => {
      // Exact match (higher score)
      if (this.index.has(word)) {
        this.index.get(word).forEach(idx => {
          scores.set(idx, (scores.get(idx) || 0) + 3);
        });
      }

      // Partial match (lower score)
      for (const [indexWord, indices] of this.index) {
        if (indexWord !== word && (indexWord.includes(word) || word.includes(indexWord))) {
          indices.forEach(idx => {
            scores.set(idx, (scores.get(idx) || 0) + 1);
          });
        }
      }
    });

    // Boost for exact phrase in title/name (normalized)
    this.scenarios.forEach((scenario, idx) => {
      const nameNorm = this._norm(scenario.name);
      if (queryNorm && nameNorm.includes(queryNorm)) {
        scores.set(idx, (scores.get(idx) || 0) + 15);
      }
    });

    // Boost scenarios with high-rated MRI procedures
    this.scenarios.forEach((scenario, idx) => {
      if (!scores.has(idx)) return;

      const procedures = scenario.procedures || [];
      const hasMRI = procedures.some(p =>
        p.modality === 'MRI' && p.rating >= 7
      );
      if (hasMRI) {
        scores.set(idx, (scores.get(idx) || 0) + 2);
      }
    });

    // Sort by score
    const results = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([idx]) => this.scenarios[idx]);

    return results;
  }

  detectAmbiguity(query) {
    const queryLower = query.toLowerCase();

    // Common ambiguity patterns
    const ambiguityPatterns = [
      {
        trigger: /headache|head\s*pain/i,
        options: [
          { label: 'Acute / Sudden onset?', value: 'acute sudden onset' },
          { label: 'Chronic / Recurring?', value: 'chronic recurring' },
          { label: 'Post-trauma?', value: 'trauma injury' },
          { label: 'With neurological symptoms?', value: 'neurological deficit' }
        ]
      },
      {
        trigger: /back\s*pain|spine\s*pain/i,
        options: [
          { label: 'With radiculopathy?', value: 'radiculopathy nerve' },
          { label: 'Post-trauma?', value: 'trauma fracture' },
          { label: 'Suspected infection?', value: 'infection osteomyelitis' },
          { label: 'Known malignancy?', value: 'cancer metastasis' }
        ]
      },
      {
        trigger: /chest\s*pain/i,
        options: [
          { label: 'Cardiac / ACS?', value: 'cardiac acute coronary' },
          { label: 'Pulmonary embolism?', value: 'PE pulmonary embolism' },
          { label: 'Aortic dissection?', value: 'aortic dissection' },
          { label: 'Musculoskeletal?', value: 'chest wall musculoskeletal' }
        ]
      },
      {
        trigger: /abdominal\s*pain|belly\s*pain|stomach/i,
        options: [
          { label: 'Right lower quadrant?', value: 'RLQ appendicitis' },
          { label: 'Right upper quadrant?', value: 'RUQ biliary gallbladder' },
          { label: 'Suspected obstruction?', value: 'bowel obstruction' },
          { label: 'Post-trauma?', value: 'trauma injury' }
        ]
      },
      {
        trigger: /knee|shoulder|hip|ankle|wrist|elbow/i,
        options: [
          { label: 'Acute injury / Trauma?', value: 'acute injury trauma' },
          { label: 'Chronic / Degenerative?', value: 'chronic degenerative arthritis' },
          { label: 'Suspected infection?', value: 'infection septic' },
          { label: 'Mass / Tumor?', value: 'mass tumor neoplasm' }
        ]
      },
      {
        trigger: /mass|tumor|lesion|nodule/i,
        options: [
          { label: 'Initial characterization?', value: 'initial characterization new' },
          { label: 'Known malignancy staging?', value: 'staging known cancer' },
          { label: 'Follow-up / Surveillance?', value: 'follow-up surveillance' }
        ]
      },
      {
        trigger: /stroke|weakness|numbness|paralysis/i,
        options: [
          { label: 'Acute / Emergency?', value: 'acute emergency' },
          { label: 'Subacute (days)?', value: 'subacute days' },
          { label: 'Chronic / Evaluation?', value: 'chronic evaluation' }
        ]
      }
    ];

    for (const pattern of ambiguityPatterns) {
      if (pattern.trigger.test(queryLower)) {
        // Check if query already has clarifying terms
        const hasClarity = pattern.options.some(opt =>
          opt.value.split(' ').some(term => queryLower.includes(term))
        );

        if (!hasClarity) {
          return {
            isAmbiguous: true,
            options: pattern.options
          };
        }
      }
    }

    return { isAmbiguous: false, options: [] };
  }
}
