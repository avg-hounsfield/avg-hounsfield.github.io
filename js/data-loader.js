/**
 * Data Loader - Handles loading region-specific data and protocol matching
 */

export class DataLoader {
  constructor() {
    this.cache = new Map();
    this.protocols = null;
    this.protocolRouter = null;
  }

  async loadRegion(region) {
    if (this.cache.has(region)) {
      return this.cache.get(region);
    }

    // Cache buster to ensure fresh data after updates
    const cacheBuster = '20260129c';
    const scenariosPath = `data/regions/${region}.json?v=${cacheBuster}`;

    try {
      const response = await fetch(scenariosPath);
      if (!response.ok) {
        throw new Error(`Failed to load ${scenariosPath}`);
      }

      const data = await response.json();
      this.cache.set(region, data);
      return data;
    } catch (error) {
      console.error(`Error loading region ${region}:`, error);
      return {
        region,
        scenarios: [],
        embeddings: null
      };
    }
  }

  async loadProtocols() {
    if (this.protocols) {
      return this.protocols;
    }

    try {
      const response = await fetch('data/protocols.json');
      if (!response.ok) {
        throw new Error('Failed to load protocols');
      }
      this.protocols = await response.json();
      return this.protocols;
    } catch (error) {
      console.error('Error loading protocols:', error);
      return [];
    }
  }

  async loadProtocolRouter() {
    if (this.protocolRouter) {
      return this.protocolRouter;
    }

    try {
      const response = await fetch('data/search/protocol_router.json');
      if (!response.ok) {
        throw new Error('Failed to load protocol router');
      }
      this.protocolRouter = await response.json();
      return this.protocolRouter;
    } catch (error) {
      console.error('Error loading protocol router:', error);
      return null;
    }
  }

  /**
   * Get supplemental sequences for a procedure based on scenario context
   */
  getSupplementalSequences(routeEntry, scenarioName) {
    if (!routeEntry || !routeEntry.supplemental_sequences) {
      return null;
    }

    const supplements = routeEntry.supplemental_sequences;
    const scenarioLower = (scenarioName || '').toLowerCase();
    const result = {
      always: [],
      contextual: []
    };

    // Always-add sequences
    if (supplements.always_add) {
      for (const item of supplements.always_add) {
        result.always.push({
          reason: item.reason,
          sequences: item.sequences
        });
      }
    }

    // Context-based sequences
    if (supplements.context_based) {
      for (const rule of supplements.context_based) {
        const matches = rule.when.some(keyword => scenarioLower.includes(keyword.toLowerCase()));
        if (matches) {
          result.contextual.push({
            reason: rule.reason,
            sequences: rule.sequences,
            fromProtocol: rule.add_from_protocol
          });
        }
      }
    }

    // Return null if nothing to add
    if (result.always.length === 0 && result.contextual.length === 0) {
      return null;
    }

    return result;
  }

  async getProtocol(region, scenario, procedure) {
    const protocols = await this.loadProtocols();
    const router = await this.loadProtocolRouter();

    if (!protocols || protocols.length === 0) {
      return { protocol: null, matchType: null, supplementalSequences: null };
    }

    // Determine contrast needs from procedure
    const needsContrast = this.procedureNeedsContrast(procedure);
    const scenarioName = (scenario?.name || '').toLowerCase();
    const procedureName = procedure?.name || '';

    // Check router for supplemental sequences
    let supplementalSequences = null;
    if (router && router.routes && router.routes[procedureName]) {
      const routeEntry = router.routes[procedureName];
      supplementalSequences = this.getSupplementalSequences(routeEntry, scenario?.name);
    }

    // FIRST: Apply clinical rules for specific conditions
    // These are explicitly coded rules, so they're "curated"
    // Pass procedure name to make rules region-aware
    const clinicalMatch = this.applyClinicalRules(protocols, scenarioName, needsContrast, procedureName, region);
    if (clinicalMatch) {
      return { protocol: clinicalMatch, matchType: 'curated', supplementalSequences };
    }

    // SECOND: Check pre-computed scenario matches
    // If scenario is explicitly in protocol's scenario_matches, it's "curated"
    if (scenario?.id) {
      const scenarioId = String(scenario.id);
      const preMatched = this.findPrecomputedMatch(protocols, scenarioId, needsContrast, scenarioName);
      if (preMatched) {
        return { protocol: preMatched, matchType: 'curated', supplementalSequences };
      }
    }

    // FALLBACK: Dynamic scoring based on terms
    // This is algorithmic matching, so it's "suggested"
    const searchTerms = this.extractSearchTerms(scenario, procedure, region);

    // Score each protocol
    const scored = protocols.map(protocol => {
      const score = this.scoreProtocol(protocol, region, searchTerms, needsContrast);
      return { protocol, score };
    });

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    // Return best match if score is high enough
    if (scored[0]?.score >= 10) {
      return { protocol: scored[0].protocol, matchType: 'suggested', supplementalSequences };
    }

    // Fallback: try to find any protocol in the right region
    const regionFallback = scored.find(s => s.score >= 5);
    if (regionFallback?.protocol) {
      return { protocol: regionFallback.protocol, matchType: 'suggested', supplementalSequences };
    }

    return { protocol: null, matchType: null, supplementalSequences: null };
  }

  // Clinical intelligence for protocol selection
  // Rules are now region/procedure-aware to avoid cross-region mismatches
  applyClinicalRules(protocols, scenarioName, needsContrast, procedureName = '', region = '') {
    const procLower = procedureName.toLowerCase();

    // Helper to check if procedure is for a specific body region
    const isProcedureFor = (bodyPart) => {
      return procLower.includes(bodyPart);
    };

    // Only apply neuro rules if procedure is for head/brain
    const isNeuroProcedure = isProcedureFor('head') || isProcedureFor('brain') ||
                             isProcedureFor('iac') || isProcedureFor('orbit') ||
                             isProcedureFor('sella') || isProcedureFor('pituitary') ||
                             region === 'neuro';

    // Only apply spine rules if procedure is for spine
    const isSpineProcedure = isProcedureFor('spine') || isProcedureFor('cervical') ||
                             isProcedureFor('thoracic') || isProcedureFor('lumbar') ||
                             isProcedureFor('sacr') || region === 'spine';

    // Only apply MSK rules if procedure is for MSK
    const isMskProcedure = isProcedureFor('knee') || isProcedureFor('shoulder') ||
                           isProcedureFor('hip') || isProcedureFor('ankle') ||
                           isProcedureFor('wrist') || isProcedureFor('elbow') ||
                           isProcedureFor('extremity') || isProcedureFor('foot') ||
                           isProcedureFor('hand') || isProcedureFor('femur') ||
                           isProcedureFor('tibia') || region === 'msk';

    // Acute stroke -> BRAIN protocol (has DWI), not TIA
    // Only for neuro procedures
    if (isNeuroProcedure &&
        (scenarioName.includes('stroke') || scenarioName.includes('ischemic')) &&
        scenarioName.includes('acute') && !scenarioName.includes('tia')) {
      const brain = protocols.find(p => p.name === 'BRAIN' && !p.uses_contrast);
      if (brain) return brain;
    }

    // Explicitly mentions TIA -> TIA protocol
    // Only for neuro procedures
    const tiaRegex = /(^|[\s,;.\-])tia([\s,;.\-]|$)/i;
    if (isNeuroProcedure &&
        (tiaRegex.test(scenarioName) || scenarioName.includes('transient ischemic'))) {
      const tia = protocols.find(p => p.name === 'TIA');
      if (tia) return tia;
    }

    // Brain tumor/mass -> BRAIN TUMOR/INF protocol
    // ONLY for neuro procedures (head/brain MRI)
    if (isNeuroProcedure &&
        (scenarioName.includes('tumor') || scenarioName.includes('mass') ||
         scenarioName.includes('lesion') || scenarioName.includes('metasta'))) {
      const tumorProtocol = protocols.find(p =>
        p.name === 'BRAIN TUMOR/INF' ||
        (p.name.includes('TUMOR') && p.body_region === 'neuro')
      );
      if (tumorProtocol) return tumorProtocol;
    }

    // Seizure -> SEIZURE protocol
    // Only for neuro procedures
    if (isNeuroProcedure &&
        (scenarioName.includes('seizure') || scenarioName.includes('epilep'))) {
      const seizure = protocols.find(p => p.name === 'SEIZURE');
      if (seizure) return seizure;
    }

    // MS/demyelinating -> BRAIN MS protocol
    // Only for neuro procedures
    if (isNeuroProcedure &&
        (scenarioName.includes('multiple sclerosis') || scenarioName.includes(' ms ') ||
         scenarioName.includes('demyelinat'))) {
      const ms = protocols.find(p => p.name === 'BRAIN MS');
      if (ms) return ms;
    }

    // Pituitary -> PITUITARY protocol
    // Only for neuro procedures
    if (isNeuroProcedure &&
        (scenarioName.includes('pituitary') || scenarioName.includes('sellar'))) {
      const pit = protocols.find(p => p.name === 'PITUITARY');
      if (pit) return pit;
    }

    // Osteomyelitis/infection (MSK) -> OSTEOMYELITIS protocol
    // Only for MSK procedures
    if (isMskProcedure &&
        (scenarioName.includes('osteomyelitis') ||
         scenarioName.includes('septic arthritis') ||
         scenarioName.includes('soft tissue infection') ||
         scenarioName.includes('cellulitis') ||
         scenarioName.includes('abscess') ||
         (scenarioName.includes('infection') &&
          !scenarioName.includes('brain') &&
          !scenarioName.includes('discitis')))) {
      const osteo = protocols.find(p => p.name === 'OSTEOMYELITIS');
      if (osteo) return osteo;
    }

    // Spine infection (discitis/osteomyelitis) -> appropriate spine protocol
    // Only for spine procedures
    if (isSpineProcedure &&
        (scenarioName.includes('spine infection') ||
         scenarioName.includes('discitis') ||
         scenarioName.includes('epidural abscess') ||
         (scenarioName.includes('infection') && scenarioName.includes('spine')))) {
      // Choose spine protocol based on procedure location
      if (procLower.includes('cervical')) {
        const cspine = protocols.find(p => p.name === 'C-SPINE');
        if (cspine) return cspine;
      }
      if (procLower.includes('thoracic')) {
        const tspine = protocols.find(p => p.name === 'T-SPINE');
        if (tspine) return tspine;
      }
      if (procLower.includes('lumbar') || procLower.includes('lumbosacral')) {
        const lspine = protocols.find(p => p.name === 'L-SPINE');
        if (lspine) return lspine;
      }
      // Fallback: if "complete spine" or unspecified, use screening spine
      const screeningSpine = protocols.find(p => p.name === 'SCREENING SPINE');
      if (screeningSpine) return screeningSpine;
    }

    return null; // No clinical rule matched
  }

  findPrecomputedMatch(protocols, scenarioId, needsContrast, scenarioName = '') {
    // Find all protocols that have this scenario in their matches
    const candidates = [];

    for (const protocol of protocols) {
      if (!protocol.scenario_matches) continue;

      const match = protocol.scenario_matches.find(m => String(m.scenario_id) === scenarioId);
      if (match) {
        candidates.push({
          protocol,
          relevanceScore: match.relevance_score,
          contrastMatch: (needsContrast && protocol.uses_contrast) ||
                         (!needsContrast && !protocol.uses_contrast)
        });
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Sort by relevance score, with contrast match as tiebreaker
    candidates.sort((a, b) => {
      // Prefer matching contrast requirement
      if (a.contrastMatch !== b.contrastMatch) {
        return a.contrastMatch ? -1 : 1;
      }
      return b.relevanceScore - a.relevanceScore;
    });

    return candidates[0].protocol;
  }

  procedureNeedsContrast(procedure) {
    if (!procedure) return false;

    // Check explicit flag
    if (procedure.usesContrast === 1 || procedure.usesContrast === 2) {
      return true;
    }

    // Check procedure name for contrast indicators
    const name = (procedure.name || '').toLowerCase();
    if (name.includes('with iv contrast') ||
        name.includes('with and without') ||
        name.includes('w/ contrast') ||
        name.includes('w/wo')) {
      return true;
    }

    return false;
  }

  extractSearchTerms(scenario, procedure, region) {
    const terms = new Set();

    // Add region-specific terms
    const regionTerms = {
      neuro: ['brain', 'head', 'neuro', 'cranial', 'intracranial'],
      spine: ['spine', 'cervical', 'thoracic', 'lumbar', 'sacral', 'cord'],
      chest: ['chest', 'thorax', 'lung', 'cardiac', 'heart', 'pulmonary'],
      abdomen: ['abdomen', 'pelvis', 'liver', 'kidney', 'pancreas', 'bowel', 'gi'],
      msk: ['knee', 'shoulder', 'hip', 'ankle', 'wrist', 'elbow', 'foot', 'hand', 'extremity', 'joint', 'musculoskeletal'],
      vascular: ['vascular', 'vessel', 'artery', 'vein', 'mra', 'mrv', 'angio'],
      breast: ['breast'],
      peds: ['pediatric', 'child', 'infant', 'neonatal']
    };

    (regionTerms[region] || []).forEach(t => terms.add(t));

    // Extract from scenario name
    if (scenario?.name) {
      const scenarioWords = scenario.name.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3);

      // Key anatomical/pathological terms
      const importantTerms = ['tumor', 'mass', 'infection', 'trauma', 'fracture', 'pain',
        'stroke', 'hemorrhage', 'lesion', 'cancer', 'metastasis', 'abscess', 'cyst',
        'tear', 'rupture', 'disc', 'stenosis', 'hernia', 'inflammation'];

      scenarioWords.forEach(word => {
        if (importantTerms.some(t => word.includes(t))) {
          terms.add(word);
        }
      });

      // Add body part terms
      const bodyParts = ['brain', 'spine', 'knee', 'shoulder', 'hip', 'ankle', 'wrist',
        'liver', 'kidney', 'pelvis', 'chest', 'abdomen', 'neck', 'orbit', 'sinus'];

      scenarioWords.forEach(word => {
        if (bodyParts.includes(word)) {
          terms.add(word);
        }
      });
    }

    // Extract from procedure name
    if (procedure?.name) {
      const procName = procedure.name.toLowerCase();

      // Look for body part in procedure name
      const match = procName.match(/mri\s+(\w+)/);
      if (match) {
        terms.add(match[1]);
      }
    }

    return Array.from(terms);
  }

  scoreProtocol(protocol, region, searchTerms, needsContrast) {
    let score = 0;

    const protocolName = (protocol.name || '').toLowerCase();
    const protocolDisplay = (protocol.display_name || '').toLowerCase();
    const protocolRegion = (protocol.body_region || '').toLowerCase();
    const protocolSection = (protocol.section || '').toLowerCase();
    const protocolKeywords = (protocol.keywords || []).map(k => k.toLowerCase());
    const protocolIndications = (protocol.indications || '').toLowerCase();

    // Region match (highest priority)
    if (protocolRegion === region || protocolSection.includes(region)) {
      score += 15;
    }

    // Search term matches
    for (const term of searchTerms) {
      // Match in protocol name (high value)
      if (protocolName.includes(term) || protocolDisplay.includes(term)) {
        score += 10;
      }

      // Match in keywords (medium value)
      if (protocolKeywords.some(k => k.includes(term) || term.includes(k))) {
        score += 5;
      }

      // Match in indications (lower value)
      if (protocolIndications.includes(term)) {
        score += 2;
      }
    }

    // Contrast match
    const protocolContrast = protocol.uses_contrast;
    if (needsContrast && protocolContrast) {
      score += 8;
    } else if (!needsContrast && !protocolContrast) {
      score += 5;
    } else if (needsContrast && !protocolContrast) {
      // Mismatch - reduce score but don't eliminate
      score -= 3;
    }

    return score;
  }

  clearCache() {
    this.cache.clear();
  }
}
