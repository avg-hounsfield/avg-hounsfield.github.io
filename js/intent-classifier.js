/**
 * Intent Classifier - Lightweight query intent detection
 *
 * Classifies search queries into:
 * - Phase: initial | surveillance | treatment | unknown
 * - Urgency: acute | chronic | routine | unknown
 *
 * Used to re-rank scenarios so "initial workup" queries prioritize
 * diagnostic scenarios over follow-up/surveillance scenarios.
 *
 * Size target: <500KB model + <50KB vocab
 */

export class IntentClassifier {
  constructor() {
    this.session = null;
    this.vocab = null;
    this.config = null;
    this.ready = false;

    // Labels (must match training)
    this.phases = ['initial', 'surveillance', 'treatment', 'unknown'];
    this.urgencies = ['acute', 'chronic', 'routine', 'unknown'];
  }

  /**
   * Initialize the classifier (load model and vocab)
   */
  async init(modelPath = 'models/intent-classifier/intent_classifier_int8.onnx',
             vocabPath = 'models/intent-classifier/vocab.json') {
    try {
      // Check if ONNX Runtime is available
      if (typeof ort === 'undefined') {
        console.warn('[IntentClassifier] ONNX Runtime not loaded, using fallback rules');
        this.ready = false;
        return false;
      }

      // Load model
      const cacheBuster = '20260130';
      this.session = await ort.InferenceSession.create(`${modelPath}?v=${cacheBuster}`);

      // Load vocabulary
      const vocabResponse = await fetch(`${vocabPath}?v=${cacheBuster}`);
      this.vocab = await vocabResponse.json();

      // Load config
      const configResponse = await fetch(`${modelPath.replace('.onnx', '')}/config.json?v=${cacheBuster}`);
      if (configResponse.ok) {
        this.config = await configResponse.json();
        this.phases = this.config.phases || this.phases;
        this.urgencies = this.config.urgencies || this.urgencies;
      }

      this.ready = true;
      console.log('[IntentClassifier] Model loaded successfully');
      return true;
    } catch (error) {
      console.warn('[IntentClassifier] Failed to load model:', error);
      this.ready = false;
      return false;
    }
  }

  /**
   * Tokenize text using the vocabulary
   */
  tokenize(text, maxLength = 32) {
    const tokens = text.toLowerCase().match(/\b[\w/-]+\b/g) || [];

    // Add special tokens
    const ids = [this.vocab['[CLS]'] || 2];

    for (let i = 0; i < Math.min(tokens.length, maxLength - 2); i++) {
      const token = tokens[i];
      ids.push(this.vocab[token] || this.vocab['[UNK]'] || 1);
    }

    ids.push(this.vocab['[SEP]'] || 3);

    // Padding
    const attentionMask = new Array(ids.length).fill(1);
    while (ids.length < maxLength) {
      ids.push(this.vocab['[PAD]'] || 0);
      attentionMask.push(0);
    }

    return { ids, attentionMask };
  }

  /**
   * Classify a query using the ONNX model
   */
  async classifyWithModel(query) {
    if (!this.ready || !this.session) {
      return null;
    }

    const maxLength = this.config?.max_length || 32;
    const { ids, attentionMask } = this.tokenize(query, maxLength);

    // Create tensors
    const inputIds = new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, maxLength]);
    const attention = new ort.Tensor('int64', BigInt64Array.from(attentionMask.map(BigInt)), [1, maxLength]);

    // Run inference
    const results = await this.session.run({
      'input_ids': inputIds,
      'attention_mask': attention
    });

    // Get predictions
    const phaseLogits = Array.from(results.phase_logits.data);
    const urgencyLogits = Array.from(results.urgency_logits.data);

    // Softmax and argmax
    const phaseProbs = this.softmax(phaseLogits);
    const urgencyProbs = this.softmax(urgencyLogits);

    const phaseIdx = phaseProbs.indexOf(Math.max(...phaseProbs));
    const urgencyIdx = urgencyProbs.indexOf(Math.max(...urgencyProbs));

    return {
      phase: this.phases[phaseIdx],
      urgency: this.urgencies[urgencyIdx],
      phaseConfidence: phaseProbs[phaseIdx],
      urgencyConfidence: urgencyProbs[urgencyIdx],
      source: 'model'
    };
  }

  /**
   * Rule-based fallback classification (no model needed)
   */
  classifyWithRules(query) {
    const q = query.toLowerCase();

    // Phase detection
    let phase = 'unknown';
    let phaseConfidence = 0.5;

    // Check for explicit abbreviations/conditions that should be "initial"
    const initialConditions = /\b(dvt|pe|mi|cva|tia|acs|stemi|nstemi|sah|ich|ruptured|dissection|hemorrhage|infarct|embolism|thrombosis|acute)\b/;
    if (initialConditions.test(q) && !/\b(follow|surveillance|history|hx|h\/o|known|post)\b/.test(q)) {
      return {
        phase: 'initial',
        urgency: 'acute',
        phaseConfidence: 0.85,
        urgencyConfidence: 0.9,
        source: 'rules-acute-condition'
      };
    }

    const phasePatterns = {
      initial: [
        /\b(suspected|rule out|r\/o|evaluate|initial|new|diagnosis|workup|work-up)\b/,
        /\b(presenting with|complaint of|concern for|possible|probable)\b/,
        /\b(characterization|staging|assessment)\b/,
        /\?/  // Question mark suggests diagnostic uncertainty
      ],
      surveillance: [
        /\b(surveillance|follow-up|follow up|f\/u|monitoring|known)\b/,
        /\b(history of|hx of|h\/o|previous|prior|post-treatment)\b/,
        /\b(recurrence|restaging|interval|routine|annual|screening)\b/,
        /\b(post\s*\w+|after\s+treatment)\b/
      ],
      treatment: [
        /\b(treatment|therapy|intervention|procedure|planning)\b/,
        /\b(preoperative|pre-op|postoperative|post-op|guidance)\b/,
        /\b(ablation|embolization|biopsy|drain|aspiration|injection)\b/,
        /\b(catheter|stent|coil|thrombolysis)\b/
      ]
    };

    for (const [p, patterns] of Object.entries(phasePatterns)) {
      const matches = patterns.filter(pat => pat.test(q)).length;
      if (matches > 0) {
        const confidence = 0.6 + (matches * 0.1);
        if (confidence > phaseConfidence) {
          phase = p;
          phaseConfidence = Math.min(confidence, 0.95);
        }
      }
    }

    // Urgency detection
    let urgency = 'unknown';
    let urgencyConfidence = 0.5;

    const urgencyPatterns = {
      acute: [
        /\b(acute|emergency|emergent|urgent|stat|immediate)\b/,
        /\b(sudden|new onset|rapid|severe|critical|code)\b/,
        /\b(trauma|stroke|mi|pe|dvt|ruptured|dissection)\b/,
        /\b(hemorrhage|bleeding|unstable)\b/
      ],
      chronic: [
        /\b(chronic|longstanding|long-standing|persistent)\b/,
        /\b(recurrent|progressive|worsening|gradual|slow)\b/,
        /\b(degenerative|ongoing)\b/
      ],
      routine: [
        /\b(routine|elective|screening|annual|scheduled)\b/,
        /\b(outpatient|non-urgent|stable|unchanged)\b/
      ]
    };

    for (const [u, patterns] of Object.entries(urgencyPatterns)) {
      const matches = patterns.filter(pat => pat.test(q)).length;
      if (matches > 0) {
        const confidence = 0.6 + (matches * 0.1);
        if (confidence > urgencyConfidence) {
          urgency = u;
          urgencyConfidence = Math.min(confidence, 0.95);
        }
      }
    }

    return {
      phase,
      urgency,
      phaseConfidence,
      urgencyConfidence,
      source: 'rules'
    };
  }

  /**
   * Main classification method - hybrid model + rules approach
   *
   * Strategy:
   * 1. Run model if available
   * 2. If model returns "unknown" with high confidence, use rules to refine
   * 3. Default generic symptom queries to "initial" (diagnostic workup)
   */
  async classify(query) {
    let result;

    // Try model first
    if (this.ready) {
      try {
        result = await this.classifyWithModel(query);
      } catch (error) {
        console.warn('[IntentClassifier] Model inference failed:', error);
      }
    }

    // Fallback or refine with rules
    if (!result) {
      result = this.classifyWithRules(query);
    } else if (result.phase === 'unknown' || result.phaseConfidence < 0.7) {
      // Model uncertain - use rules to refine
      const rulesResult = this.classifyWithRules(query);

      // If rules found something specific, use it
      if (rulesResult.phase !== 'unknown' && rulesResult.phaseConfidence > 0.6) {
        result.phase = rulesResult.phase;
        result.phaseConfidence = rulesResult.phaseConfidence;
        result.source = 'hybrid';
      } else {
        // Default generic queries to "initial" (most common clinical need)
        result.phase = 'initial';
        result.phaseConfidence = 0.6;
        result.source = 'default';
      }
    }

    // Apply same logic for urgency if unknown
    if (result.urgency === 'unknown' || result.urgencyConfidence < 0.7) {
      const rulesResult = this.classifyWithRules(query);
      if (rulesResult.urgency !== 'unknown' && rulesResult.urgencyConfidence > 0.6) {
        result.urgency = rulesResult.urgency;
        result.urgencyConfidence = rulesResult.urgencyConfidence;
      }
    }

    return result;
  }

  /**
   * Get scenario ranking boost based on intent
   */
  getScenarioBoost(scenario, intent) {
    let boost = 1.0;
    const scenarioName = (scenario.name || '').toLowerCase();
    const metadata = scenario._conceptMetadata || {};

    // Phase-based boost
    if (intent.phase !== 'unknown' && intent.phaseConfidence > 0.6) {
      const scenarioPhase = metadata.phase || this.detectScenarioPhase(scenarioName);

      if (scenarioPhase === intent.phase) {
        // Matching phase - boost
        boost *= 1.5;
      } else if (intent.phase === 'initial' && scenarioPhase === 'surveillance') {
        // User wants initial, scenario is surveillance - penalize
        boost *= 0.5;
      } else if (intent.phase === 'surveillance' && scenarioPhase === 'initial') {
        // User wants surveillance, scenario is initial - slight penalize
        boost *= 0.7;
      }
    }

    // Urgency-based boost
    if (intent.urgency !== 'unknown' && intent.urgencyConfidence > 0.6) {
      const scenarioUrgency = this.detectScenarioUrgency(scenarioName);

      if (scenarioUrgency === intent.urgency) {
        boost *= 1.3;
      } else if (intent.urgency === 'acute' && scenarioUrgency === 'routine') {
        // User needs urgent, scenario is routine - penalize
        boost *= 0.6;
      }
    }

    return boost;
  }

  /**
   * Detect phase from scenario name (helper)
   */
  detectScenarioPhase(name) {
    if (/surveillance|follow-up|monitoring|recurrence|hx of|history of/.test(name)) {
      return 'surveillance';
    }
    if (/treatment|therapy|intervention|ablation|biopsy/.test(name)) {
      return 'treatment';
    }
    if (/initial|suspected|evaluate|diagnosis|workup/.test(name)) {
      return 'initial';
    }
    return 'unknown';
  }

  /**
   * Detect urgency from scenario name (helper)
   */
  detectScenarioUrgency(name) {
    if (/acute|emergency|emergent|urgent|trauma|rupture/.test(name)) {
      return 'acute';
    }
    if (/chronic|longstanding|degenerative/.test(name)) {
      return 'chronic';
    }
    if (/routine|screening|annual/.test(name)) {
      return 'routine';
    }
    return 'unknown';
  }

  /**
   * Softmax helper
   */
  softmax(logits) {
    const maxLogit = Math.max(...logits);
    const exps = logits.map(l => Math.exp(l - maxLogit));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sumExps);
  }

  /**
   * Check if classifier is ready
   */
  isReady() {
    return this.ready;
  }
}

// Singleton instance
let classifierInstance = null;

export async function getIntentClassifier() {
  if (!classifierInstance) {
    classifierInstance = new IntentClassifier();
    await classifierInstance.init();
  }
  return classifierInstance;
}

// For use without ES modules
if (typeof window !== 'undefined') {
  window.IntentClassifier = IntentClassifier;
  window.getIntentClassifier = getIntentClassifier;
}
