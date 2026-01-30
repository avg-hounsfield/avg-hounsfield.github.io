/**
 * Summary Cards Module
 * Provides quick consensus recommendations for common clinical topics
 */

export class SummaryCards {
  constructor() {
    this.cards = [];
    this.loaded = false;
    this.topicIndex = new Map(); // topic name -> card
  }

  async load() {
    if (this.loaded) return true;

    try {
      const response = await fetch('data/search/summary_cards.json');
      if (!response.ok) {
        console.warn('Summary cards not available');
        return false;
      }

      const data = await response.json();
      this.cards = data.cards || [];

      // Build topic index for fast lookup
      this.buildTopicIndex();

      this.loaded = true;
      console.log(`[SummaryCards] Loaded ${this.cards.length} summary cards`);
      return true;
    } catch (error) {
      console.error('Failed to load summary cards:', error);
      return false;
    }
  }

  buildTopicIndex() {
    this.topicIndex.clear();

    for (const card of this.cards) {
      // Index by primary topic
      this.topicIndex.set(card.topic.toLowerCase(), card);

      // Also index by display name if different
      if (card.display_name && card.display_name.toLowerCase() !== card.topic.toLowerCase()) {
        this.topicIndex.set(card.display_name.toLowerCase(), card);
      }
    }
  }

  /**
   * Find matching summary card for a query
   * Returns the best matching card or null
   */
  findMatch(query) {
    if (!this.loaded || !query) return null;

    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length < 2) return null;

    // Split query into words for matching
    const queryWords = normalizedQuery.split(/\s+/);

    // Priority 1: Exact topic match
    if (this.topicIndex.has(normalizedQuery)) {
      return this.topicIndex.get(normalizedQuery);
    }

    // Priority 2: Topic contained in query (e.g., "acute stroke" matches "stroke")
    let bestMatch = null;
    let bestScore = 0;

    for (const card of this.cards) {
      const topic = card.topic.toLowerCase();
      const displayName = (card.display_name || card.topic).toLowerCase();

      // Check if topic appears in query
      if (normalizedQuery.includes(topic)) {
        // Score based on topic length (prefer longer/more specific matches)
        const score = topic.length * 2 + card.scenario_count;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = card;
        }
      }

      // Check if display name appears in query
      if (displayName !== topic && normalizedQuery.includes(displayName)) {
        const score = displayName.length * 2 + card.scenario_count;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = card;
        }
      }

      // Check for word-level matching (e.g., "headache evaluation" should match "headache")
      const topicWords = topic.split(/\s+/);
      const matchedWords = topicWords.filter(tw => queryWords.includes(tw));
      if (matchedWords.length === topicWords.length && topicWords.length > 0) {
        const score = topic.length * 1.5 + card.scenario_count;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = card;
        }
      }
    }

    return bestMatch;
  }

  /**
   * Format the card type for display
   */
  getCardTypeDisplay(cardType) {
    const types = {
      'STRONG': { label: 'Strong Consensus', color: 'success', icon: 'check-circle' },
      'CONDITIONAL': { label: 'Conditional', color: 'warning', icon: 'alert-circle' },
      'HIGH_VARIANCE': { label: 'High Variance', color: 'caution', icon: 'help-circle' },
      'CLINICAL_FIRST': { label: 'Clinical Assessment First', color: 'info', icon: 'stethoscope' }
    };
    return types[cardType] || { label: cardType, color: 'default', icon: 'info' };
  }

  /**
   * Format procedure name for display (shorten if needed)
   */
  formatProcedureName(name, maxLength = 30) {
    if (!name) return '';
    if (name.length <= maxLength) return name;

    // Common abbreviations
    const abbrevs = {
      'without IV contrast': 'W/O Contrast',
      'with IV contrast': 'W/ Contrast',
      'without and with IV contrast': 'W/O & W/ Contrast',
      'area of interest': '',
      'Radiography': 'XR',
      'Mammography': 'Mammo'
    };

    let shortened = name;
    for (const [full, abbr] of Object.entries(abbrevs)) {
      shortened = shortened.replace(full, abbr);
    }

    if (shortened.length <= maxLength) return shortened;
    return shortened.substring(0, maxLength - 3) + '...';
  }
}
