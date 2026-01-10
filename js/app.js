/**
 * ImgGuide - Main Application
 * Anatomy-first imaging appropriateness guide
 *
 * Flow: Search -> Scenarios -> Procedures (ranked) -> MRI Protocol
 */

import { SearchEngine } from './search-engine.js';
import { DataLoader } from './data-loader.js';
import { UI } from './ui.js';
import { RadLiteAPI } from './radlite-api.js';

class ImgGuideApp {
  constructor() {
    this.currentRegion = null;
    this.currentScenario = null;
    this.currentView = 'search'; // 'search' or 'protocols'
    this.searchEngine = null;
    this.dataLoader = new DataLoader();
    this.ui = new UI();
    this.radlite = new RadLiteAPI();
    this.debounceTimer = null;
    this.differentialTimer = null;
    this.protocolDebounceTimer = null;
    this.lastDifferentialQuery = '';
    this.baseQuery = ''; // Original query before clarification
    this.activeFilter = null; // Currently selected filter
    this.allProtocols = null; // Cached protocols for protocol view

    this.init();
  }

  async init() {
    this.bindEvents();
    this.ui.setStatus('Ready');
  }

  bindEvents() {
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
        if (e.key === 'Escape') this.clearSearch();
      });
    }

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
    const acknowledged = localStorage.getItem('imgguide_acknowledged');
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
      localStorage.setItem('imgguide_acknowledged', 'true');
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
      // Load region-specific data
      const data = await this.dataLoader.loadRegion(region);

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
    this.clearSearch();

    document.querySelector('.anatomy-section').classList.remove('hidden');
    document.getElementById('searchSection').classList.add('hidden');

    document.querySelectorAll('.anatomy-btn').forEach(btn => {
      btn.classList.remove('active');
    });

    this.ui.setStatus('Ready');
  }

  handleSearch(query) {
    // Toggle clear button
    document.getElementById('searchClear').classList.toggle('hidden', !query);

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
      this.ui.hideMriProtocol();
      this.baseQuery = '';
      this.activeFilter = null;
      return;
    }

    if (!this.searchEngine) {
      return;
    }

    this.ui.setStatus('Searching...', 'loading');

    try {
      // Only check for ambiguity on fresh searches, not filter changes
      if (!isFilterChange) {
        this.baseQuery = query;
        this.activeFilter = null;

        const ambiguity = this.searchEngine.detectAmbiguity(query);
        if (ambiguity.isAmbiguous) {
          this.ui.showClarifyingChips(ambiguity.options, (selected, chipElement) => {
            this.handleClarification(selected, chipElement);
          });
        } else {
          this.ui.hideChips();
        }
      }

      // Build effective query (base + filter)
      const effectiveQuery = this.activeFilter
        ? `${this.baseQuery} ${this.activeFilter}`
        : query;

      // Execute search - get scenarios
      const scenarios = await this.searchEngine.search(effectiveQuery);

      // Render scenarios in left panel
      this.ui.renderScenarios(scenarios, (scenario) => {
        this.handleScenarioSelect(scenario);
      });

      this.ui.setStatus(`${scenarios.length} scenarios found`);
    } catch (error) {
      console.error('Search error:', error);
      this.ui.setStatus('Search failed', 'error');
    }
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
      const protocol = await this.dataLoader.getProtocol(
        this.currentRegion,
        this.currentScenario,
        procedure
      );

      this.ui.renderMriProtocol(protocol, procedure);
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

  clearSearch() {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchClear').classList.add('hidden');
    this.ui.clearScenarios();
    this.ui.hideChips();
    this.ui.hideDifferential();
    this.ui.hideMriProtocol();
    this.currentScenario = null;
    this.lastDifferentialQuery = '';
    this.baseQuery = '';
    this.activeFilter = null;
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

    if (view === 'search') {
      // Switch to Search view
      protocolsSection.classList.add('fade-out');

      setTimeout(() => {
        protocolsSection.classList.add('hidden');
        protocolsSection.classList.remove('fade-out');

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

      setTimeout(async () => {
        anatomySection.classList.add('hidden');
        searchSection.classList.add('hidden');
        anatomySection.classList.remove('fade-out');
        searchSection.classList.remove('fade-out');

        protocolsSection.classList.remove('hidden');

        // Load and display all protocols
        await this.loadProtocolsView();
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
    if (!this.allProtocols) return;

    const q = query.toLowerCase().trim();

    if (!q) {
      // Show all protocols
      this.renderProtocolGrid(this.allProtocols);
      return;
    }

    // Filter protocols
    const filtered = this.allProtocols.filter(protocol => {
      const name = (protocol.name || '').toLowerCase();
      const displayName = (protocol.display_name || '').toLowerCase();
      const keywords = (protocol.keywords || []).join(' ').toLowerCase();
      const indications = (protocol.indications || '').toLowerCase();
      const bodyPart = (protocol.body_part || '').toLowerCase();

      return name.includes(q) ||
             displayName.includes(q) ||
             keywords.includes(q) ||
             indications.includes(q) ||
             bodyPart.includes(q);
    });

    this.renderProtocolGrid(filtered);
    this.ui.setStatus(`${filtered.length} protocols found`);
  }

  renderProtocolGrid(protocols) {
    const grid = document.getElementById('protocolGrid');

    if (protocols.length === 0) {
      grid.innerHTML = `
        <div class="protocol-empty-state">
          <p>No protocols found</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = protocols.map((protocol, index) => {
      const seqCount = protocol.sequences?.length || 0;
      const hasContrast = protocol.uses_contrast;
      const region = protocol.body_region || protocol.section || 'General';

      return `
        <div class="protocol-grid-card" data-index="${index}">
          <div class="protocol-grid-card-name">${this.escapeHtml(protocol.display_name || protocol.name)}</div>
          <div class="protocol-grid-card-meta">
            <span class="protocol-grid-card-region">${this.escapeHtml(region)}</span>
            ${hasContrast ? '<span class="contrast-badge with-contrast">Contrast</span>' : ''}
          </div>
          <div class="protocol-grid-card-sequences">
            <span>${seqCount}</span> sequences
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

  showProtocolDetail(protocol) {
    const resultsDiv = document.getElementById('protocolResults');
    const detailDiv = document.getElementById('protocolDetail');
    const searchContainer = document.querySelector('.protocol-search-container');

    // Hide grid and search, show detail
    resultsDiv.classList.add('hidden');
    searchContainer.classList.add('hidden');
    detailDiv.classList.remove('hidden');

    // Populate detail view
    document.getElementById('protocolDetailName').textContent = protocol.display_name || protocol.name;

    // Contrast badge
    const contrastBadge = document.getElementById('protocolDetailContrast');
    contrastBadge.textContent = protocol.uses_contrast ? 'With Contrast' : 'No Contrast';
    contrastBadge.className = `contrast-badge ${protocol.uses_contrast ? 'with-contrast' : 'no-contrast'}`;

    // Region badge
    document.getElementById('protocolDetailRegion').textContent = protocol.body_region || protocol.section || 'General';

    // Indications
    document.getElementById('protocolDetailIndications').textContent = protocol.indications || 'General imaging protocol';

    // Sequences
    const sequencesDiv = document.getElementById('protocolDetailSequences');
    const sequences = protocol.sequences || [];

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
  }

  hideProtocolDetail() {
    const resultsDiv = document.getElementById('protocolResults');
    const detailDiv = document.getElementById('protocolDetail');
    const searchContainer = document.querySelector('.protocol-search-container');

    detailDiv.classList.add('hidden');
    resultsDiv.classList.remove('hidden');
    searchContainer.classList.remove('hidden');
  }

  clearProtocolSearch() {
    document.getElementById('protocolSearchInput').value = '';
    document.getElementById('protocolSearchClear').classList.add('hidden');
    this.renderProtocolGrid(this.allProtocols || []);
  }

  escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  window.app = new ImgGuideApp();
});
