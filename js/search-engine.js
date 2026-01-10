/**
 * Search Engine - Handles semantic search with medical synonym expansion
 */

export class SearchEngine {
  constructor(regionData) {
    this.scenarios = regionData.scenarios || [];
    this.embeddings = null;
    this.synonyms = null;
    this.initialized = false;
  }

  async init() {
    // Load medical synonyms for query expansion
    await this.loadSynonyms();
    this.buildIndex();
    this.initialized = true;
  }

  async loadSynonyms() {
    try {
      const response = await fetch('data/search/medical-synonyms.json');
      if (response.ok) {
        const data = await response.json();
        this.synonyms = data.synonyms || {};
      }
    } catch (error) {
      console.warn('Could not load medical synonyms:', error);
      this.synonyms = {};
    }
  }

  buildIndex() {
    // Build inverted index for fast keyword search
    this.index = new Map();
    this.phraseIndex = new Map(); // For multi-word terms

    this.scenarios.forEach((scenario, idx) => {
      const text = `${scenario.name} ${scenario.description || ''}`.toLowerCase();
      const words = text.split(/\W+/).filter(w => w.length > 2);

      // Index single words
      words.forEach(word => {
        if (!this.index.has(word)) {
          this.index.set(word, new Set());
        }
        this.index.get(word).add(idx);
      });

      // Index bigrams and trigrams for phrase matching
      const nameLower = scenario.name.toLowerCase();
      const nameWords = nameLower.split(/\W+/).filter(w => w.length > 2);
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
    // Expand query with medical synonyms
    const queryLower = query.toLowerCase();
    const expanded = new Set();

    // Add original terms
    const originalWords = queryLower.split(/\W+/).filter(w => w.length > 2);
    originalWords.forEach(w => expanded.add(w));

    // Check for phrase matches in synonyms
    if (this.synonyms) {
      // Try to find phrase matches first (e.g., "heart attack")
      for (const [term, synonymList] of Object.entries(this.synonyms)) {
        if (queryLower.includes(term)) {
          synonymList.forEach(syn => {
            syn.split(/\s+/).forEach(w => expanded.add(w));
          });
        }
      }

      // Then expand individual words
      originalWords.forEach(word => {
        if (this.synonyms[word]) {
          this.synonyms[word].forEach(syn => {
            syn.split(/\s+/).forEach(w => expanded.add(w));
          });
        }
      });
    }

    return Array.from(expanded);
  }

  async search(query, limit = 10) {
    if (!this.initialized || this.scenarios.length === 0) {
      return [];
    }

    const queryLower = query.toLowerCase();
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

    // Boost for exact phrase in title/name
    this.scenarios.forEach((scenario, idx) => {
      const nameLower = scenario.name.toLowerCase();
      if (nameLower.includes(queryLower)) {
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
