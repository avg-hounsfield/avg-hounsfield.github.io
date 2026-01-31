/**
 * Protocol Help - Main Application
 * Anatomy-first imaging appropriateness guide
 *
 * Flow: Search -> Scenarios -> Procedures (ranked) -> MRI Protocol
 */

console.log('[Radex] Loading app.js module...');

import { SearchEngine } from './search-engine.js';
import { DataLoader } from './data-loader.js';
import { UI } from './ui.js';
import { RadLiteAPI } from './radlite-api.js';
import { ProtocolBuilder } from './protocol-builder.js';
import { SummaryCards } from './summary-cards.js';
import { getIntentClassifier } from './intent-classifier.js';

class ProtocolHelpApp {
  constructor() {
    this.currentRegion = null;
    this.currentScenario = null;
    this.currentView = 'search'; // 'search' or 'protocols'
    this.searchEngine = null;
    this.dataLoader = new DataLoader();
    this.ui = new UI();
    this.radlite = new RadLiteAPI();
    this.protocolBuilder = new ProtocolBuilder();
    this.summaryCards = new SummaryCards();
    this.debounceTimer = null;
    this.differentialTimer = null;
    this.protocolDebounceTimer = null;
    this.lastDifferentialQuery = '';
    this.baseQuery = ''; // Original query before clarification
    this.activeFilter = null; // Currently selected filter (for clarifying chips)
    this.allProtocols = null; // Cached protocols for protocol view

    // Concept search state
    this.activePhaseFilter = null; // Active phase filter for concept search
    this.currentConcept = null; // Current matched concept

    // Protocol view state
    this.protocolFilters = {
      region: 'all',
      contrast: 'all',
      viewMode: 'grid'
    };
    this.protocolSearchQuery = '';
    this.currentProtocol = null; // Currently viewed protocol
    this.bookmarkedProtocols = this.loadBookmarks();
    this.expandedSequenceRationale = null; // Track which sequence has rationale expanded
    this.queryHistory = this.loadQueryHistory();
    this.maxHistoryItems = 10;

    this.init();
  }

  loadQueryHistory() {
    try {
      return JSON.parse(localStorage.getItem('radex_query_history') || '[]');
    } catch {
      return [];
    }
  }

  saveQueryHistory() {
    localStorage.setItem('radex_query_history', JSON.stringify(this.queryHistory));
  }

  addToQueryHistory(query) {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) return;

    // Remove if already exists (will re-add at top)
    this.queryHistory = this.queryHistory.filter(q => q.toLowerCase() !== trimmed.toLowerCase());

    // Add to front
    this.queryHistory.unshift(trimmed);

    // Limit to max items
    if (this.queryHistory.length > this.maxHistoryItems) {
      this.queryHistory = this.queryHistory.slice(0, this.maxHistoryItems);
    }

    this.saveQueryHistory();
  }

  clearQueryHistory() {
    this.queryHistory = [];
    this.saveQueryHistory();
    this.hideQueryHistory();
  }

  showQueryHistory() {
    const dropdown = document.getElementById('queryHistoryDropdown');
    const list = document.getElementById('queryHistoryList');
    const input = document.getElementById('searchInput');

    if (!dropdown || !list || this.queryHistory.length === 0) {
      this.hideQueryHistory();
      return;
    }

    // Only show if input is empty or focused
    if (input.value.trim()) {
      this.hideQueryHistory();
      return;
    }

    list.innerHTML = this.queryHistory.map((query, index) => `
      <li class="query-history-item" data-index="${index}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        <span class="query-history-text">${this.escapeHtml(query)}</span>
      </li>
    `).join('');

    // Bind click events
    list.querySelectorAll('.query-history-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const index = parseInt(item.dataset.index);
        const query = this.queryHistory[index];
        if (query) {
          input.value = query;
          this.hideQueryHistory();
          this.handleSearch(query);
        }
      });
    });

    dropdown.classList.remove('hidden');
  }

  hideQueryHistory() {
    const dropdown = document.getElementById('queryHistoryDropdown');
    if (dropdown) {
      dropdown.classList.add('hidden');
    }
  }

  loadBookmarks() {
    try {
      return JSON.parse(localStorage.getItem('radex_bookmarks') || '[]');
    } catch {
      return [];
    }
  }

  saveBookmarks() {
    localStorage.setItem('radex_bookmarks', JSON.stringify(this.bookmarkedProtocols));
  }

  isBookmarked(protocolName) {
    return this.bookmarkedProtocols.includes(protocolName);
  }

  toggleBookmark(protocolName) {
    const index = this.bookmarkedProtocols.indexOf(protocolName);
    if (index > -1) {
      this.bookmarkedProtocols.splice(index, 1);
    } else {
      this.bookmarkedProtocols.push(protocolName);
    }
    this.saveBookmarks();
    return this.isBookmarked(protocolName);
  }

  async init() {
    this.bindEvents();
    // Load summary cards for global quick search
    this.summaryCards.load();
    this.ui.setStatus('Ready');
  }

  bindEvents() {
    // Global quick search
    const globalSearchInput = document.getElementById('globalSearchInput');
    const globalSearchBtn = document.getElementById('globalSearchBtn');
    this.activeSuggestionIndex = -1;

    if (globalSearchInput) {
      // Show suggestions as user types
      globalSearchInput.addEventListener('input', (e) => {
        this.showSearchSuggestions(e.target.value);
      });

      globalSearchInput.addEventListener('keydown', (e) => {
        const suggestionsEl = document.getElementById('searchSuggestions');
        const items = suggestionsEl?.querySelectorAll('.suggestion-item') || [];

        if (e.key === 'Enter') {
          e.preventDefault();
          if (this.activeSuggestionIndex >= 0 && items[this.activeSuggestionIndex]) {
            items[this.activeSuggestionIndex].click();
          } else {
            this.handleGlobalSearch(globalSearchInput.value);
          }
          this.hideSearchSuggestions();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.activeSuggestionIndex = Math.min(this.activeSuggestionIndex + 1, items.length - 1);
          this.updateActiveSuggestion(items);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.activeSuggestionIndex = Math.max(this.activeSuggestionIndex - 1, -1);
          this.updateActiveSuggestion(items);
        } else if (e.key === 'Escape') {
          this.hideSearchSuggestions();
        }
      });

      globalSearchInput.addEventListener('focus', () => {
        if (globalSearchInput.value.trim().length >= 2) {
          this.showSearchSuggestions(globalSearchInput.value);
        }
      });
    }

    if (globalSearchBtn && globalSearchInput) {
      globalSearchBtn.addEventListener('click', () => {
        this.hideSearchSuggestions();
        this.handleGlobalSearch(globalSearchInput.value);
      });
    }

    // Hide suggestions when clicking outside
    document.addEventListener('click', (e) => {
      const container = document.querySelector('.quick-search-container');
      if (container && !container.contains(e.target)) {
        this.hideSearchSuggestions();
      }
    });

    // Anatomy buttons
    document.querySelectorAll('.anatomy-btn').forEach(btn => {
      btn.addEventListener('click', () => this.selectRegion(btn.dataset.region));
    });

    // Back button
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.goBack());
    }

    // Search input (scenario search)
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.hideQueryHistory();
          this.clearSearch();
        }
      });
      searchInput.addEventListener('focus', () => {
        if (!searchInput.value.trim()) {
          this.showQueryHistory();
        }
      });
    }

    // Query history clear button
    const queryHistoryClear = document.getElementById('queryHistoryClear');
    if (queryHistoryClear) {
      queryHistoryClear.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.clearQueryHistory();
      });
    }

    // Hide query history on click outside
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('queryHistoryDropdown');
      const searchWrap = document.querySelector('.search-input-wrap');
      if (dropdown && !dropdown.contains(e.target) && !searchWrap?.contains(e.target)) {
        this.hideQueryHistory();
      }
    });

    // Clear button
    const searchClear = document.getElementById('searchClear');
    if (searchClear) {
      searchClear.addEventListener('click', () => this.clearSearch());
    }

    // Nav links (Search/Protocols toggle)
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => this.handleNavClick(e));
    });

    // Protocol search input
    const protocolSearchInput = document.getElementById('protocolSearchInput');
    if (protocolSearchInput) {
      protocolSearchInput.addEventListener('input', (e) => this.handleProtocolSearch(e.target.value));
      protocolSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.clearProtocolSearch();
      });
    }

    // Protocol search clear button
    const protocolSearchClear = document.getElementById('protocolSearchClear');
    if (protocolSearchClear) {
      protocolSearchClear.addEventListener('click', () => this.clearProtocolSearch());
    }

    // Protocol back button
    const protocolBackBtn = document.getElementById('protocolBackBtn');
    if (protocolBackBtn) {
      protocolBackBtn.addEventListener('click', () => this.hideProtocolDetail());
    }

    // Protocol filter controls
    this.bindProtocolFilters();

    // Footer links (About, Terms)
    this.bindModalEvents();

    // Welcome modal (first visit acknowledgment)
    this.initWelcomeModal();

    // Mobile menu
    this.initMobileMenu();
  }

  initMobileMenu() {
    const menuBtn = document.getElementById('mobileMenuBtn');
    const nav = document.querySelector('.header-nav');

    if (!menuBtn || !nav) return;

    menuBtn.addEventListener('click', () => {
      const isExpanded = menuBtn.getAttribute('aria-expanded') === 'true';
      menuBtn.setAttribute('aria-expanded', !isExpanded);
      nav.classList.toggle('mobile-open');
      menuBtn.classList.toggle('active');
    });
  }

  bindProtocolFilters() {
    // Region filter chips
    document.querySelectorAll('#regionFilterChips .filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#regionFilterChips .filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.protocolFilters.region = chip.dataset.region;
        this.applyProtocolFilters();
      });
    });

    // Contrast toggle
    document.querySelectorAll('#contrastToggle .toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#contrastToggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.protocolFilters.contrast = btn.dataset.contrast;
        this.applyProtocolFilters();
      });
    });

    // View toggle (grid/grouped)
    document.querySelectorAll('#viewToggle .toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#viewToggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.protocolFilters.viewMode = btn.dataset.view;
        this.applyProtocolFilters();
      });
    });

    // Copy protocol button
    const copyBtn = document.getElementById('copyProtocolBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => this.copyProtocolToClipboard());
    }

    // Bookmark protocol button
    const bookmarkBtn = document.getElementById('bookmarkProtocolBtn');
    if (bookmarkBtn) {
      bookmarkBtn.addEventListener('click', () => this.toggleCurrentProtocolBookmark());
    }
  }

  applyProtocolFilters() {
    if (!this.allProtocols) return;

    let filtered = [...this.allProtocols];

    // Apply region filter
    if (this.protocolFilters.region !== 'all') {
      filtered = filtered.filter(p => {
        const region = (p.body_region || '').toLowerCase();
        return region === this.protocolFilters.region;
      });
    }

    // Apply contrast filter
    if (this.protocolFilters.contrast !== 'all') {
      const wantsContrast = this.protocolFilters.contrast === 'with';
      filtered = filtered.filter(p => wantsContrast ? p.uses_contrast : !p.uses_contrast);
    }

    // Apply search query
    if (this.protocolSearchQuery) {
      const q = this.protocolSearchQuery.toLowerCase();
      filtered = filtered.filter(p => {
        const name = (p.name || '').toLowerCase();
        const displayName = (p.display_name || '').toLowerCase();
        const keywords = (p.keywords || []).join(' ').toLowerCase();
        const indications = (p.indications || '').toLowerCase();
        return name.includes(q) || displayName.includes(q) || keywords.includes(q) || indications.includes(q);
      });
    }

    // Render based on view mode
    if (this.protocolFilters.viewMode === 'grouped') {
      this.renderProtocolGrouped(filtered);
    } else {
      this.renderProtocolGrid(filtered);
    }

    this.ui.setStatus(`${filtered.length} protocols found`);
  }

  async copyProtocolToClipboard() {
    if (!this.currentProtocol) return;

    const sequences = this.currentProtocol.sequences || [];
    const text = [
      `Protocol: ${this.currentProtocol.display_name || this.currentProtocol.name}`,
      `Contrast: ${this.currentProtocol.uses_contrast ? 'Yes' : 'No'}`,
      '',
      'Sequences:',
      ...sequences.map((s, i) => `${i + 1}. ${s.sequence_name}${s.is_post_contrast ? ' (post-contrast)' : ''}`)
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById('copyProtocolBtn');
      btn.classList.add('copied');
      btn.querySelector('span').textContent = 'Copied!';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.querySelector('span').textContent = 'Copy';
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  toggleCurrentProtocolBookmark() {
    if (!this.currentProtocol) return;

    const name = this.currentProtocol.name;
    const isNowBookmarked = this.toggleBookmark(name);

    const btn = document.getElementById('bookmarkProtocolBtn');
    btn.classList.toggle('active', isNowBookmarked);
    btn.querySelector('span').textContent = isNowBookmarked ? 'Bookmarked' : 'Bookmark';
  }

  estimateScanTime(protocol) {
    // Use enrichment data if available
    if (protocol.enrichment?.scan_time_minutes) {
      return `~${protocol.enrichment.scan_time_minutes} min`;
    }

    // Fallback to rough estimate
    const sequences = protocol.sequences || [];
    let minutes = 0;
    sequences.forEach(seq => {
      minutes += seq.is_post_contrast ? 4 : 3;
    });
    return minutes > 0 ? `~${minutes} min` : 'N/A';
  }

  /**
   * Check if a protocol was AI-generated de novo (not just AI-enriched)
   * Returns true if protocol.source === 'ai_generated'
   * Human-created protocols with AI enrichment are still considered "Human Verified"
   */
  isAIGenerated(protocol) {
    return protocol.source === 'ai_generated';
  }

  bindModalEvents() {
    // About button
    const aboutBtn = document.getElementById('aboutBtn');
    if (aboutBtn) {
      aboutBtn.addEventListener('click', () => this.showModal('aboutModal'));
    }

    // Terms button
    const termsBtn = document.getElementById('termsBtn');
    if (termsBtn) {
      termsBtn.addEventListener('click', () => this.showModal('termsModal'));
    }

    // Close modal on backdrop click or close button
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target.dataset.close === 'true' || e.target.closest('[data-close="true"]')) {
          this.hideModal(modal.id);
        }
      });
    });

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal:not(.hidden)').forEach(modal => {
          this.hideModal(modal.id);
        });
      }
    });
  }

  showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
  }

  hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
    }
  }

  initWelcomeModal() {
    const modal = document.getElementById('welcomeModal');
    const acknowledgeBtn = document.getElementById('welcomeAcknowledge');

    if (!modal || !acknowledgeBtn) return;

    // Check if user has already acknowledged
    const acknowledged = localStorage.getItem('protohelp_acknowledged');
    if (acknowledged) {
      modal.classList.add('hidden');
      return;
    }

    // Show blocking modal
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Handle acknowledgment
    acknowledgeBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
      localStorage.setItem('protohelp_acknowledged', 'true');
    });
  }

  async selectRegion(region) {
    this.currentRegion = region;
    this.ui.setStatus('Loading...', 'loading');

    // Update UI
    document.querySelectorAll('.anatomy-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.region === region);
    });

    // Show search section
    document.querySelector('.anatomy-section').classList.add('hidden');
    document.getElementById('searchSection').classList.remove('hidden');
    document.getElementById('regionTitle').textContent = this.formatRegionName(region);

    try {
      // Load region-specific data and summary cards in parallel
      const [data] = await Promise.all([
        this.dataLoader.loadRegion(region),
        this.summaryCards.load() // Load summary cards (cached after first load)
      ]);

      // Initialize search engine with region data
      this.searchEngine = new SearchEngine(data);
      await this.searchEngine.init();

      this.ui.setStatus(`${data.scenarios.length} scenarios loaded`);
      document.getElementById('searchInput').focus();
    } catch (error) {
      console.error('Failed to load region:', error);
      this.ui.setStatus('Failed to load data', 'error');
    }
  }

  goBack() {
    this.currentRegion = null;
    this.currentScenario = null;
    this.searchEngine = null;
    this.radlite.clearCache(); // Clear cache when going back
    this.ui.hideSummaryCard();
    this.clearSearch();

    // Reset global search state
    const globalSearchInput = document.getElementById('globalSearchInput');
    const globalResult = document.getElementById('globalSearchResult');
    if (globalSearchInput) globalSearchInput.value = '';
    if (globalResult) {
      globalResult.classList.add('hidden');
      globalResult.innerHTML = '';
    }

    document.querySelector('.anatomy-section').classList.remove('hidden');
    document.getElementById('searchSection').classList.add('hidden');

    document.querySelectorAll('.anatomy-btn').forEach(btn => {
      btn.classList.remove('active');
    });

    this.ui.setStatus('Ready');
  }

  // ========================================
  // Global Quick Search
  // ========================================
  async handleGlobalSearch(query) {
    const resultContainer = document.getElementById('globalSearchResult');
    if (!resultContainer) return;

    const trimmed = query.trim();
    if (!trimmed) {
      resultContainer.classList.add('hidden');
      resultContainer.innerHTML = '';
      return;
    }

    // Find matching summary card
    const card = this.summaryCards.findMatch(trimmed);

    if (!card) {
      // No match - show a hint to use advanced search
      resultContainer.classList.remove('hidden');
      resultContainer.innerHTML = `
        <div class="global-result-card">
          <div class="global-result-body">
            <p class="global-result-recommendation">
              No quick answer found for "<strong>${this.escapeHtml(trimmed)}</strong>".
              Try the body region search below for more specific scenarios.
            </p>
          </div>
        </div>
      `;
      return;
    }

    // Classify intent to get assumed context
    let intent = null;
    try {
      const classifier = await getIntentClassifier();
      if (classifier) {
        intent = await classifier.classify(trimmed);
      }
    } catch (e) {
      // Intent classification is optional
    }

    // Render the card with intent context
    this.renderGlobalSearchResult(card, resultContainer, intent);
  }

  renderGlobalSearchResult(card, container, intent = null) {
    const rec = card.primary_recommendation;
    const displayName = card.display_name || card.topic;
    // Deduplicate equivalent procedures (removes redundant namings like "CT brain" vs "CT head")
    const rawEquivProcs = rec.equivalent_procedures || [];
    const equivProcs = this.ui.deduplicateEquivalentProcedures(rawEquivProcs, rec.name);

    // Build assumed context indicator if intent has a matched condition
    let contextIndicator = '';
    if (intent && intent.matchedCondition) {
      const urgencyLabels = { 'acute': 'Acute', 'routine': 'Routine', 'chronic': 'Chronic' };
      const urgencyColors = { 'acute': '#dc3545', 'routine': '#28a745', 'chronic': '#ffc107' };
      const urgencyLabel = urgencyLabels[intent.urgency] || intent.urgency;
      const urgencyColor = urgencyColors[intent.urgency] || '#6c757d';
      contextIndicator = `
        <div class="global-result-context" style="background: ${urgencyColor}15; border-left: 3px solid ${urgencyColor}; padding: 6px 10px; margin-bottom: 8px; font-size: 12px; color: ${urgencyColor};">
          <strong>${urgencyLabel}</strong> context assumed for "${intent.matchedCondition}"
        </div>
      `;
    }

    let bodyContent = '';

    if (card.card_type === 'CLINICAL_FIRST') {
      bodyContent = `
        <div class="global-result-clinical">
          <strong>${card.no_imaging_pct}%</strong> of scenarios suggest clinical assessment before imaging
        </div>
        ${rec.name ? `
          <p class="global-result-recommendation">
            When imaging is indicated: <strong>${this.escapeHtml(rec.name)}</strong>
          </p>
        ` : ''}
      `;
    } else if (card.card_type === 'HIGH_VARIANCE') {
      bodyContent = `
        <div class="global-result-clinical">
          Recommendations vary significantly based on clinical context.
          Use the body region search below for specific guidance.
        </div>
      `;
    } else {
      // STRONG or CONDITIONAL
      const consensusClass = rec.consensus_pct >= 70 ? '' : (rec.consensus_pct >= 40 ? 'moderate' : 'low');

      // Show primary procedure, then deduplicated equivalents as alternatives
      const primaryProc = rec.name || 'None';

      bodyContent = `
        <div class="global-result-procedures">
          <span class="global-result-proc primary">${this.escapeHtml(this.truncateText(primaryProc, 35))}</span>
          ${equivProcs.map(p => `<span class="global-result-proc">${this.escapeHtml(this.truncateText(p, 35))}</span>`).join('')}
        </div>
        <div class="global-result-consensus ${consensusClass}">
          <span class="consensus-value">${rec.consensus_pct}%</span> consensus across ${card.scenario_count} scenarios
        </div>
        ${card.alternatives && card.alternatives.length > 0 ? `
          <p class="global-result-recommendation" style="margin-top: var(--space-sm)">
            Also consider: ${card.alternatives.slice(0, 2).map(a => `${this.escapeHtml(this.truncateText(a.name, 25))} (${a.percentage}%)`).join(', ')}
          </p>
        ` : ''}
      `;
    }

    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="global-result-card">
        <div class="global-result-header">
          <span class="global-result-topic">${this.escapeHtml(displayName)}</span>
          <span class="global-result-meta">ACR Appropriateness Criteria</span>
        </div>
        ${contextIndicator}
        <div class="global-result-body">
          ${bodyContent}
        </div>
        <div class="global-result-footer">
          <span class="global-result-source">Based on ${card.scenario_count} clinical scenarios</span>
          <button class="global-result-action" data-region="${card.region}" data-topic="${card.topic}">
            See detailed scenarios
          </button>
        </div>
      </div>
    `;

    // Bind action button
    const actionBtn = container.querySelector('.global-result-action');
    if (actionBtn) {
      actionBtn.addEventListener('click', () => {
        const region = actionBtn.dataset.region;
        const topic = actionBtn.dataset.topic;
        this.navigateToRegionSearch(region, topic);
      });
    }
  }

  async navigateToRegionSearch(region, topic) {
    // Hide global search result before navigating
    const globalResult = document.getElementById('globalSearchResult');
    if (globalResult) {
      globalResult.classList.add('hidden');
      globalResult.innerHTML = '';
    }

    // Select the region and pre-fill the search
    await this.selectRegion(region);

    // Pre-fill the search input and trigger search
    const searchInput = document.getElementById('searchInput');
    if (searchInput && topic) {
      searchInput.value = topic;
      // Execute search directly instead of through debounced handler
      this.executeSearch(topic);
    }
  }

  truncateText(text, maxLen) {
    if (!text || text.length <= maxLen) return text || '';
    return text.substring(0, maxLen - 3) + '...';
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ========================================
  // Search Suggestions (Autocomplete)
  // ========================================

  // Medical abbreviations and layperson terms mapping
  getSuggestionAliases() {
    return {
      // Medical abbreviations
      'pe': ['pulmonary embolism'],
      'cva': ['stroke'],
      'tia': ['stroke'],
      'mi': ['chest pain'],
      'aaa': ['aortic aneurysm'],
      'ms': ['multiple sclerosis'],
      'acl': ['acl tear'],
      'mcl': ['meniscus tear'],
      'rotator': ['rotator cuff'],
      'dvt': ['dvt'],
      'oa': ['arthritis'],
      'ra': ['arthritis'],
      'avascular': ['osteonecrosis'],
      'avn': ['osteonecrosis'],
      'tbi': ['head trauma'],
      'sci': ['spinal cord injury'],
      'pad': ['peripheral arterial disease'],
      'pvd': ['peripheral arterial disease'],
      'gb': ['cholecystitis'],
      'gallbladder': ['cholecystitis'],
      'hcc': ['liver mass'],
      'rcc': ['renal mass'],
      'nsclc': ['lung cancer'],
      'sclc': ['lung cancer'],

      // Layperson terms
      'heart attack': ['chest pain'],
      'blood clot': ['pulmonary embolism', 'dvt'],
      'clot': ['pulmonary embolism', 'dvt'],
      'slipped disc': ['herniated disc'],
      'bulging disc': ['herniated disc'],
      'ruptured disc': ['herniated disc'],
      'broken bone': ['fracture'],
      'broken': ['fracture'],
      'dizziness': ['vertigo'],
      'dizzy': ['vertigo'],
      'belly pain': ['abdominal pain'],
      'stomach pain': ['abdominal pain'],
      'tummy pain': ['abdominal pain'],
      'lump': ['breast mass', 'soft tissue mass', 'thyroid nodule'],
      'bump': ['soft tissue mass'],
      'mass': ['breast mass', 'soft tissue mass', 'liver mass', 'renal mass'],
      'tumor': ['brain tumor', 'bone tumor'],
      'cancer': ['lung cancer', 'breast cancer', 'ovarian cancer', 'melanoma'],
      'weakness': ['stroke', 'myelopathy'],
      'numbness': ['stroke', 'radiculopathy', 'myelopathy'],
      'tingling': ['radiculopathy', 'myelopathy'],
      'paralysis': ['stroke', 'spinal cord injury'],
      'confusion': ['dementia', 'stroke', 'head trauma'],
      'memory': ['dementia'],
      'forgetful': ['dementia'],
      'gallstones': ['cholecystitis'],
      'kidney stones': ['kidney stone'],
      'stones': ['kidney stone', 'cholecystitis'],
      'sciatica': ['radiculopathy', 'herniated disc'],
      'pinched nerve': ['radiculopathy'],
      'torn': ['acl tear', 'meniscus tear', 'rotator cuff'],
      'tear': ['acl tear', 'meniscus tear', 'rotator cuff'],
      'sprain': ['ankle pain', 'knee pain', 'wrist pain'],
      'swelling': ['dvt', 'arthritis', 'soft tissue infection'],
      'infection': ['soft tissue infection', 'spine infection', 'pneumonia', 'sepsis'],
      'breathing': ['pulmonary embolism', 'pneumonia', 'pleural effusion'],
      'shortness of breath': ['pulmonary embolism', 'pneumonia', 'pleural effusion'],
      'sob': ['pulmonary embolism', 'pneumonia'],
      'cough': ['pneumonia', 'lung cancer', 'lung nodule'],
      'bleeding': ['head trauma'],
      'bleed': ['head trauma', 'stroke'],
      'aneurism': ['aneurysm', 'aortic aneurysm'], // common misspelling
    };
  }

  showSearchSuggestions(query) {
    const suggestionsEl = document.getElementById('searchSuggestions');
    if (!suggestionsEl) return;

    const trimmed = query.trim().toLowerCase();
    if (trimmed.length < 2 || !this.summaryCards?.cards?.length) {
      this.hideSearchSuggestions();
      return;
    }

    // Get alias mappings
    const aliases = this.getSuggestionAliases();
    const aliasTopics = new Set();

    // Check for alias matches
    for (const [alias, topics] of Object.entries(aliases)) {
      if (alias.includes(trimmed) || trimmed.includes(alias)) {
        topics.forEach(t => aliasTopics.add(t));
      }
    }

    // Score and filter matching cards
    const scored = this.summaryCards.cards.map(card => {
      const topic = card.topic.toLowerCase();
      const displayName = (card.display_name || card.topic).toLowerCase();
      const topicWords = topic.split(/\s+/);
      const queryWords = trimmed.split(/\s+/);

      let score = 0;

      // Exact match (highest priority)
      if (topic === trimmed || displayName === trimmed) {
        score = 100;
      }
      // Topic starts with query
      else if (topic.startsWith(trimmed) || displayName.startsWith(trimmed)) {
        score = 80;
      }
      // Topic contains query as substring
      else if (topic.includes(trimmed) || displayName.includes(trimmed)) {
        score = 60;
      }
      // Query contains topic (user typed more than topic)
      else if (trimmed.includes(topic)) {
        score = 50;
      }
      // Alias match
      else if (aliasTopics.has(topic)) {
        score = 70;
      }
      // Word-level matching (any word matches)
      else {
        const matchedWords = queryWords.filter(qw =>
          topicWords.some(tw => tw.includes(qw) || qw.includes(tw))
        );
        if (matchedWords.length > 0) {
          score = 30 + (matchedWords.length * 10);
        }
      }

      // Boost by scenario count for tiebreaking
      if (score > 0) {
        score += Math.min(card.scenario_count / 100, 5);
      }

      return { card, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

    if (scored.length === 0) {
      this.hideSearchSuggestions();
      return;
    }

    // Render suggestions
    suggestionsEl.innerHTML = scored.map(({ card }, i) => {
      const displayName = card.display_name || card.topic;
      const badge = card.card_type === 'STRONG' ? 'Strong' :
                    card.card_type === 'CLINICAL_FIRST' ? 'Clinical' : '';
      return `
        <div class="suggestion-item" data-topic="${this.escapeHtml(card.topic)}" data-index="${i}">
          <span class="suggestion-topic">${this.escapeHtml(displayName)}</span>
          <span class="suggestion-meta">
            ${badge ? `<span class="suggestion-badge">${badge}</span>` : ''}
            ${card.scenario_count} scenarios
          </span>
        </div>
      `;
    }).join('');

    // Bind click events
    suggestionsEl.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', () => {
        const topic = item.dataset.topic;
        document.getElementById('globalSearchInput').value = topic;
        this.hideSearchSuggestions();
        this.handleGlobalSearch(topic);
      });
    });

    suggestionsEl.classList.remove('hidden');
    this.activeSuggestionIndex = -1;
  }

  hideSearchSuggestions() {
    const suggestionsEl = document.getElementById('searchSuggestions');
    if (suggestionsEl) {
      suggestionsEl.classList.add('hidden');
      suggestionsEl.innerHTML = '';
    }
    this.activeSuggestionIndex = -1;
  }

  updateActiveSuggestion(items) {
    items.forEach((item, i) => {
      item.classList.toggle('active', i === this.activeSuggestionIndex);
    });
    // Scroll active item into view
    if (this.activeSuggestionIndex >= 0 && items[this.activeSuggestionIndex]) {
      items[this.activeSuggestionIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  handleSearch(query) {
    // Toggle clear button
    const searchClear = document.getElementById('searchClear');
    if (searchClear) searchClear.classList.toggle('hidden', !query);

    // Hide query history when typing
    if (query.trim()) {
      this.hideQueryHistory();
    }

    // Debounce search
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.executeSearch(query), 200);

    // Debounce differential lookup (longer delay)
    clearTimeout(this.differentialTimer);
    if (query.trim().length >= 3) {
      this.differentialTimer = setTimeout(() => this.lookupDifferential(query), 500);
    } else {
      this.ui.hideDifferential();
    }
  }

  async lookupDifferential(query) {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery === this.lastDifferentialQuery) {
      return;
    }
    this.lastDifferentialQuery = normalizedQuery;

    const medicalTerm = this.extractMedicalTerm(query);
    if (!medicalTerm || medicalTerm.length < 3) {
      this.ui.hideDifferential();
      return;
    }

    this.ui.showDifferentialLoading();

    try {
      const result = await this.radlite.query(medicalTerm);
      if (result.success && (result.description || result.differentials?.length > 0)) {
        this.ui.renderDifferential(result);
      } else {
        this.ui.hideDifferential();
      }
    } catch (error) {
      console.warn('Differential lookup failed:', error);
      this.ui.hideDifferential();
    }
  }

  extractMedicalTerm(query) {
    const stopWords = ['the', 'a', 'an', 'for', 'with', 'without', 'of', 'in', 'on', 'to', 'and', 'or', 'is', 'are', 'was', 'were', 'concern', 'possible', 'suspected', 'rule', 'out', 'evaluate'];

    const words = query.toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.includes(w));

    if (words.length === 0) return null;

    if (query.toLowerCase().includes('-')) {
      const hyphenated = query.match(/[\w]+-[\w]+/i);
      if (hyphenated) return hyphenated[0];
    }

    return words.join(' ');
  }

  async executeSearch(query, isFilterChange = false) {
    if (!query.trim()) {
      this.ui.clearScenarios();
      this.ui.hideChips();
      this.ui.hidePhaseFilterChips();
      this.ui.hideConceptHeader();
      this.ui.hideSummaryCard();
      this.ui.hideMriProtocol();
      this.baseQuery = '';
      this.activeFilter = null;
      this.activePhaseFilter = null;
      this.currentConcept = null;
      return;
    }

    if (!this.searchEngine) {
      return;
    }

    this.ui.setStatus('Searching...', 'loading');

    try {
      // On fresh searches, reset filters
      if (!isFilterChange) {
        this.baseQuery = query;
        this.activeFilter = null;
        this.activePhaseFilter = null;
        this.currentConcept = null;
      }

      // Build search options
      const searchOptions = {
        limit: 30,
        filters: {}
      };

      // Add phase filter if active
      if (this.activePhaseFilter) {
        searchOptions.filters.phase = this.activePhaseFilter;
      }

      // Execute search - returns { scenarios, grouped, concept, isConceptSearch, intent }
      const result = await this.searchEngine.search(this.baseQuery, searchOptions);

      // Show assumed context banner if condition-based urgency was applied
      if (result.intent && result.intent.matchedCondition) {
        this.ui.showAssumedContextBanner(result.intent, (intent) => {
          this.handleUrgencyOverride(intent);
        });
      } else {
        this.ui.hideAssumedContextBanner();
      }

      // Check for summary card match on fresh searches
      if (!isFilterChange) {
        const summaryCard = this.summaryCards.findMatch(this.baseQuery);
        if (summaryCard) {
          this.ui.showSummaryCard(summaryCard, (topic) => {
            // "See detailed scenarios" clicked - do nothing special, results are already showing
            this.ui.hideSummaryCard();
          }, result.intent);
        } else {
          this.ui.hideSummaryCard();
        }
      }

      if (result.isConceptSearch && result.concept) {
        // Concept-based search - show concept header and phase filters
        this.currentConcept = result.concept;

        // Show concept header
        this.ui.showConceptHeader(result.concept);

        // Show phase filter chips if we have multiple phases
        if (result.concept.availablePhases && result.concept.availablePhases.length > 1) {
          this.ui.showPhaseFilterChips(
            result.concept.availablePhases,
            this.activePhaseFilter,
            (phase) => this.handlePhaseFilterChange(phase)
          );
        } else {
          this.ui.hidePhaseFilterChips();
        }

        // Hide clarifying chips for concept search
        this.ui.hideChips();

        // Generate and show Quick Reference card (both pathways)
        if (!this.activePhaseFilter && result.grouped && result.grouped.length > 0) {
          const quickRefData = this.generateQuickReference(result.concept, result.grouped);
          this.ui.renderQuickReference(quickRefData);
        } else {
          this.ui.hideQuickReference();
        }

        // Render grouped scenarios if we have groups
        if (result.grouped && result.grouped.length > 0 && !this.activePhaseFilter) {
          this.ui.renderGroupedScenarios(result.grouped, (scenario) => {
            this.handleScenarioSelect(scenario);
          });
        } else {
          // Render flat list
          this.ui.renderScenarios(result.scenarios, (scenario) => {
            this.handleScenarioSelect(scenario);
          });
        }

        this.ui.setStatus(`${result.scenarios.length} scenarios for "${result.concept.displayName}"`);
      } else {
        // Keyword search fallback
        this.currentConcept = null;
        this.ui.hideConceptHeader();
        this.ui.hidePhaseFilterChips();
        this.ui.hideQuickReference();

        // Check for ambiguity on fresh searches
        if (!isFilterChange) {
          const ambiguity = this.searchEngine.detectAmbiguity(query);
          if (ambiguity.isAmbiguous) {
            this.ui.showClarifyingChips(ambiguity.options, (selected, chipElement) => {
              this.handleClarification(selected, chipElement);
            });
          } else {
            this.ui.hideChips();
          }
        }

        // Build effective query (base + filter) for keyword search
        const effectiveQuery = this.activeFilter
          ? `${this.baseQuery} ${this.activeFilter}`
          : this.baseQuery;

        // Re-run keyword search with effective query if filter changed
        let scenarios = result.scenarios;
        if (isFilterChange && this.activeFilter) {
          const keywordResult = await this.searchEngine.search(effectiveQuery, { limit: 30 });
          scenarios = keywordResult.scenarios;
        }

        // Render scenarios in left panel
        this.ui.renderScenarios(scenarios, (scenario) => {
          this.handleScenarioSelect(scenario);
        });

        this.ui.setStatus(`${scenarios.length} scenarios found`);
      }

      // Add to query history if we got results
      if (result.scenarios.length > 0 && !isFilterChange) {
        this.addToQueryHistory(query);
      }
    } catch (error) {
      console.error('Search error:', error);
      this.ui.setStatus('Search failed', 'error');
    }
  }

  handlePhaseFilterChange(phase) {
    // Toggle filter - if same phase clicked, clear it
    if (this.activePhaseFilter === phase) {
      this.activePhaseFilter = null;
    } else {
      this.activePhaseFilter = phase;
    }

    // Re-run search with filter
    this.executeSearch(this.baseQuery, true);
  }

  /**
   * Generate Quick Reference data from grouped scenarios
   * Shows top recommendations for both Acute/Initial AND Follow-up pathways
   */
  generateQuickReference(concept, grouped) {
    const acutePhases = ['initial', 'screening', 'pretreatment'];
    const followupPhases = ['surveillance', 'complication'];

    // Collect top procedures from each pathway
    const acuteRecs = [];
    const followupRecs = [];

    for (const group of grouped) {
      const phase = group.phase?.toLowerCase() || '';
      const isAcute = acutePhases.includes(phase);
      const isFollowup = followupPhases.includes(phase);

      // Get top-rated procedures from scenarios in this group
      for (const scenario of group.scenarios) {
        const procedures = scenario.procedures || [];
        const topProcs = procedures
          .filter(p => p.rating >= 7 && p.name && p.modality)
          .sort((a, b) => b.rating - a.rating)
          .slice(0, 2);

        for (const proc of topProcs) {
          const rec = {
            name: proc.name || `${proc.modality}`,
            modality: proc.modality,
            rating: proc.rating,
            scenario: scenario.name
          };

          if (isAcute) {
            // Avoid duplicates by modality+name
            if (!acuteRecs.some(r => r.modality === rec.modality && r.name === rec.name)) {
              acuteRecs.push(rec);
            }
          } else if (isFollowup) {
            if (!followupRecs.some(r => r.modality === rec.modality && r.name === rec.name)) {
              followupRecs.push(rec);
            }
          }
        }
      }
    }

    // Sort by rating and take top 3
    acuteRecs.sort((a, b) => b.rating - a.rating);
    followupRecs.sort((a, b) => b.rating - a.rating);

    return {
      conceptName: concept.displayName,
      acute: acuteRecs.slice(0, 3),
      followup: followupRecs.slice(0, 3)
    };
  }

  handleScenarioSelect(scenario) {
    this.currentScenario = scenario;

    // Render procedures in right panel
    this.ui.renderProcedures(scenario, (procedure) => {
      this.handleProcedureSelect(procedure);
    });
  }

  async handleProcedureSelect(procedure) {
    // Only show MRI protocol card for MRI procedures
    if (procedure.modality !== 'MRI') {
      this.ui.hideMriProtocol();
      return;
    }

    this.ui.setStatus('Loading protocol...', 'loading');

    try {
      const result = await this.dataLoader.getProtocol(
        this.currentRegion,
        this.currentScenario,
        procedure
      );

      // getProtocol now returns { protocol, matchType, supplementalSequences }
      const protocol = result?.protocol || result; // Handle both old and new format
      const matchType = result?.matchType || 'suggested';
      const supplementalSequences = result?.supplementalSequences || null;

      this.ui.renderMriProtocol(protocol, procedure, matchType, supplementalSequences);
      this.ui.setStatus('Ready');
    } catch (error) {
      console.error('Protocol load error:', error);
      this.ui.showMriProtocolMessage(procedure);
      this.ui.setStatus('Ready');
    }
  }

  handleClarification(clarification, chipElement) {
    // Toggle filter - if same filter clicked, deselect it
    if (this.activeFilter === clarification) {
      this.activeFilter = null;
    } else {
      this.activeFilter = clarification;
    }

    // Re-run search with filter (keeps chips visible)
    this.executeSearch(this.baseQuery, true);
  }

  /**
   * Handle urgency override when user clicks "change" on assumed context banner
   * Shows a simple dialog to let user select different urgency
   */
  handleUrgencyOverride(intent) {
    const currentUrgency = intent.urgency;
    const condition = intent.matchedCondition;

    // Create urgency options
    const urgencies = [
      { value: 'acute', label: 'Acute / Emergent', desc: 'Immediate workup needed' },
      { value: 'routine', label: 'Routine / Elective', desc: 'Standard outpatient workup' },
      { value: 'chronic', label: 'Chronic / Ongoing', desc: 'Longstanding condition' }
    ];

    // Build option buttons HTML
    const optionsHtml = urgencies.map(u => {
      const isSelected = u.value === currentUrgency ? 'selected' : '';
      return `
        <button class="urgency-option ${isSelected}" data-urgency="${u.value}">
          <strong>${u.label}</strong>
          <span>${u.desc}</span>
        </button>
      `;
    }).join('');

    // Create modal overlay
    const modal = document.createElement('div');
    modal.className = 'urgency-override-modal';
    modal.innerHTML = `
      <div class="urgency-override-dialog">
        <div class="urgency-override-header">
          <h3>Change Context for "${condition}"</h3>
          <button class="urgency-override-close">&times;</button>
        </div>
        <div class="urgency-override-body">
          <p>Select the clinical context that best matches your search:</p>
          <div class="urgency-options">
            ${optionsHtml}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Handle option selection
    modal.querySelectorAll('.urgency-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const selectedUrgency = btn.dataset.urgency;

        // Update the search with explicit urgency modifier
        const urgencyKeyword = selectedUrgency === 'acute' ? 'acute' :
                              selectedUrgency === 'routine' ? 'routine outpatient' :
                              'chronic';

        // Add urgency to search query
        const newQuery = `${urgencyKeyword} ${this.baseQuery}`;
        document.getElementById('searchInput').value = newQuery;
        this.baseQuery = newQuery;

        // Close modal and re-search
        modal.remove();
        this.executeSearch(newQuery, false);
      });
    });

    // Handle close
    modal.querySelector('.urgency-override-close').addEventListener('click', () => {
      modal.remove();
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  clearSearch() {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchClear').classList.add('hidden');
    this.ui.clearScenarios();
    this.ui.hideChips();
    this.ui.hidePhaseFilterChips();
    this.ui.hideConceptHeader();
    this.ui.hideAssumedContextBanner();
    this.ui.hideDifferential();
    this.ui.hideMriProtocol();
    this.currentScenario = null;
    this.lastDifferentialQuery = '';
    this.baseQuery = '';
    this.activeFilter = null;
    this.activePhaseFilter = null;
    this.currentConcept = null;
    this.radlite.clearCache(); // Clear RadLITE cache
  }

  handleNavClick(e) {
    const view = e.target.dataset.view;
    if (view === this.currentView) return;

    // Update nav button states
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.view === view);
    });

    this.currentView = view;
    this.switchView(view);
  }

  async switchView(view) {
    const anatomySection = document.querySelector('.anatomy-section');
    const searchSection = document.getElementById('searchSection');
    const protocolsSection = document.getElementById('protocolsSection');
    const builderSection = document.getElementById('builderSection');

    if (view === 'search') {
      // Switch to Search view
      protocolsSection.classList.add('fade-out');
      builderSection.classList.add('fade-out');

      setTimeout(() => {
        protocolsSection.classList.add('hidden');
        builderSection.classList.add('hidden');
        protocolsSection.classList.remove('fade-out');
        builderSection.classList.remove('fade-out');

        // Show anatomy section (unless we're in a region search)
        if (!this.currentRegion) {
          anatomySection.classList.remove('hidden');
        } else {
          searchSection.classList.remove('hidden');
        }

        this.ui.setStatus('Ready');
      }, 300);

    } else if (view === 'protocols') {
      // Switch to Protocols view
      anatomySection.classList.add('fade-out');
      searchSection.classList.add('fade-out');
      builderSection.classList.add('fade-out');

      setTimeout(async () => {
        anatomySection.classList.add('hidden');
        searchSection.classList.add('hidden');
        builderSection.classList.add('hidden');
        anatomySection.classList.remove('fade-out');
        searchSection.classList.remove('fade-out');
        builderSection.classList.remove('fade-out');

        protocolsSection.classList.remove('hidden');

        // Load and display all protocols
        await this.loadProtocolsView();
      }, 300);

    } else if (view === 'builder') {
      // Switch to Builder view
      anatomySection.classList.add('fade-out');
      searchSection.classList.add('fade-out');
      protocolsSection.classList.add('fade-out');

      setTimeout(async () => {
        anatomySection.classList.add('hidden');
        searchSection.classList.add('hidden');
        protocolsSection.classList.add('hidden');
        anatomySection.classList.remove('fade-out');
        searchSection.classList.remove('fade-out');
        protocolsSection.classList.remove('fade-out');

        builderSection.classList.remove('hidden');

        // Load builder view
        await this.loadBuilderView();
      }, 300);
    }
  }

  async loadProtocolsView() {
    this.ui.setStatus('Loading protocols...', 'loading');

    try {
      // Load protocols if not cached
      if (!this.allProtocols) {
        this.allProtocols = await this.dataLoader.loadProtocols();
      }

      // Display all protocols in grid
      this.renderProtocolGrid(this.allProtocols);
      this.ui.setStatus(`${this.allProtocols.length} protocols available`);

      // Focus search input
      document.getElementById('protocolSearchInput').focus();
    } catch (error) {
      console.error('Failed to load protocols:', error);
      this.ui.setStatus('Failed to load protocols', 'error');
    }
  }

  handleProtocolSearch(query) {
    // Toggle clear button
    document.getElementById('protocolSearchClear').classList.toggle('hidden', !query);

    // Debounce search
    clearTimeout(this.protocolDebounceTimer);
    this.protocolDebounceTimer = setTimeout(() => this.executeProtocolSearch(query), 150);
  }

  executeProtocolSearch(query) {
    this.protocolSearchQuery = query.trim();
    this.applyProtocolFilters();
  }

  renderProtocolGrid(protocols) {
    const grid = document.getElementById('protocolGrid');

    if (protocols.length === 0) {
      grid.innerHTML = `
        <div class="protocol-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <p>No protocols found</p>
          <p class="suggestion">Try adjusting your filters or search terms</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = protocols.map((protocol, index) => {
      const seqCount = protocol.sequences?.length || 0;
      const hasContrast = protocol.uses_contrast;
      const region = protocol.body_region || protocol.section || 'General';
      const indications = protocol.indications || '';
      const scanTime = this.estimateScanTime(protocol);
      const isBookmarked = this.isBookmarked(protocol.name);
      const highlightedName = this.highlightSearchTerm(protocol.display_name || protocol.name);
      const isAIEnhanced = this.isAIGenerated(protocol);

      return `
        <div class="protocol-grid-card ${isBookmarked ? 'bookmarked' : ''}" data-index="${index}" style="position: relative;">
          ${isBookmarked ? `
            <div class="bookmark-indicator">
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
              </svg>
            </div>
          ` : ''}
          <div class="protocol-grid-card-name">${highlightedName}</div>
          <div class="protocol-grid-card-meta">
            <span class="protocol-grid-card-region">${this.escapeHtml(region)}</span>
            ${hasContrast ? '<span class="contrast-badge with-contrast">Contrast</span>' : ''}
            <span class="source-badge ${isAIEnhanced ? 'suggested' : 'curated'}" title="${isAIEnhanced ? 'Suggested protocol - verify before clinical use' : 'Protocol verified by radiologists'}">
              ${isAIEnhanced ? 'Suggested' : 'Verified'}
            </span>
          </div>
          ${indications ? `<div class="protocol-grid-card-indications">${this.escapeHtml(indications)}</div>` : ''}
          <div class="protocol-grid-card-footer">
            <div class="protocol-grid-card-sequences">
              <span>${seqCount}</span> sequences
            </div>
            <div class="protocol-grid-card-time">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
              ${scanTime}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Bind click events
    grid.querySelectorAll('.protocol-grid-card').forEach((card, index) => {
      card.addEventListener('click', () => {
        this.showProtocolDetail(protocols[index]);
      });
    });
  }

  renderProtocolGrouped(protocols) {
    const grid = document.getElementById('protocolGrid');

    if (protocols.length === 0) {
      grid.innerHTML = `
        <div class="protocol-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <p>No protocols found</p>
          <p class="suggestion">Try adjusting your filters or search terms</p>
        </div>
      `;
      return;
    }

    // Group by region
    const groups = {};
    const regionOrder = ['neuro', 'spine', 'msk', 'abdomen', 'chest', 'vascular', 'breast', 'other'];

    protocols.forEach(protocol => {
      const region = (protocol.body_region || 'other').toLowerCase();
      if (!groups[region]) {
        groups[region] = [];
      }
      groups[region].push(protocol);
    });

    const regionNames = {
      neuro: 'Neuro',
      spine: 'Spine',
      msk: 'Musculoskeletal',
      abdomen: 'Abdomen',
      chest: 'Chest',
      vascular: 'Vascular',
      breast: 'Breast',
      other: 'Other'
    };

    grid.innerHTML = `<div class="protocol-grouped-view">
      ${regionOrder
        .filter(region => groups[region]?.length > 0)
        .map(region => {
          const regionProtocols = groups[region];
          return `
            <div class="protocol-group" data-region="${region}">
              <div class="protocol-group-header">
                <div class="protocol-group-title">
                  ${regionNames[region] || region}
                  <span class="protocol-group-count">${regionProtocols.length}</span>
                </div>
                <div class="protocol-group-toggle">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </div>
              </div>
              <div class="protocol-group-content">
                <div class="protocol-group-list">
                  ${regionProtocols.map((protocol, idx) => {
                    const hasContrast = protocol.uses_contrast;
                    const seqCount = protocol.sequences?.length || 0;
                    const isBookmarked = this.isBookmarked(protocol.name);
                    const isAIEnhanced = this.isAIGenerated(protocol);
                    return `
                      <div class="protocol-list-item ${isBookmarked ? 'bookmarked' : ''}" data-region="${region}" data-index="${idx}">
                        <span class="protocol-list-item-name">${this.escapeHtml(protocol.display_name || protocol.name)}</span>
                        <div class="protocol-list-item-meta">
                          ${isBookmarked ? '<span class="contrast-badge with-contrast" style="background: var(--accent-muted); color: var(--accent);">Saved</span>' : ''}
                          ${hasContrast ? '<span class="contrast-badge with-contrast">Contrast</span>' : ''}
                          <span class="source-badge ${isAIEnhanced ? 'suggested' : 'curated'}">${isAIEnhanced ? 'Suggested' : 'Verified'}</span>
                          <span class="protocol-grid-card-sequences"><span>${seqCount}</span> seq</span>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            </div>
          `;
        }).join('')}
    </div>`;

    // Bind group toggle events
    grid.querySelectorAll('.protocol-group-header').forEach(header => {
      header.addEventListener('click', () => {
        header.parentElement.classList.toggle('collapsed');
      });
    });

    // Bind item click events
    grid.querySelectorAll('.protocol-list-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const region = item.dataset.region;
        const index = parseInt(item.dataset.index);
        this.showProtocolDetail(groups[region][index]);
      });
    });
  }

  highlightSearchTerm(text) {
    if (!this.protocolSearchQuery || !text) {
      return this.escapeHtml(text);
    }
    const escaped = this.escapeHtml(text);
    const query = this.protocolSearchQuery.toLowerCase();
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escaped.replace(regex, '<span class="search-highlight">$1</span>');
  }

  showProtocolDetail(protocol) {
    this.currentProtocol = protocol;

    const resultsDiv = document.getElementById('protocolResults');
    const detailDiv = document.getElementById('protocolDetail');
    const searchContainer = document.querySelector('.protocol-search-container');
    const filtersContainer = document.querySelector('.protocol-filters');

    // Hide grid, search, and filters, show detail
    resultsDiv.classList.add('hidden');
    searchContainer.classList.add('hidden');
    if (filtersContainer) filtersContainer.classList.add('hidden');
    detailDiv.classList.remove('hidden');

    // Populate detail view
    document.getElementById('protocolDetailName').textContent = protocol.display_name || protocol.name;

    // Contrast badge
    const contrastBadge = document.getElementById('protocolDetailContrast');
    contrastBadge.textContent = protocol.uses_contrast ? 'With Contrast' : 'No Contrast';
    contrastBadge.className = `contrast-badge ${protocol.uses_contrast ? 'with-contrast' : 'no-contrast'}`;

    // Region badge
    document.getElementById('protocolDetailRegion').textContent = protocol.body_region || protocol.section || 'General';

    // Source badge - indicate if protocol was AI-generated de novo
    const sourceBadge = document.getElementById('protocolDetailSource');
    const sourceText = document.getElementById('protocolDetailSourceText');
    if (sourceBadge && sourceText) {
      const isAI = this.isAIGenerated(protocol);
      if (isAI) {
        sourceBadge.classList.remove('curated');
        sourceBadge.classList.add('suggested');
        sourceBadge.title = 'Suggested protocol - verify before clinical use';
        sourceText.textContent = 'Suggested';
      } else {
        sourceBadge.classList.remove('suggested');
        sourceBadge.classList.add('curated');
        sourceBadge.title = 'Protocol verified by radiologists';
        sourceText.textContent = 'Human Verified';
      }
    }

    // Scan time badge
    document.getElementById('protocolDetailTime').textContent = this.estimateScanTime(protocol);

    // Update bookmark button state
    const bookmarkBtn = document.getElementById('bookmarkProtocolBtn');
    const isBookmarked = this.isBookmarked(protocol.name);
    bookmarkBtn.classList.toggle('active', isBookmarked);
    bookmarkBtn.querySelector('span').textContent = isBookmarked ? 'Bookmarked' : 'Bookmark';

    // Indications
    document.getElementById('protocolDetailIndications').textContent = protocol.indications || 'General imaging protocol';

    // Sequences Timeline
    const sequences = protocol.sequences || [];
    this.renderSequenceTimeline(sequences, protocol.uses_contrast);

    // Sequences List
    const sequencesDiv = document.getElementById('protocolDetailSequences');
    if (sequences.length > 0) {
      sequencesDiv.innerHTML = sequences.map((seq, i) => {
        const isPost = seq.is_post_contrast;
        return `
          <div class="protocol-sequence-item ${isPost ? 'post-contrast' : ''}">
            <span class="sequence-number">${i + 1}</span>
            <span class="sequence-name">${this.escapeHtml(seq.sequence_name)}</span>
            ${isPost ? '<span class="sequence-contrast-label">Post-Contrast</span>' : ''}
          </div>
        `;
      }).join('');
    } else {
      sequencesDiv.innerHTML = '<p class="empty-state">No sequences defined</p>';
    }

    // Contrast rationale
    const rationaleSection = document.getElementById('protocolDetailContrastSection');
    const rationaleText = document.getElementById('protocolDetailRationale');
    if (protocol.contrast_rationale && protocol.uses_contrast) {
      rationaleSection.classList.remove('hidden');
      rationaleText.textContent = protocol.contrast_rationale;
    } else {
      rationaleSection.classList.add('hidden');
    }

    // Scanner notes
    const notesSection = document.getElementById('protocolDetailNotesSection');
    const notesDiv = document.getElementById('protocolDetailNotes');
    const notes = protocol.scanner_notes || [];
    if (notes.length > 0) {
      notesSection.classList.remove('hidden');
      notesDiv.innerHTML = notes.map(note => `<div class="scanner-note">${this.escapeHtml(note)}</div>`).join('');
    } else {
      notesSection.classList.add('hidden');
    }

    // Related protocols
    this.renderRelatedProtocols(protocol);

    // Render enrichment sections if available
    this.renderEnrichmentSections(protocol);
  }

  renderEnrichmentSections(protocol) {
    const enrichment = protocol.enrichment;

    // Clinical Pearls
    const pearlsSection = document.getElementById('protocolDetailPearlsSection');
    const pearlsDiv = document.getElementById('protocolDetailPearls');
    if (enrichment?.clinical_pearls?.length > 0) {
      pearlsSection.classList.remove('hidden');
      pearlsDiv.innerHTML = enrichment.clinical_pearls
        .map(pearl => `<li class="clinical-pearl-item">${this.escapeHtml(pearl)}</li>`)
        .join('');
    } else {
      pearlsSection.classList.add('hidden');
    }

    // Patient Prep
    const prepSection = document.getElementById('protocolDetailPrepSection');
    const prepDiv = document.getElementById('protocolDetailPrep');
    if (enrichment?.patient_prep) {
      prepSection.classList.remove('hidden');
      const prep = enrichment.patient_prep;
      let prepHtml = '<div class="prep-items">';

      // Key prep items as badges/chips
      if (prep.npo_required) {
        prepHtml += `<div class="prep-badge warning">NPO ${prep.npo_hours ? prep.npo_hours + ' hours' : 'required'}</div>`;
      }
      if (prep.contrast_screening_required) {
        prepHtml += `<div class="prep-badge">Contrast screening required</div>`;
      }
      if (prep.breath_hold_required) {
        prepHtml += `<div class="prep-badge">Breath hold required</div>`;
      }
      if (prep.claustrophobia_concern && prep.claustrophobia_concern !== 'none') {
        prepHtml += `<div class="prep-badge">${prep.claustrophobia_concern} claustrophobia concern</div>`;
      }
      if (prep.estimated_table_time_minutes) {
        prepHtml += `<div class="prep-badge info">Table time: ~${prep.estimated_table_time_minutes} min</div>`;
      }
      prepHtml += '</div>';

      // Special instructions
      if (prep.special_instructions?.length > 0) {
        prepHtml += '<div class="prep-instructions"><strong>Instructions:</strong><ul>';
        prep.special_instructions.forEach(inst => {
          prepHtml += `<li>${this.escapeHtml(inst)}</li>`;
        });
        prepHtml += '</ul></div>';
      }

      prepDiv.innerHTML = prepHtml;
    } else {
      prepSection.classList.add('hidden');
    }

    // Contraindications
    const contraSection = document.getElementById('protocolDetailContraSection');
    const contraDiv = document.getElementById('protocolDetailContra');
    if (enrichment?.contraindications) {
      const contra = enrichment.contraindications;
      const hasContent = contra.absolute?.length > 0 || contra.relative?.length > 0;

      if (hasContent) {
        contraSection.classList.remove('hidden');
        let contraHtml = '';

        if (contra.absolute?.length > 0) {
          contraHtml += '<div class="contra-group"><h4 class="contra-title absolute">Absolute</h4><ul>';
          contra.absolute.forEach(c => {
            contraHtml += `<li>${this.escapeHtml(c)}</li>`;
          });
          contraHtml += '</ul></div>';
        }

        if (contra.relative?.length > 0) {
          contraHtml += '<div class="contra-group"><h4 class="contra-title relative">Relative</h4><ul>';
          contra.relative.forEach(c => {
            contraHtml += `<li>${this.escapeHtml(c)}</li>`;
          });
          contraHtml += '</ul></div>';
        }

        if (contra.gfr_cutoff) {
          contraHtml += `<div class="contra-note">GFR cutoff: ${contra.gfr_cutoff} mL/min</div>`;
        }

        if (contra.pregnancy_considerations) {
          contraHtml += `<div class="contra-note pregnancy"><strong>Pregnancy:</strong> ${this.escapeHtml(contra.pregnancy_considerations)}</div>`;
        }

        contraDiv.innerHTML = contraHtml;
      } else {
        contraSection.classList.add('hidden');
      }
    } else {
      contraSection.classList.add('hidden');
    }

    // Red Flags
    const redFlagsSection = document.getElementById('protocolDetailRedFlagsSection');
    const redFlagsDiv = document.getElementById('protocolDetailRedFlags');
    if (enrichment?.red_flags?.length > 0) {
      redFlagsSection.classList.remove('hidden');
      redFlagsDiv.innerHTML = enrichment.red_flags
        .map(flag => `<li class="red-flag-item">${this.escapeHtml(flag)}</li>`)
        .join('');
    } else {
      redFlagsSection.classList.add('hidden');
    }

    // Sequence Rationale
    const rationaleSection = document.getElementById('protocolDetailRationaleSection');
    const rationaleDiv = document.getElementById('protocolDetailSeqRationale');
    if (enrichment?.sequence_rationale?.length > 0) {
      rationaleSection.classList.remove('hidden');
      rationaleDiv.innerHTML = enrichment.sequence_rationale
        .map(seq => `
          <div class="seq-rationale-item">
            <div class="seq-rationale-name">${this.escapeHtml(seq.sequence)}</div>
            <div class="seq-rationale-purpose">${this.escapeHtml(seq.purpose)}</div>
            <div class="seq-rationale-findings"><strong>Key findings:</strong> ${this.escapeHtml(seq.key_findings)}</div>
          </div>
        `).join('');
    } else {
      rationaleSection.classList.add('hidden');
    }

    // When to Upgrade/Downgrade
    const upgradeSection = document.getElementById('protocolDetailUpgradeSection');
    const upgradeDiv = document.getElementById('protocolDetailUpgrade');
    const hasUpgrade = enrichment?.when_to_upgrade?.length > 0;
    const hasDowngrade = enrichment?.when_to_downgrade?.length > 0;

    if (hasUpgrade || hasDowngrade) {
      upgradeSection.classList.remove('hidden');
      let upgradeHtml = '';

      if (hasUpgrade) {
        upgradeHtml += '<div class="mod-group"><h4 class="mod-title upgrade">When to Upgrade</h4><ul>';
        enrichment.when_to_upgrade.forEach(item => {
          upgradeHtml += `<li>${this.escapeHtml(item)}</li>`;
        });
        upgradeHtml += '</ul></div>';
      }

      if (hasDowngrade) {
        upgradeHtml += '<div class="mod-group"><h4 class="mod-title downgrade">When to Simplify</h4><ul>';
        enrichment.when_to_downgrade.forEach(item => {
          upgradeHtml += `<li>${this.escapeHtml(item)}</li>`;
        });
        upgradeHtml += '</ul></div>';
      }

      upgradeDiv.innerHTML = upgradeHtml;
    } else {
      upgradeSection.classList.add('hidden');
    }

    // Alternative Protocols
    const altSection = document.getElementById('protocolDetailAlternativesSection');
    const altDiv = document.getElementById('protocolDetailAlternatives');
    if (enrichment?.alternative_protocols?.length > 0) {
      altSection.classList.remove('hidden');
      altDiv.innerHTML = enrichment.alternative_protocols
        .map(alt => `
          <div class="alt-protocol-item">
            <div class="alt-protocol-name">${this.escapeHtml(alt.protocol)}</div>
            <div class="alt-protocol-when">${this.escapeHtml(alt.when_to_use)}</div>
          </div>
        `).join('');
    } else {
      altSection.classList.add('hidden');
    }
  }

  renderSequenceTimeline(sequences, hasContrast) {
    const timelineDiv = document.getElementById('protocolDetailTimeline');

    if (!sequences || sequences.length === 0) {
      timelineDiv.innerHTML = '';
      return;
    }

    // Find where contrast injection happens
    const firstPostContrastIdx = sequences.findIndex(s => s.is_post_contrast);
    const hasPostContrast = firstPostContrastIdx > -1;

    let html = '';

    sequences.forEach((seq, i) => {
      const isPost = seq.is_post_contrast;
      const segmentClass = isPost ? 'post-contrast' : 'pre-contrast';

      // Add contrast injection marker before first post-contrast sequence
      if (hasContrast && hasPostContrast && i === firstPostContrastIdx) {
        html += `
          <div class="timeline-connector to-contrast"></div>
          <div class="timeline-segment contrast-injection">
            <div class="timeline-dot"></div>
            <span class="timeline-label">Contrast</span>
          </div>
          <div class="timeline-connector from-contrast"></div>
        `;
      } else if (i > 0) {
        html += `<div class="timeline-connector"></div>`;
      }

      // Shorten sequence name for timeline
      const shortName = seq.sequence_name.length > 12
        ? seq.sequence_name.substring(0, 10) + '...'
        : seq.sequence_name;

      html += `
        <div class="timeline-segment ${segmentClass}">
          <div class="timeline-dot"></div>
          <span class="timeline-label">${this.escapeHtml(shortName)}</span>
        </div>
      `;
    });

    timelineDiv.innerHTML = html;
  }

  renderRelatedProtocols(protocol) {
    const relatedSection = document.getElementById('protocolDetailRelatedSection');
    const relatedDiv = document.getElementById('protocolDetailRelated');

    if (!this.allProtocols) {
      relatedSection.classList.add('hidden');
      return;
    }

    // Find related protocols: same region, different protocol
    const related = this.allProtocols.filter(p => {
      if (p.name === protocol.name) return false;
      if (p.body_region !== protocol.body_region) return false;
      return true;
    }).slice(0, 4); // Limit to 4

    if (related.length === 0) {
      relatedSection.classList.add('hidden');
      return;
    }

    relatedSection.classList.remove('hidden');
    relatedDiv.innerHTML = related.map((p, idx) => {
      const seqCount = p.sequences?.length || 0;
      return `
        <div class="related-protocol-card" data-related-index="${idx}">
          <div class="related-protocol-name">${this.escapeHtml(p.display_name || p.name)}</div>
          <div class="related-protocol-meta">
            ${p.uses_contrast ? 'Contrast' : 'No contrast'} - ${seqCount} sequences
          </div>
        </div>
      `;
    }).join('');

    // Bind click events
    relatedDiv.querySelectorAll('.related-protocol-card').forEach((card, idx) => {
      card.addEventListener('click', () => {
        this.showProtocolDetail(related[idx]);
      });
    });
  }

  hideProtocolDetail() {
    const resultsDiv = document.getElementById('protocolResults');
    const detailDiv = document.getElementById('protocolDetail');
    const searchContainer = document.querySelector('.protocol-search-container');
    const filtersContainer = document.querySelector('.protocol-filters');

    detailDiv.classList.add('hidden');
    resultsDiv.classList.remove('hidden');
    searchContainer.classList.remove('hidden');
    if (filtersContainer) filtersContainer.classList.remove('hidden');

    this.currentProtocol = null;

    // Re-apply filters to refresh view (in case bookmarks changed)
    this.applyProtocolFilters();
  }

  clearProtocolSearch() {
    document.getElementById('protocolSearchInput').value = '';
    document.getElementById('protocolSearchClear').classList.add('hidden');
    this.protocolSearchQuery = '';
    this.applyProtocolFilters();
  }

  escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ========================================
  // Real-time Search Suggestions
  // ========================================
  
  initSearchSuggestions() {
    const globalSearchInput = document.getElementById('globalSearchInput');
    if (!globalSearchInput) return;

    // Create suggestions dropdown
    const suggestionsDiv = document.createElement('div');
    suggestionsDiv.className = 'search-suggestions hidden';
    suggestionsDiv.id = 'searchSuggestions';
    globalSearchInput.parentNode.appendChild(suggestionsDiv);

    // Debounced input handler
    let debounceTimer;
    globalSearchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const query = e.target.value.trim().toLowerCase();
      
      if (query.length < 2) {
        this.hideSuggestions();
        return;
      }

      debounceTimer = setTimeout(() => {
        this.showSuggestions(query);
      }, 150);
    });

    // Hide on blur (with delay for click handling)
    globalSearchInput.addEventListener('blur', () => {
      setTimeout(() => this.hideSuggestions(), 200);
    });

    // Show on focus if has value
    globalSearchInput.addEventListener('focus', (e) => {
      const query = e.target.value.trim().toLowerCase();
      if (query.length >= 2) {
        this.showSuggestions(query);
      }
    });

    // Keyboard navigation
    globalSearchInput.addEventListener('keydown', (e) => {
      const suggestions = document.getElementById('searchSuggestions');
      if (!suggestions || suggestions.classList.contains('hidden')) return;

      const items = suggestions.querySelectorAll('.suggestion-item');
      const activeItem = suggestions.querySelector('.suggestion-item.active');
      let activeIndex = Array.from(items).indexOf(activeItem);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
        this.setActiveSuggestion(items, activeIndex);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        this.setActiveSuggestion(items, activeIndex);
      } else if (e.key === 'Enter' && activeItem) {
        e.preventDefault();
        activeItem.click();
      } else if (e.key === 'Escape') {
        this.hideSuggestions();
      }
    });
  }

  showSuggestions(query) {
    const suggestions = document.getElementById('searchSuggestions');
    if (!suggestions || !this.summaryCards) return;

    // Find matching cards
    const matches = this.summaryCards.cards
      .filter(card => {
        const topic = (card.topic || '').toLowerCase();
        const display = (card.display_name || '').toLowerCase();
        return topic.includes(query) || display.includes(query);
      })
      .slice(0, 6);

    if (matches.length === 0) {
      this.hideSuggestions();
      return;
    }

    let html = '';
    for (let i = 0; i < matches.length; i++) {
      const card = matches[i];
      const rec = card.primary_recommendation || {};
      const modality = rec.modality || '';
      const rating = rec.rating || '';
      const displayName = card.display_name || card.topic;
      const activeClass = i === 0 ? ' active' : '';
      html += '<div class="suggestion-item' + activeClass + '" data-topic="' + card.topic + '">';
      html += '<span class="suggestion-topic">' + displayName + '</span>';
      html += '<span class="suggestion-meta">' + modality + (rating ? ' � ' + rating : '') + '</span>';
      html += '</div>';
    }
    suggestions.innerHTML = html;

    // Add click handlers
    suggestions.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', () => {
        const topic = item.dataset.topic;
        document.getElementById('globalSearchInput').value = topic;
        this.handleGlobalSearch(topic);
        this.hideSuggestions();
      });
    });

    suggestions.classList.remove('hidden');
  }

  hideSuggestions() {
    const suggestions = document.getElementById('searchSuggestions');
    if (suggestions) {
      suggestions.classList.add('hidden');
    }
  }

  setActiveSuggestion(items, index) {
    items.forEach((item, i) => {
      item.classList.toggle('active', i === index);
    });
  }

  formatRegionName(region) {
    const names = {
      neuro: 'Neuro',
      spine: 'Spine',
      chest: 'Chest',
      abdomen: 'Abdomen',
      msk: 'Musculoskeletal',
      vascular: 'Vascular',
      breast: 'Breast',
      peds: 'Pediatric'
    };
    return names[region] || region;
  }

  // ==========================================
  // Protocol Builder Methods
  // ==========================================

  async loadBuilderView() {
    this.ui.setStatus('Loading builder...', 'loading');

    try {
      // Load sequence library
      await this.protocolBuilder.loadSequenceLibrary();

      // Render templates and my protocols list
      this.renderTemplates();
      this.renderMyProtocols();

      // Bind builder events if not already bound
      this.bindBuilderEvents();

      this.ui.setStatus('Builder ready');
    } catch (error) {
      console.error('Failed to load builder:', error);
      this.ui.setStatus('Failed to load builder', 'error');
    }
  }

  bindBuilderEvents() {
    // Only bind once
    if (this.builderEventsBound) return;
    this.builderEventsBound = true;

    // New Protocol button
    const newBtn = document.getElementById('newProtocolBtn');
    if (newBtn) {
      newBtn.addEventListener('click', () => this.startNewProtocol());
    }

    // Editor back button
    const editorBackBtn = document.getElementById('editorBackBtn');
    if (editorBackBtn) {
      editorBackBtn.addEventListener('click', () => this.cancelProtocolEdit());
    }

    // Save button
    const saveBtn = document.getElementById('saveProtocolBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveCurrentProtocol());
    }

    // Contrast toggle (updated for with/without/both) - Builder specific
    const builderContrastToggle = document.getElementById('builderContrastToggle');
    if (builderContrastToggle) {
      builderContrastToggle.querySelectorAll('.toggle-option').forEach(btn => {
        btn.addEventListener('click', () => {
          builderContrastToggle.querySelectorAll('.toggle-option').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.protocolBuilder.contrastMode = btn.dataset.contrast; // 'without', 'with', or 'both'
          // Re-render sequence library to show/hide contrast sequences
          this.renderSequenceLibrary(document.getElementById('sequenceSearchInput')?.value || '');
        });
      });
    }

    // Scope tags input with auto-suggest
    const scopeInput = document.getElementById('protocolScopeInput');
    const scopeSuggestions = document.getElementById('scopeSuggestions');
    if (scopeInput && scopeSuggestions) {
      scopeInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        if (query.length > 0) {
          this.showScopeSuggestions(query);
        } else {
          scopeSuggestions.classList.add('hidden');
        }
      });

      scopeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const tag = scopeInput.value.trim().toLowerCase();
          if (tag && !this.protocolBuilder.scopeTags.includes(tag)) {
            this.protocolBuilder.addScopeTag(tag);
            this.renderScopeTags();
            this.renderProtocolSequences();
          }
          scopeInput.value = '';
          scopeSuggestions.classList.add('hidden');
        } else if (e.key === 'Escape') {
          scopeSuggestions.classList.add('hidden');
        }
      });

      scopeInput.addEventListener('blur', () => {
        // Delay hide to allow click on suggestion
        setTimeout(() => scopeSuggestions.classList.add('hidden'), 200);
      });
    }

    // Sequence search
    const seqSearch = document.getElementById('sequenceSearchInput');
    if (seqSearch) {
      seqSearch.addEventListener('input', (e) => this.filterSequenceLibrary(e.target.value));
    }

    const seqSearchClear = document.getElementById('sequenceSearchClear');
    if (seqSearchClear) {
      seqSearchClear.addEventListener('click', () => {
        seqSearch.value = '';
        seqSearchClear.classList.add('hidden');
        this.filterSequenceLibrary('');
      });
    }

    // Sequence filter chips
    document.querySelectorAll('.sequence-filters .filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.sequence-filters .filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.currentSequenceFilter = chip.dataset.filter;
        this.filterSequenceLibrary(seqSearch?.value || '');
      });
    });

    // Rationale close button
    const rationaleClose = document.getElementById('rationaleClose');
    if (rationaleClose) {
      rationaleClose.addEventListener('click', () => {
        document.getElementById('rationalePanel').classList.add('hidden');
        this.protocolBuilder.selectedRationale = null;
      });
    }

    // Export protocol button
    const exportBtn = document.getElementById('exportProtocolBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportCurrentProtocol());
    }

    // Print protocol button
    const printBtn = document.getElementById('printProtocolBtn');
    if (printBtn) {
      printBtn.addEventListener('click', () => this.printCurrentProtocol());
    }
  }

  renderMyProtocols() {
    const grid = document.getElementById('myProtocolsGrid');
    const protocols = this.protocolBuilder.getAllCustomProtocols();
    const noProtocolsMsg = document.getElementById('noProtocolsMessage');

    if (protocols.length === 0) {
      grid.innerHTML = '';
      grid.appendChild(noProtocolsMsg);
      noProtocolsMsg.classList.remove('hidden');
      return;
    }

    noProtocolsMsg.classList.add('hidden');

    grid.innerHTML = protocols.map(protocol => {
      const sequenceCount = protocol.sequences?.length || 0;
      const timeStr = this.protocolBuilder.formatTime(protocol.total_time_seconds || 0);
      const regionName = this.formatRegionName(protocol.body_region);
      const contrastMode = protocol.contrast_mode || (protocol.uses_contrast ? 'with' : 'without');
      const contrastLabel = contrastMode === 'both' ? 'With/Without' : (contrastMode === 'with' ? 'With Contrast' : 'No Contrast');
      const scopeTags = protocol.scope_tags || [];

      return `
        <div class="custom-protocol-card" data-protocol-id="${protocol.id}">
          <span class="custom-badge">Custom</span>
          <div class="custom-protocol-card-name">${this.escapeHtml(protocol.name)}</div>
          <div class="custom-protocol-card-meta">
            <span class="meta-item">${regionName}</span>
            <span class="meta-item">${contrastLabel}</span>
          </div>
          ${scopeTags.length > 0 ? `
            <div class="custom-protocol-card-scope">
              ${scopeTags.map(tag => `<span class="scope-tag-mini">${this.escapeHtml(tag)}</span>`).join('')}
            </div>
          ` : ''}
          <div class="custom-protocol-card-sequences">
            ${sequenceCount} sequence${sequenceCount !== 1 ? 's' : ''} - ${timeStr}
          </div>
          <div class="custom-protocol-card-actions">
            <button class="card-action-btn edit-btn" data-id="${protocol.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Edit
            </button>
            <button class="card-action-btn duplicate-btn" data-id="${protocol.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
              Copy
            </button>
            <button class="card-action-btn delete delete-btn" data-id="${protocol.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              </svg>
              Delete
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Bind card action events
    grid.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.editProtocol(btn.dataset.id);
      });
    });

    grid.querySelectorAll('.duplicate-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.duplicateProtocol(btn.dataset.id);
      });
    });

    grid.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteProtocol(btn.dataset.id);
      });
    });
  }

  renderTemplates() {
    const grid = document.getElementById('templatesGrid');
    if (!grid) return;

    const templates = this.protocolBuilder.getTemplates();

    grid.innerHTML = templates.map(template => {
      const regionName = this.formatRegionName(template.region);
      const contrastLabel = template.contrast_mode === 'both' ? 'W/ + W/O Contrast' :
                           (template.contrast_mode === 'with' ? 'With Contrast' : 'No Contrast');
      const seqCount = template.sequences?.length || 0;

      return `
        <button class="template-card" data-template-id="${template.id}">
          <div class="template-card-name">${this.escapeHtml(template.name)}</div>
          <div class="template-card-desc">${this.escapeHtml(template.description)}</div>
          <div class="template-card-meta">
            <span class="meta-item">${regionName}</span>
            <span class="meta-divider">-</span>
            <span class="meta-item">${seqCount} seq</span>
            <span class="meta-divider">-</span>
            <span class="meta-item">${contrastLabel}</span>
          </div>
        </button>
      `;
    }).join('');

    // Bind template click events
    grid.querySelectorAll('.template-card').forEach(card => {
      card.addEventListener('click', () => {
        this.startFromTemplate(card.dataset.templateId);
      });
    });
  }

  startFromTemplate(templateId) {
    const protocol = this.protocolBuilder.createFromTemplate(templateId);
    if (protocol) {
      this.showProtocolEditor('New Protocol');

      // Fill in form values from template
      document.getElementById('protocolNameInput').value = protocol.name || '';
      document.getElementById('protocolRegionSelect').value = protocol.body_region || '';

      // Set scope tags
      this.renderScopeTags();

      // Set contrast toggle
      const contrastMode = protocol.contrast_mode || 'without';
      document.querySelectorAll('#builderContrastToggle .toggle-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.contrast === contrastMode);
      });

      // Render sequences
      this.renderSequenceLibrary();
      this.renderProtocolSequences();

      this.ui.setStatus(`Started from "${protocol.name}" template`);
    }
  }

  startNewProtocol() {
    this.protocolBuilder.createNewProtocol();
    this.showProtocolEditor('New Protocol');
  }

  editProtocol(protocolId) {
    const protocol = this.protocolBuilder.editProtocol(protocolId);
    if (protocol) {
      this.showProtocolEditor('Edit Protocol');
      // Fill in form values
      document.getElementById('protocolNameInput').value = protocol.name || '';
      document.getElementById('protocolRegionSelect').value = protocol.body_region || '';
      document.getElementById('protocolIndicationsInput').value = protocol.indications || '';
      document.getElementById('protocolNotesInput').value = protocol.notes || '';

      // Set scope tags
      this.protocolBuilder.scopeTags = [...(protocol.scope_tags || [])];
      this.renderScopeTags();

      // Set contrast toggle (new mode: 'without', 'with', 'both')
      const contrastMode = protocol.contrast_mode || (protocol.uses_contrast ? 'with' : 'without');
      this.protocolBuilder.contrastMode = contrastMode;
      document.querySelectorAll('#builderContrastToggle .toggle-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.contrast === contrastMode);
      });

      // Render sequences
      this.renderProtocolSequences();
    }
  }

  duplicateProtocol(protocolId) {
    const newProtocol = this.protocolBuilder.duplicateProtocol(protocolId);
    if (newProtocol) {
      this.renderMyProtocols();
      this.ui.setStatus('Protocol duplicated');
    }
  }

  deleteProtocol(protocolId) {
    if (confirm('Are you sure you want to delete this protocol?')) {
      this.protocolBuilder.deleteProtocol(protocolId);
      this.renderMyProtocols();
      this.ui.setStatus('Protocol deleted');
    }
  }

  showProtocolEditor(title) {
    document.getElementById('myProtocolsContainer').classList.add('hidden');
    document.getElementById('protocolEditor').classList.remove('hidden');
    document.getElementById('editorTitle').textContent = title;

    // Reset form if new
    if (title === 'New Protocol') {
      document.getElementById('protocolNameInput').value = '';
      document.getElementById('protocolRegionSelect').value = '';
      document.getElementById('protocolIndicationsInput').value = '';
      document.getElementById('protocolNotesInput').value = '';

      // Reset scope tags
      this.protocolBuilder.scopeTags = [];
      this.renderScopeTags();

      // Reset contrast toggle to 'without'
      this.protocolBuilder.contrastMode = 'without';
      document.querySelectorAll('#builderContrastToggle .toggle-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.contrast === 'without');
      });
    }

    // Render sequence library
    this.renderSequenceLibrary();
    this.renderProtocolSequences();

    // Focus name input
    document.getElementById('protocolNameInput').focus();
  }

  hideProtocolEditor() {
    document.getElementById('protocolEditor').classList.add('hidden');
    document.getElementById('myProtocolsContainer').classList.remove('hidden');
    document.getElementById('rationalePanel').classList.add('hidden');
  }

  cancelProtocolEdit() {
    this.protocolBuilder.cancelEdit();
    this.hideProtocolEditor();
  }

  renderScopeTags() {
    const container = document.getElementById('scopeTags');
    if (!container) return;

    container.innerHTML = this.protocolBuilder.scopeTags.map((tag, index) => `
      <span class="scope-tag">
        ${this.escapeHtml(tag)}
        <button class="scope-tag-remove" data-index="${index}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </span>
    `).join('');

    // Bind remove buttons
    container.querySelectorAll('.scope-tag-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.index);
        this.protocolBuilder.scopeTags.splice(index, 1);
        this.renderScopeTags();
        this.renderProtocolSequences();
      });
    });
  }

  showScopeSuggestions(query) {
    const container = document.getElementById('scopeSuggestions');
    if (!container) return;

    const allScopes = this.protocolBuilder.getAllScopeTags();
    const matches = allScopes.filter(scope =>
      scope.toLowerCase().includes(query) &&
      !this.protocolBuilder.scopeTags.includes(scope.toLowerCase())
    ).slice(0, 8); // Limit to 8 suggestions

    if (matches.length === 0) {
      container.classList.add('hidden');
      return;
    }

    container.innerHTML = matches.map(scope => `
      <button class="scope-suggestion" data-tag="${scope.toLowerCase()}">${this.escapeHtml(scope)}</button>
    `).join('');

    // Bind click events
    container.querySelectorAll('.scope-suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.tag;
        if (tag && !this.protocolBuilder.scopeTags.includes(tag)) {
          this.protocolBuilder.addScopeTag(tag);
          this.renderScopeTags();
          this.renderProtocolSequences();
        }
        document.getElementById('protocolScopeInput').value = '';
        container.classList.add('hidden');
      });
    });

    container.classList.remove('hidden');
  }

  saveCurrentProtocol() {
    const formData = {
      name: document.getElementById('protocolNameInput').value,
      region: document.getElementById('protocolRegionSelect').value,
      contrastMode: this.protocolBuilder.contrastMode || 'without',
      scopeTags: this.protocolBuilder.scopeTags || [],
      indications: document.getElementById('protocolIndicationsInput').value,
      notes: document.getElementById('protocolNotesInput').value
    };

    const result = this.protocolBuilder.saveProtocol(formData);

    if (result.success) {
      this.hideProtocolEditor();
      this.renderMyProtocols();
      this.ui.setStatus('Protocol saved');
    } else {
      alert('Please fix the following errors:\n' + result.errors.join('\n'));
    }
  }

  renderSequenceLibrary(filter = '') {
    const list = document.getElementById('sequenceLibraryList');
    const sequenceTypes = this.protocolBuilder.searchSequenceTypes(filter, {
      category: this.currentSequenceFilter || 'all',
      contrastMode: this.protocolBuilder.contrastMode || 'without'
    });

    document.getElementById('libraryCount').textContent = `${sequenceTypes.length} sequence types`;

    if (sequenceTypes.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No sequences found</p></div>';
      return;
    }

    const expandedType = this.protocolBuilder.expandedType;

    list.innerHTML = sequenceTypes.map(seqType => {
      const isExpanded = expandedType === seqType.id;
      const timeStr = this.protocolBuilder.formatTime(seqType.time_seconds);
      const timeRange = this.protocolBuilder.formatTimeRange(seqType.time_range);
      const pulseSeq = seqType.pulse_sequence || '';

      // Build plane buttons
      const planes = seqType.planes || ['axial', 'sagittal', 'coronal'];
      const planeButtons = planes.map(plane => {
        const isAdded = this.protocolBuilder.isSequenceAdded(seqType.id, plane);
        const planeLabel = this.protocolBuilder.getPlaneLabel(plane);
        const abbrev = plane === '3d' ? '3D' : plane === '2d' ? '2D' : planeLabel.substring(0, 3).toUpperCase();
        return `
          <button class="plane-btn ${isAdded ? 'added' : ''}"
                  data-type-id="${seqType.id}"
                  data-plane="${plane}"
                  ${isAdded ? 'disabled' : ''}>
            ${abbrev}
            ${isAdded ? '<svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>' : ''}
          </button>
        `;
      }).join('');

      return `
        <div class="sequence-type-card ${isExpanded ? 'expanded' : ''}" data-type-id="${seqType.id}">
          <div class="sequence-type-header" data-type-id="${seqType.id}">
            <div class="sequence-type-main">
              <span class="sequence-weighting-badge ${seqType.name.toLowerCase().replace(/[^a-z0-9]/g, '')}">${seqType.name}</span>
              <div class="sequence-type-info">
                <div class="sequence-type-name">${this.escapeHtml(seqType.display_name)}</div>
                <div class="sequence-type-meta">
                  <span class="sequence-type-time">~${timeStr}</span>
                  ${pulseSeq ? `<span class="sequence-type-pulse">${pulseSeq}</span>` : ''}
                </div>
              </div>
            </div>
            <div class="sequence-type-actions">
              <button class="sequence-info-btn" data-type-id="${seqType.id}" title="View rationale">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 16v-4M12 8h.01"/>
                </svg>
              </button>
              <svg class="expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </div>
          </div>
          <div class="sequence-type-planes">
            <div class="plane-label">Add plane:</div>
            <div class="plane-buttons">
              ${planeButtons}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Bind header click to expand/collapse
    list.querySelectorAll('.sequence-type-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.sequence-info-btn')) return;
        const typeId = header.dataset.typeId;
        this.protocolBuilder.toggleExpandedType(typeId);
        this.renderSequenceLibrary(filter);
      });
    });

    // Bind info button events
    list.querySelectorAll('.sequence-info-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showSequenceRationale(btn.dataset.typeId);
      });
    });

    // Bind plane button events
    list.querySelectorAll('.plane-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.addSequenceByPlane(btn.dataset.typeId, btn.dataset.plane);
      });
    });
  }

  filterSequenceLibrary(query) {
    const clearBtn = document.getElementById('sequenceSearchClear');
    clearBtn.classList.toggle('hidden', !query);
    this.renderSequenceLibrary(query);
  }

  addSequenceByPlane(typeId, plane) {
    const added = this.protocolBuilder.addSequenceByType(typeId, plane);
    if (added) {
      this.renderSequenceLibrary(document.getElementById('sequenceSearchInput')?.value || '');
      this.renderProtocolSequences();
    }
  }

  addSequenceToProtocol(sequenceId) {
    // Legacy method - kept for compatibility
    const added = this.protocolBuilder.addSequenceByType(sequenceId, 'axial');
    if (added) {
      this.renderSequenceLibrary(document.getElementById('sequenceSearchInput')?.value || '');
      this.renderProtocolSequences();
    }
  }

  removeSequenceFromProtocol(index) {
    this.protocolBuilder.removeSequence(index);
    this.renderSequenceLibrary(document.getElementById('sequenceSearchInput')?.value || '');
    this.renderProtocolSequences();
  }

  renderProtocolSequences() {
    const list = document.getElementById('protocolSequencesList');
    const placeholder = document.getElementById('dropPlaceholder');
    const sequences = this.protocolBuilder.selectedSequences;
    const totalTime = this.protocolBuilder.calculateTotalTime();
    const multiplier = this.protocolBuilder.getScopeMultiplier();

    document.getElementById('protocolSequenceCount').textContent = `${sequences.length} sequence${sequences.length !== 1 ? 's' : ''}`;

    // Show scope-adjusted time with indicator if multiplier is not 1.0
    const timeDisplay = document.getElementById('estimatedTime');
    if (multiplier !== 1.0 && sequences.length > 0) {
      timeDisplay.textContent = `~${this.protocolBuilder.formatTime(totalTime)}`;
      timeDisplay.title = `Adjusted for scan coverage (x${multiplier.toFixed(1)})`;
    } else {
      timeDisplay.textContent = `~${this.protocolBuilder.formatTime(totalTime)}`;
      timeDisplay.title = 'Estimated scan time';
    }

    if (sequences.length === 0) {
      list.innerHTML = '';
      list.appendChild(placeholder);
      placeholder.classList.remove('hidden');
      return;
    }

    placeholder.classList.add('hidden');

    // Separate pre and post contrast
    const preContrast = sequences.filter(s => !s.is_post_contrast);
    const postContrast = sequences.filter(s => s.is_post_contrast);

    let html = '';

    // Pre-contrast sequences
    preContrast.forEach((seq, idx) => {
      const originalIndex = sequences.indexOf(seq);
      html += this.renderProtocolSequenceItem(seq, originalIndex);
    });

    // Contrast divider (if there are post-contrast sequences)
    if (postContrast.length > 0) {
      html += `
        <div class="contrast-divider">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v20M2 12h20"/>
          </svg>
          CONTRAST INJECTION
        </div>
      `;
    }

    // Post-contrast sequences
    postContrast.forEach((seq, idx) => {
      const originalIndex = sequences.indexOf(seq);
      html += this.renderProtocolSequenceItem(seq, originalIndex);
    });

    list.innerHTML = html;

    // Bind remove button events
    list.querySelectorAll('.sequence-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.removeSequenceFromProtocol(parseInt(btn.dataset.index));
      });
    });

    // Bind inline rationale toggle events
    list.querySelectorAll('.sequence-rationale-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const typeId = btn.dataset.typeId;
        const index = btn.dataset.index;
        const key = `${index}_${typeId}`;

        if (this.expandedSequenceRationale === key) {
          this.expandedSequenceRationale = null;
        } else {
          this.expandedSequenceRationale = key;
        }
        this.renderProtocolSequences();
      });
    });

    // Setup drag and drop
    this.setupSequenceDragDrop();
  }

  renderProtocolSequenceItem(seq, index) {
    const timeStr = this.protocolBuilder.formatTime(seq.time_seconds);
    const orderNum = index + 1;
    const typeId = seq.type_id || seq.sequence_id?.split('_')[0] || '';
    const seqType = this.protocolBuilder.getSequenceTypeById(typeId);
    const rationale = seqType?.rationale;
    const isExpanded = this.expandedSequenceRationale === `${index}_${typeId}`;

    let rationaleHtml = '';
    if (rationale) {
      rationaleHtml = `
        <div class="sequence-inline-rationale ${isExpanded ? 'expanded' : ''}">
          ${seqType.pulse_sequence ? `
            <div class="inline-rationale-section">
              <strong>Pulse Sequence:</strong> ${seqType.pulse_sequence}
              ${seqType.pulse_sequence_info ? `<p class="pulse-info">${this.escapeHtml(seqType.pulse_sequence_info)}</p>` : ''}
            </div>
          ` : ''}
          <div class="inline-rationale-section">
            <strong>Purpose:</strong> ${this.escapeHtml(rationale.purpose)}
          </div>
          ${rationale.what_it_shows ? `
            <div class="inline-rationale-section">
              <strong>What It Shows:</strong>
              <ul>${rationale.what_it_shows.map(item => `<li>${this.escapeHtml(item)}</li>`).join('')}</ul>
            </div>
          ` : ''}
          ${rationale.clinical_pearls ? `
            <div class="inline-rationale-section pearls">
              <strong>Clinical Pearls:</strong>
              <ul>${rationale.clinical_pearls.map(item => `<li>${this.escapeHtml(item)}</li>`).join('')}</ul>
            </div>
          ` : ''}
        </div>
      `;
    }

    return `
      <div class="protocol-sequence-item-wrapper" data-wrapper-index="${index}">
        <div class="protocol-sequence-item ${seq.is_post_contrast ? 'post-contrast' : ''} ${isExpanded ? 'rationale-open' : ''}"
             data-index="${index}" draggable="true">
          <svg class="sequence-drag-handle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/>
            <circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>
            <circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>
          </svg>
          <span class="sequence-order-number">${orderNum}</span>
          <div class="protocol-sequence-info">
            <div class="protocol-sequence-name">${this.escapeHtml(seq.sequence_name)}</div>
            <div class="protocol-sequence-time">~${timeStr}</div>
          </div>
          <div class="protocol-sequence-actions">
            ${rationale ? `
              <button class="sequence-rationale-toggle ${isExpanded ? 'active' : ''}" data-type-id="${typeId}" data-index="${index}" title="${isExpanded ? 'Hide rationale' : 'Show rationale'}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 16v-4M12 8h.01"/>
                </svg>
              </button>
            ` : ''}
            <button class="sequence-remove-btn" data-index="${index}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>
        ${rationaleHtml}
      </div>
    `;
  }

  setupSequenceDragDrop() {
    const list = document.getElementById('protocolSequencesList');
    const items = list.querySelectorAll('.protocol-sequence-item');

    items.forEach(item => {
      item.addEventListener('dragstart', (e) => {
        item.classList.add('dragging');
        e.dataTransfer.setData('text/plain', item.dataset.index);
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = list.querySelector('.dragging');
        if (dragging && dragging !== item) {
          const rect = item.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (e.clientY < midY) {
            list.insertBefore(dragging, item);
          } else {
            list.insertBefore(dragging, item.nextSibling);
          }
        }
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const oldIndex = parseInt(e.dataTransfer.getData('text/plain'));
        const newIndex = parseInt(item.dataset.index);
        if (oldIndex !== newIndex) {
          this.protocolBuilder.moveSequence(oldIndex, newIndex);
          this.renderProtocolSequences();
        }
      });
    });
  }

  exportCurrentProtocol() {
    const sequences = this.protocolBuilder.selectedSequences;
    const name = document.getElementById('protocolNameInput')?.value || 'Untitled Protocol';
    const region = this.formatRegionName(document.getElementById('protocolRegionSelect')?.value || '');
    const contrastMode = this.protocolBuilder.contrastMode;
    const scopeTags = this.protocolBuilder.scopeTags;
    const indications = document.getElementById('protocolIndicationsInput')?.value || '';
    const notes = document.getElementById('protocolNotesInput')?.value || '';
    const totalTime = this.protocolBuilder.formatTime(this.protocolBuilder.calculateTotalTime());

    const contrastLabel = contrastMode === 'both' ? 'With + Without Contrast' :
                          contrastMode === 'with' ? 'With Contrast' : 'Without Contrast';

    // Check if jsPDF is available
    if (typeof window.jspdf === 'undefined') {
      alert('PDF library not loaded. Please try again.');
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    let y = 20;
    const leftMargin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();

    // Title
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(name, leftMargin, y);
    y += 10;

    // Metadata line
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(`Region: ${region}  |  Contrast: ${contrastLabel}  |  Est. Time: ${totalTime}`, leftMargin, y);
    y += 8;

    // Scope tags
    if (scopeTags.length > 0) {
      doc.text(`Coverage: ${scopeTags.join(', ')}`, leftMargin, y);
      y += 8;
    }

    // Indications
    if (indications) {
      y += 4;
      doc.setTextColor(0);
      doc.setFont('helvetica', 'bold');
      doc.text('Indications', leftMargin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const indicationLines = doc.splitTextToSize(indications, pageWidth - 40);
      doc.text(indicationLines, leftMargin, y);
      y += indicationLines.length * 5 + 4;
    }

    // Sequences header
    y += 4;
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`Sequences (${sequences.length})`, leftMargin, y);
    y += 8;

    // Table header
    doc.setFillColor(240, 240, 240);
    doc.rect(leftMargin, y - 4, pageWidth - 40, 7, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('#', leftMargin + 2, y);
    doc.text('Sequence', leftMargin + 15, y);
    doc.text('Time', pageWidth - 35, y);
    y += 6;

    // Sequences
    doc.setFont('helvetica', 'normal');
    const preContrast = sequences.filter(s => !s.is_post_contrast);
    const postContrast = sequences.filter(s => s.is_post_contrast);

    preContrast.forEach((seq, i) => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.text(`${i + 1}`, leftMargin + 2, y);
      doc.text(seq.sequence_name, leftMargin + 15, y);
      doc.text(`~${this.protocolBuilder.formatTime(seq.time_seconds)}`, pageWidth - 35, y);
      y += 6;
    });

    if (postContrast.length > 0) {
      if (y > 260) { doc.addPage(); y = 20; }
      y += 2;
      doc.setFillColor(240, 230, 255);
      doc.rect(leftMargin, y - 4, pageWidth - 40, 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.text('--- CONTRAST INJECTION ---', leftMargin + 50, y);
      y += 8;
      doc.setFont('helvetica', 'normal');

      postContrast.forEach((seq, i) => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(`${preContrast.length + i + 1}`, leftMargin + 2, y);
        doc.text(seq.sequence_name, leftMargin + 15, y);
        doc.text(`~${this.protocolBuilder.formatTime(seq.time_seconds)}`, pageWidth - 35, y);
        y += 6;
      });
    }

    // Total time
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.text(`Total Estimated Time: ${totalTime}`, leftMargin, y);

    // Notes
    if (notes) {
      y += 10;
      if (y > 250) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold');
      doc.text('Notes', leftMargin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const noteLines = doc.splitTextToSize(notes, pageWidth - 40);
      doc.text(noteLines, leftMargin, y);
    }

    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    doc.setFontSize(8);
    doc.setTextColor(150);
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.text(`Generated by Radex Protocol Builder - ${new Date().toLocaleDateString()}`, leftMargin, 287);
    }

    // Save
    const filename = `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_protocol.pdf`;
    doc.save(filename);

    this.ui.setStatus('Protocol exported as PDF');
  }

  printCurrentProtocol() {
    const sequences = this.protocolBuilder.selectedSequences;
    const name = document.getElementById('protocolNameInput')?.value || 'Untitled Protocol';
    const region = this.formatRegionName(document.getElementById('protocolRegionSelect')?.value || '');
    const contrastMode = this.protocolBuilder.contrastMode;
    const scopeTags = this.protocolBuilder.scopeTags;
    const indications = document.getElementById('protocolIndicationsInput')?.value || '';
    const notes = document.getElementById('protocolNotesInput')?.value || '';
    const totalTime = this.protocolBuilder.formatTime(this.protocolBuilder.calculateTotalTime());

    const contrastLabel = contrastMode === 'both' ? 'With + Without Contrast' :
                          contrastMode === 'with' ? 'With Contrast' : 'Without Contrast';

    const preContrast = sequences.filter(s => !s.is_post_contrast);
    const postContrast = sequences.filter(s => s.is_post_contrast);

    let sequenceHtml = '';
    preContrast.forEach((seq, i) => {
      sequenceHtml += `<tr><td>${i + 1}</td><td>${this.escapeHtml(seq.sequence_name)}</td><td>~${this.protocolBuilder.formatTime(seq.time_seconds)}</td></tr>`;
    });

    if (postContrast.length > 0) {
      sequenceHtml += `<tr class="contrast-row"><td colspan="3"><strong>--- CONTRAST INJECTION ---</strong></td></tr>`;
      postContrast.forEach((seq, i) => {
        sequenceHtml += `<tr><td>${preContrast.length + i + 1}</td><td>${this.escapeHtml(seq.sequence_name)}</td><td>~${this.protocolBuilder.formatTime(seq.time_seconds)}</td></tr>`;
      });
    }

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${this.escapeHtml(name)} - MRI Protocol</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
          h1 { margin-bottom: 8px; }
          .meta { color: #666; margin-bottom: 24px; }
          .meta span { margin-right: 16px; }
          .section { margin-bottom: 24px; }
          .section-title { font-weight: 600; margin-bottom: 8px; color: #333; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background: #f5f5f5; }
          .contrast-row td { background: #f0e6ff; text-align: center; }
          .scope-tags { display: flex; gap: 8px; flex-wrap: wrap; }
          .scope-tag { padding: 4px 8px; background: #f0f0f0; border-radius: 4px; font-size: 12px; }
          .total { margin-top: 16px; font-weight: 600; }
          .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 12px; color: #999; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <h1>${this.escapeHtml(name)}</h1>
        <div class="meta">
          <span><strong>Region:</strong> ${region}</span>
          <span><strong>Contrast:</strong> ${contrastLabel}</span>
          <span><strong>Est. Time:</strong> ${totalTime}</span>
        </div>

        ${scopeTags.length > 0 ? `
          <div class="section">
            <div class="section-title">Scan Coverage</div>
            <div class="scope-tags">${scopeTags.map(t => `<span class="scope-tag">${this.escapeHtml(t)}</span>`).join('')}</div>
          </div>
        ` : ''}

        ${indications ? `
          <div class="section">
            <div class="section-title">Indications</div>
            <p>${this.escapeHtml(indications)}</p>
          </div>
        ` : ''}

        <div class="section">
          <div class="section-title">Sequences (${sequences.length})</div>
          <table>
            <thead><tr><th>#</th><th>Sequence</th><th>Time</th></tr></thead>
            <tbody>${sequenceHtml}</tbody>
          </table>
          <div class="total">Total Estimated Time: ${totalTime}</div>
        </div>

        ${notes ? `
          <div class="section">
            <div class="section-title">Notes</div>
            <p>${this.escapeHtml(notes)}</p>
          </div>
        ` : ''}

        <div class="footer">
          Generated by Radex Protocol Builder - ${new Date().toLocaleDateString()}
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  }

  showSequenceRationale(typeId) {
    const seqType = this.protocolBuilder.getSequenceTypeById(typeId);
    if (!seqType || !seqType.rationale) return;

    const panel = document.getElementById('rationalePanel');
    const title = document.getElementById('rationaleTitle');
    const content = document.getElementById('rationaleContent');

    title.textContent = seqType.display_name || seqType.name;

    const r = seqType.rationale;
    const pulseSeq = seqType.pulse_sequence;
    const pulseInfo = seqType.pulse_sequence_info;

    content.innerHTML = `
      ${pulseSeq ? `
        <div class="rationale-section rationale-pulse-sequence">
          <div class="rationale-section-title">Pulse Sequence: ${pulseSeq}</div>
          ${pulseInfo ? `<p class="rationale-pulse-info">${this.escapeHtml(pulseInfo)}</p>` : ''}
        </div>
      ` : ''}

      <div class="rationale-section">
        <div class="rationale-section-title">Purpose</div>
        <p class="rationale-purpose">${this.escapeHtml(r.purpose)}</p>
      </div>

      ${r.what_it_shows ? `
        <div class="rationale-section">
          <div class="rationale-section-title">What It Shows</div>
          <ul class="rationale-list">
            ${r.what_it_shows.map(item => `<li>${this.escapeHtml(item)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      ${r.when_to_use ? `
        <div class="rationale-section">
          <div class="rationale-section-title">When To Use</div>
          <ul class="rationale-list">
            ${r.when_to_use.map(item => `<li>${this.escapeHtml(item)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      ${r.limitations ? `
        <div class="rationale-section">
          <div class="rationale-section-title">Limitations</div>
          <ul class="rationale-list">
            ${r.limitations.map(item => `<li>${this.escapeHtml(item)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      ${r.clinical_pearls ? `
        <div class="rationale-section rationale-pearls">
          <div class="rationale-section-title">Clinical Pearls</div>
          <ul class="rationale-list">
            ${r.clinical_pearls.map(item => `<li>${this.escapeHtml(item)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    `;

    panel.classList.remove('hidden');
    this.protocolBuilder.selectedRationale = typeId;
  }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  window.app = new ProtocolHelpApp();
});
