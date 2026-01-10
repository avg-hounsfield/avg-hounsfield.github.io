/**
 * UI Module - Handles all DOM rendering
 * Redesigned for scenario -> procedures -> MRI protocol flow
 */

export class UI {
  constructor() {
    // Panels
    this.scenariosList = document.getElementById('scenariosList');
    this.proceduresList = document.getElementById('proceduresList');
    this.resultCount = document.getElementById('resultCount');
    this.selectedScenario = document.getElementById('selectedScenario');

    // MRI Protocol Card
    this.mriProtocolCard = document.getElementById('mriProtocolCard');
    this.protocolName = document.getElementById('protocolName');
    this.contrastBadge = document.getElementById('contrastBadge');
    this.sequencesGrid = document.getElementById('sequencesGrid');
    this.protocolRationale = document.getElementById('protocolRationale');

    // Other elements
    this.clarifyChips = document.getElementById('clarifyChips');
    this.differentialCard = document.getElementById('differentialCard');
    this.statusText = document.getElementById('statusText');
    this.statusIndicator = document.getElementById('statusIndicator');

    // State
    this.activeScenarioCard = null;
    this.activeProcedureCard = null;
    this.currentScenario = null;
  }

  setStatus(text, state = 'ready') {
    // Status bar elements are optional
    if (this.statusText) {
      this.statusText.textContent = text;
    }
    if (this.statusIndicator) {
      this.statusIndicator.className = 'status-indicator';
      if (state === 'loading') {
        this.statusIndicator.classList.add('loading');
      } else if (state === 'error') {
        this.statusIndicator.classList.add('error');
      }
    }
  }

  // ========================================
  // Scenarios Panel (Left)
  // ========================================
  renderScenarios(scenarios, onSelect) {
    this.resultCount.textContent = `${scenarios.length} result${scenarios.length !== 1 ? 's' : ''}`;

    if (scenarios.length === 0) {
      this.scenariosList.innerHTML = `
        <div class="empty-state">
          <p>No matching scenarios found</p>
        </div>
      `;
      this.clearProcedures();
      return;
    }

    this.scenariosList.innerHTML = scenarios.map((scenario, index) => {
      const procCount = scenario.procedures?.length || 0;
      const formattedTitle = this.formatScenarioTitle(scenario.name);
      // Count high-rated procedures
      const highRated = (scenario.procedures || []).filter(p => p.rating >= 7).length;

      return `
        <div class="scenario-card" data-index="${index}">
          <div class="scenario-title">${this.escapeHtml(formattedTitle)}</div>
          <div class="scenario-meta">
            ${highRated > 0 ? `<span class="high-rated-count">${highRated} recommended</span> - ` : ''}
            ${procCount} imaging options
          </div>
        </div>
      `;
    }).join('');

    // Bind click events
    this.scenariosList.querySelectorAll('.scenario-card').forEach((card, index) => {
      card.addEventListener('click', () => {
        // Update active state
        if (this.activeScenarioCard) {
          this.activeScenarioCard.classList.remove('active');
        }
        card.classList.add('active');
        this.activeScenarioCard = card;

        // Call handler
        const scenario = scenarios[index];
        this.currentScenario = scenario;
        onSelect(scenario);
      });
    });

    // Auto-select first if only one result
    if (scenarios.length === 1) {
      this.scenariosList.querySelector('.scenario-card').click();
    }
  }

  clearScenarios() {
    this.scenariosList.innerHTML = `
      <div class="empty-state">
        <p>Enter a clinical scenario to search</p>
      </div>
    `;
    this.resultCount.textContent = '0 results';
    this.activeScenarioCard = null;
    this.currentScenario = null;
    this.clearProcedures();
  }

  // ========================================
  // Procedures Panel (Right) - THE KEY INFO
  // ========================================
  renderProcedures(scenario, onProcedureSelect) {
    // Format scenario name for display
    const displayName = this.formatScenarioTitle(scenario.name);
    this.selectedScenario.textContent = displayName.substring(0, 50) + (displayName.length > 50 ? '...' : '');

    // Filter out malformed entries (empty names, "Other" modality with no info)
    const procedures = (scenario.procedures || []).filter(proc => {
      // Must have a name
      if (!proc.name || proc.name.trim() === '') return false;
      // Skip generic "Other" modality entries that are duplicates
      if (proc.modality === 'Other' && (!proc.shortName || proc.shortName === proc.name)) return false;
      return true;
    });

    if (procedures.length === 0) {
      this.proceduresList.innerHTML = `
        <div class="empty-state">
          <p>No imaging recommendations available</p>
        </div>
      `;
      return;
    }

    // Clinical priority sorting
    const sorted = this.sortProceduresClinically(procedures, scenario);

    this.proceduresList.innerHTML = sorted.map((proc, index) => {
      const ratingClass = this.getRatingClass(proc.rating);
      const levelText = this.getRatingText(proc.rating);
      const isMRI = proc.modality === 'MRI';

      return `
        <div class="procedure-card ${isMRI ? 'mri' : ''}" data-index="${index}">
          <div class="procedure-rating ${ratingClass}">${proc.rating}</div>
          <div class="procedure-info">
            <div class="procedure-name">${this.escapeHtml(proc.shortName || proc.name)}</div>
            <div class="procedure-level ${ratingClass}">${levelText}</div>
          </div>
          <span class="procedure-modality">${this.escapeHtml(proc.modality)}</span>
        </div>
      `;
    }).join('');

    // Bind click events
    this.proceduresList.querySelectorAll('.procedure-card').forEach((card, index) => {
      card.addEventListener('click', () => {
        // Update active state
        if (this.activeProcedureCard) {
          this.activeProcedureCard.classList.remove('active');
        }
        card.classList.add('active');
        this.activeProcedureCard = card;

        // Call handler with procedure
        onProcedureSelect(sorted[index]);
      });
    });

    // Auto-select first MRI if available
    const firstMRI = sorted.findIndex(p => p.modality === 'MRI');
    if (firstMRI >= 0) {
      const mriCard = this.proceduresList.querySelectorAll('.procedure-card')[firstMRI];
      if (mriCard) {
        mriCard.click();
      }
    }
  }

  clearProcedures() {
    this.proceduresList.innerHTML = `
      <div class="empty-state">
        <p>Select a scenario to see imaging recommendations</p>
      </div>
    `;
    this.selectedScenario.textContent = '';
    this.activeProcedureCard = null;
    this.hideMriProtocol();
  }

  // ========================================
  // MRI Protocol Card (Bottom)
  // ========================================
  renderMriProtocol(protocol, procedure) {
    if (!protocol) {
      this.showMriProtocolMessage(procedure);
      return;
    }

    this.mriProtocolCard.classList.remove('hidden');

    // Set protocol name
    this.protocolName.textContent = protocol.display_name || protocol.name;

    // Set contrast badge
    const hasContrast = protocol.uses_contrast || (procedure && procedure.usesContrast);
    this.contrastBadge.textContent = hasContrast ? 'With Contrast' : 'No Contrast';
    this.contrastBadge.className = `contrast-badge ${hasContrast ? 'with-contrast' : 'no-contrast'}`;

    // Render sequences
    const sequences = protocol.sequences || [];
    if (sequences.length > 0) {
      const preContrast = sequences.filter(s => !s.is_post_contrast);
      const postContrast = sequences.filter(s => s.is_post_contrast);

      let html = '';

      // Pre-contrast sequences
      preContrast.forEach(seq => {
        html += `
          <div class="sequence-tag">
            <span class="seq-marker"></span>
            <span>${this.escapeHtml(seq.sequence_name)}</span>
          </div>
        `;
      });

      // Post-contrast sequences
      postContrast.forEach(seq => {
        html += `
          <div class="sequence-tag post-contrast">
            <span class="seq-marker"></span>
            <span>${this.escapeHtml(seq.sequence_name)}</span>
          </div>
        `;
      });

      this.sequencesGrid.innerHTML = html;
    } else {
      this.sequencesGrid.innerHTML = '<p class="empty-state">No sequences defined</p>';
    }

    // Contrast rationale
    if (protocol.contrast_rationale && hasContrast) {
      this.protocolRationale.classList.remove('hidden');
      this.protocolRationale.innerHTML = `
        <div class="protocol-rationale-title">Why Contrast?</div>
        ${this.escapeHtml(protocol.contrast_rationale)}
      `;
    } else {
      this.protocolRationale.classList.add('hidden');
    }
  }

  showMriProtocolMessage(procedure) {
    this.mriProtocolCard.classList.remove('hidden');

    const procName = procedure?.shortName || procedure?.name || 'MRI';
    this.protocolName.textContent = procName;
    this.contrastBadge.textContent = procedure?.usesContrast ? 'With Contrast' : 'No Contrast';
    this.contrastBadge.className = `contrast-badge ${procedure?.usesContrast ? 'with-contrast' : 'no-contrast'}`;

    this.sequencesGrid.innerHTML = `
      <div class="empty-state" style="min-height: 100px;">
        <p>No matching hospital protocol found for this study.<br>
        <small style="color: var(--text-muted);">Generic MRI sequences may apply.</small></p>
      </div>
    `;
    this.protocolRationale.classList.add('hidden');
  }

  hideMriProtocol() {
    this.mriProtocolCard.classList.add('hidden');
  }

  // ========================================
  // Clarifying Chips
  // ========================================
  showClarifyingChips(options, onSelect, activeFilter = null) {
    this.clarifyChips.classList.remove('hidden');
    this.currentChipOptions = options;
    this.currentChipCallback = onSelect;

    this.clarifyChips.innerHTML = options.map(opt => {
      const isActive = activeFilter === opt.value;
      return `
        <button class="clarify-chip ${isActive ? 'active' : ''}" data-value="${this.escapeHtml(opt.value)}">
          ${this.escapeHtml(opt.label)}
        </button>
      `;
    }).join('');

    this.clarifyChips.querySelectorAll('.clarify-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const wasActive = chip.classList.contains('active');

        // Remove active from all chips
        this.clarifyChips.querySelectorAll('.clarify-chip').forEach(c => c.classList.remove('active'));

        // Toggle - only add active if it wasn't already active
        if (!wasActive) {
          chip.classList.add('active');
        }

        onSelect(chip.dataset.value, chip);
      });
    });
  }

  updateChipActive(activeFilter) {
    this.clarifyChips.querySelectorAll('.clarify-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.value === activeFilter);
    });
  }

  hideChips() {
    this.clarifyChips.classList.add('hidden');
    this.clarifyChips.innerHTML = '';
    this.currentChipOptions = null;
    this.currentChipCallback = null;
  }

  // ========================================
  // Differential Card (RadLITE)
  // ========================================
  showDifferentialLoading() {
    this.differentialCard.classList.remove('hidden', 'error');
    this.differentialCard.classList.add('loading');
    this.differentialCard.innerHTML = `
      <div class="differential-loader">
        <div class="spinner"></div>
        <span>Looking up differential...</span>
      </div>
    `;
  }

  renderDifferential(data) {
    if (!data || !data.success) {
      this.hideDifferential();
      return;
    }

    this.differentialCard.classList.remove('hidden', 'loading', 'error');

    let content = `
      <div class="differential-header">
        <div class="differential-term">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4M12 8h.01"/>
          </svg>
          ${this.escapeHtml(data.term)}
        </div>
        <span class="differential-badge">${data.hasMultiple ? 'Differentials' : 'Definition'}</span>
      </div>
    `;

    if (data.description) {
      content += `<p class="differential-description">${this.escapeHtml(data.description)}</p>`;
    }

    if (data.differentials && data.differentials.length > 0) {
      content += `
        <ul class="differential-list">
          ${data.differentials.map(d => `<li>${this.escapeHtml(d)}</li>`).join('')}
        </ul>
      `;
    }

    content += `
      <a href="https://coregrai.com/radiology_ai_dark.html" target="_blank" rel="noopener" class="differential-link">
        Learn more on RadLITE
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
        </svg>
      </a>
    `;

    this.differentialCard.innerHTML = content;
  }

  hideDifferential() {
    this.differentialCard.classList.add('hidden');
    this.differentialCard.classList.remove('loading', 'error');
    this.differentialCard.innerHTML = '';
  }

  // ========================================
  // Helpers
  // ========================================
  getRatingClass(rating) {
    if (rating >= 7) return 'high';
    if (rating >= 4) return 'mid';
    return 'low';
  }

  getRatingText(rating) {
    if (rating >= 7) return 'Usually Appropriate';
    if (rating >= 4) return 'May Be Appropriate';
    return 'Usually Not Appropriate';
  }

  escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Clinical priority sorting - ensures appropriate modalities appear first
  sortProceduresClinically(procedures, scenario) {
    const scenarioName = (scenario.name || '').toLowerCase();

    // Define modality priority based on clinical context
    const getModalityPriority = (proc) => {
      const modality = proc.modality || '';
      const name = (proc.name || '').toLowerCase();

      // For acute neuro/stroke - CT Head is gold standard first, then MRI
      if (scenarioName.includes('stroke') || scenarioName.includes('ischemic') ||
          scenarioName.includes('hemorrhage') || scenarioName.includes('neurological')) {
        // CT Head without contrast is usually first for acute stroke
        if (modality === 'CT' && name.includes('head')) return 100;
        if (modality === 'MRI' && name.includes('head')) return 90;
        if (modality === 'MRI' && name.includes('brain')) return 90;
        if (modality === 'CT' && name.includes('brain')) return 100;
        // CTA for vessel evaluation
        if (modality === 'CT' && (name.includes('angio') || name.includes('cta'))) return 85;
        if (modality === 'MRI') return 80;
        if (modality === 'CT') return 75;
        // US is for carotid workup, not initial diagnosis
        if (modality === 'US') return 50;
      }

      // For trauma - CT first
      if (scenarioName.includes('trauma') || scenarioName.includes('injury')) {
        if (modality === 'CT') return 90;
        if (modality === 'Radiography' || modality === 'XR') return 85;
        if (modality === 'MRI') return 70;
      }

      // Default: slight preference for cross-sectional over US
      if (modality === 'MRI') return 60;
      if (modality === 'CT') return 55;
      if (modality === 'US') return 40;
      if (modality === 'Radiography' || modality === 'XR') return 35;

      return 30;
    };

    return [...procedures].sort((a, b) => {
      // Primary: Sort by rating (highest first)
      if (b.rating !== a.rating) {
        return b.rating - a.rating;
      }
      // Secondary: Within same rating, use clinical priority
      return getModalityPriority(b) - getModalityPriority(a);
    });
  }

  // Format ACR scenario titles for better readability
  formatScenarioTitle(title) {
    if (!title) return '';

    // Split on comma and clean up
    const parts = title.split(',').map(p => p.trim());

    if (parts.length <= 2) {
      return title; // Short enough already
    }

    // Body parts that should be preserved in title
    const bodyParts = ['ankle', 'knee', 'hip', 'shoulder', 'elbow', 'wrist', 'hand', 'foot',
                       'femur', 'tibia', 'fibula', 'humerus', 'radius', 'ulna', 'pelvis',
                       'spine', 'cervical', 'thoracic', 'lumbar', 'sacral', 'coccyx',
                       'brain', 'head', 'neck', 'chest', 'abdomen', 'liver', 'kidney',
                       'pancreas', 'spleen', 'gallbladder', 'bowel', 'colon', 'rectum',
                       'bladder', 'prostate', 'uterus', 'ovary', 'breast', 'thyroid'];

    // Extract key components
    const condition = parts[0];
    const qualifiers = parts.slice(1);

    // Group qualifiers
    const bodyPart = [];
    const clinical = [];
    const imaging = [];
    const other = [];

    qualifiers.forEach(q => {
      const ql = q.toLowerCase();

      // Check if it's a body part
      if (bodyParts.some(bp => ql.includes(bp)) ||
          ql.includes('extremity') || ql.includes('joint')) {
        bodyPart.push(q);
      }
      // Clinical/treatment qualifiers - expanded to include surgical context
      else if (ql.includes('acute') || ql.includes('chronic') || ql.includes('subacute') ||
               ql.includes('suspected') || ql.includes('known') || ql.includes('diabetic') ||
               ql.includes('hardware') || ql.includes('implant') ||
               ql.includes('post ') || ql.includes('preop') || ql.includes('pre-op') ||
               ql.includes('repair') || ql.includes('tevar') || ql.includes('evar') ||
               ql.includes('surgery') || ql.includes('stent') || ql.includes('graft') ||
               ql.includes('without repair') || ql.includes('new symptoms') ||
               ql.includes('follow-up') || ql.includes('follow up') || ql.includes('surveillance')) {
        clinical.push(q);
      }
      // Imaging findings
      else if (ql.includes('radiograph') || ql.includes('x-ray') || ql.includes('ct ') ||
               ql.includes('mri ') || ql.includes('normal') || ql.includes('indeterminate') ||
               ql.includes('finding') || ql.includes('negative') || ql.includes('positive')) {
        imaging.push(q);
      }
      // Skip "next imaging study" as it's implied
      else if (!ql.includes('next imaging') && !ql.includes('initial imaging')) {
        other.push(q);
      }
    });

    // Build readable title - always include body part
    let result = condition;

    // Add body part directly after condition
    if (bodyPart.length > 0) {
      result += ' - ' + bodyPart.join('/');
    }

    // Add key clinical context (up to 2 qualifiers)
    if (clinical.length > 0) {
      // Shorten common terms
      const shortClinical = clinical.slice(0, 2).map(c => {
        return c.replace(/follow[- ]?up imaging/gi, 'F/U')
                .replace(/preop(erative)? planning/gi, 'Preop')
                .replace(/without repair/gi, 'no repair')
                .replace(/without or with new symptoms/gi, 'new sx');
      });
      result += ' (' + shortClinical.join(', ') + ')';
    }

    // Add imaging status if no clinical and space permits
    if (clinical.length === 0 && imaging.length > 0) {
      const shortImaging = imaging[0].replace(/radiograph(y|s)?/i, 'XR')
                                     .replace(/indeterminate/i, 'indeterminate')
                                     .replace(/findings? suggest/i, 'suggests');
      result += ' [' + shortImaging + ']';
    }

    // If nothing added yet and there are other qualifiers, add those
    if (bodyPart.length === 0 && clinical.length === 0 && imaging.length === 0 && other.length > 0) {
      result += ' - ' + other.slice(0, 2).join(', ');
    }

    return result;
  }
}
