/**
 * Protocol Help - Main Application
 * Anatomy-first imaging appropriateness guide
 *
 * Flow: Search -> Scenarios -> Procedures (ranked) -> MRI Protocol
 */

import { SearchEngine } from './search-engine.js';
import { DataLoader } from './data-loader.js';
import { UI } from './ui.js';
import { RadLiteAPI } from './radlite-api.js';

class ProtocolHelpApp {
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

    // Protocol view state
    this.protocolFilters = {
      region: 'all',
      contrast: 'all',
      viewMode: 'grid'
    };
    this.protocolSearchQuery = '';
    this.currentProtocol = null; // Currently viewed protocol
    this.bookmarkedProtocols = this.loadBookmarks();

    this.init();
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
                    return `
                      <div class="protocol-list-item ${isBookmarked ? 'bookmarked' : ''}" data-region="${region}" data-index="${idx}">
                        <span class="protocol-list-item-name">${this.escapeHtml(protocol.display_name || protocol.name)}</span>
                        <div class="protocol-list-item-meta">
                          ${isBookmarked ? '<span class="contrast-badge with-contrast" style="background: var(--accent-muted); color: var(--accent);">Saved</span>' : ''}
                          ${hasContrast ? '<span class="contrast-badge with-contrast">Contrast</span>' : ''}
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
  window.app = new ProtocolHelpApp();
});
