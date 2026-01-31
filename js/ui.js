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
    this.sourceBadge = document.getElementById('sourceBadge');
    this.sourceBadgeText = document.getElementById('sourceBadgeText');
    this.sequencesGrid = document.getElementById('sequencesGrid');
    this.protocolRationale = document.getElementById('protocolRationale');

    // Other elements
    this.clarifyChips = document.getElementById('clarifyChips');
    this.differentialCard = document.getElementById('differentialCard');
    this.statusText = document.getElementById('statusText');
    this.statusIndicator = document.getElementById('statusIndicator');

    // Concept search elements
    this.conceptHeader = document.getElementById('conceptHeader');
    this.phaseFilterChips = document.getElementById('phaseFilterChips');
    this.quickReferenceCard = document.getElementById('quickReferenceCard');

    // Assumed context banner elements
    this.assumedContextBanner = document.getElementById('assumedContextBanner');
    this.assumedContextText = document.getElementById('assumedContextText');
    this.assumedContextChange = document.getElementById('assumedContextChange');

    // State
    this.activeScenarioCard = null;
    this.activeProcedureCard = null;
    this.currentScenario = null;
  }

  /**
   * Deduplicate equivalent procedures that are semantically the same
   * e.g., "CT head without contrast", "CT brain without contrast", "NCCT head" are all the same
   */
  deduplicateEquivalentProcedures(procedures, primaryName) {
    if (!procedures || procedures.length <= 1) return procedures;

    // Normalize a procedure name for comparison
    const normalize = (name) => {
      let n = name.toLowerCase().replace(/\s+/g, ' ').trim();

      // Expand common abbreviations FIRST (before other replacements)
      // These abbreviations encode both modality and contrast status
      n = n.replace(/\bncct\b/gi, 'ct noncontrast');
      n = n.replace(/\bcect\b/gi, 'ct contrast');
      n = n.replace(/\bnchct\b/gi, 'ct noncontrast');
      n = n.replace(/\bchct\b/gi, 'ct contrast');
      n = n.replace(/\bctpa\b/gi, 'cta pulmonary arteries');
      n = n.replace(/\bhrct\b/gi, 'ct highresolution');
      n = n.replace(/\bmrcp\b/gi, 'mr cholangiopancreatography');
      n = n.replace(/\bmrv\b/gi, 'mr venography');
      n = n.replace(/\bctv\b/gi, 'ct venography');

      // Normalize contrast terminology
      n = n.replace(/without contrast|w\/o contrast|non-contrast|noncontrast|non contrast/gi, 'NC');
      n = n.replace(/with contrast|w\/ contrast|w contrast|contrast enhanced|with iv contrast/gi, '+C');

      // Normalize anatomy terms (brain = head for imaging)
      n = n.replace(/\bbrain\b/gi, 'head');
      n = n.replace(/\bcranial\b/gi, 'head');

      // Normalize other anatomy
      n = n.replace(/\babdomen\b/gi, 'abd');
      n = n.replace(/\babdominal\b/gi, 'abd');
      n = n.replace(/\bpelvis\b/gi, 'pelv');
      n = n.replace(/\bchest\b/gi, 'thorax');
      n = n.replace(/\bthoracic\b/gi, 'thorax');
      n = n.replace(/\bcervical spine\b/gi, 'cspine');
      n = n.replace(/\bc-spine\b/gi, 'cspine');
      n = n.replace(/\blumbar spine\b/gi, 'lspine');
      n = n.replace(/\bl-spine\b/gi, 'lspine');
      n = n.replace(/\bthoracic spine\b/gi, 'tspine');
      n = n.replace(/\bt-spine\b/gi, 'tspine');

      // Normalize modality terms
      n = n.replace(/computed tomography/gi, 'ct');
      n = n.replace(/magnetic resonance imaging/gi, 'mri');
      n = n.replace(/magnetic resonance/gi, 'mr');
      n = n.replace(/\bultrasound\b/gi, 'us');
      n = n.replace(/\bsonography\b/gi, 'us');
      n = n.replace(/\bradiograph(s|y)?\b/gi, 'xr');
      n = n.replace(/\bx-ray(s)?\b/gi, 'xr');
      n = n.replace(/\bplain film(s)?\b/gi, 'xr');

      // Remove common filler words
      n = n.replace(/\b(of|the|and|or)\b/gi, '');

      // Collapse multiple spaces and sort words for order-independent comparison
      n = n.replace(/\s+/g, ' ').trim();

      // Sort words so "ct head NC" and "ct NC head" become the same
      return n.split(' ').sort().join(' ');
    };

    const primaryNorm = normalize(primaryName || '');
    const seen = new Set();
    seen.add(primaryNorm);  // Always exclude things identical to primary

    const unique = [];
    for (const proc of procedures) {
      const norm = normalize(proc);
      // Skip if same as primary or already seen
      if (norm === primaryNorm) continue;
      if (seen.has(norm)) continue;

      // Also check for very similar names (one contains the other after normalization)
      let isDupe = false;
      for (const seenNorm of seen) {
        if (seenNorm.includes(norm) || norm.includes(seenNorm)) {
          // If lengths are similar (within 5 chars), likely the same thing
          if (Math.abs(seenNorm.length - norm.length) < 5) {
            isDupe = true;
            break;
          }
        }
      }

      if (!isDupe) {
        seen.add(norm);
        unique.push(proc);
      }
    }

    return unique;
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

  /**
   * Show assumed context banner when condition-based urgency is applied
   * @param {Object} intent - The intent classification result
   * @param {Function} onChangeClick - Callback when "change" is clicked
   */
  showAssumedContextBanner(intent, onChangeClick) {
    if (!this.assumedContextBanner || !intent || !intent.matchedCondition) {
      this.hideAssumedContextBanner();
      return;
    }

    const urgency = intent.urgency;
    const condition = intent.matchedCondition;

    // Format the urgency label
    const urgencyLabels = {
      'acute': 'Acute',
      'routine': 'Routine',
      'chronic': 'Chronic'
    };
    const urgencyLabel = urgencyLabels[urgency] || urgency;

    // Update banner content
    this.assumedContextText.innerHTML = `Assumed <strong>${urgencyLabel}</strong> context based on "<strong>${condition}</strong>"`;

    // Set data attribute for styling
    this.assumedContextBanner.setAttribute('data-urgency', urgency);

    // Show banner
    this.assumedContextBanner.classList.remove('hidden');

    // Set up change button handler
    if (this.assumedContextChange && onChangeClick) {
      // Remove any existing listener
      this.assumedContextChange.replaceWith(this.assumedContextChange.cloneNode(true));
      this.assumedContextChange = document.getElementById('assumedContextChange');

      this.assumedContextChange.addEventListener('click', () => {
        onChangeClick(intent);
      });
    }
  }

  /**
   * Hide the assumed context banner
   */
  hideAssumedContextBanner() {
    if (this.assumedContextBanner) {
      this.assumedContextBanner.classList.add('hidden');
    }
  }

  // ========================================
  // Scenarios Panel (Left)
  // ========================================

  // Group scenarios by their formatted title to create accordion for duplicates
  groupScenariosByTitle(scenarios) {
    const groups = new Map();

    scenarios.forEach((scenario, originalIndex) => {
      const formattedTitle = this.formatScenarioTitle(scenario.name);
      const key = formattedTitle.toLowerCase();

      if (!groups.has(key)) {
        groups.set(key, {
          formattedTitle,
          scenarios: [],
          originalIndices: []
        });
      }

      groups.get(key).scenarios.push(scenario);
      groups.get(key).originalIndices.push(originalIndex);
    });

    return groups;
  }

  // Extract the differentiating part of a scenario (what makes it unique within a group)
  getDifferentiator(scenario, formattedTitle) {
    const fullName = scenario.name;
    const parts = fullName.split(',').map(p => p.trim());

    // Get all qualifiers that aren't in the formatted title
    const formattedLower = formattedTitle.toLowerCase();
    const differentiators = [];

    parts.slice(1).forEach(part => {
      const partLower = part.toLowerCase();
      // Skip generic phrases
      if (partLower.includes('next imaging') || partLower.includes('initial imaging')) {
        return;
      }
      // Check if this part is NOT represented in the formatted title
      if (!formattedLower.includes(partLower.substring(0, 10))) {
        differentiators.push(part);
      }
    });

    // Return last 1-2 differentiators (most specific)
    if (differentiators.length > 0) {
      return differentiators.slice(-2).join(', ');
    }

    // Fallback: return everything after the condition
    return parts.slice(1).join(', ');
  }

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

    // Group scenarios by formatted title
    const groups = this.groupScenariosByTitle(scenarios);

    let html = '';
    let cardIndex = 0;

    groups.forEach((group) => {
      if (group.scenarios.length === 1) {
        // Single scenario - render as normal card
        const scenario = group.scenarios[0];
        const procCount = scenario.procedures?.length || 0;
        const highRated = (scenario.procedures || []).filter(p => p.rating >= 7).length;

        html += `
          <div class="scenario-card" data-index="${group.originalIndices[0]}">
            <div class="scenario-title">${this.escapeHtml(group.formattedTitle)}</div>
            <div class="scenario-meta">
              ${highRated > 0 ? `<span class="high-rated-count">${highRated} recommended</span> - ` : ''}
              ${procCount} imaging options
            </div>
          </div>
        `;
      } else {
        // Multiple scenarios with same title - render as accordion
        const totalProcs = group.scenarios.reduce((sum, s) => sum + (s.procedures?.length || 0), 0);
        const avgProcs = Math.round(totalProcs / group.scenarios.length);

        html += `
          <div class="scenario-accordion" data-group-id="${cardIndex}">
            <div class="accordion-header">
              <div class="accordion-toggle">
                <svg class="accordion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </div>
              <div class="accordion-content">
                <div class="scenario-title">${this.escapeHtml(group.formattedTitle)}</div>
                <div class="scenario-meta">
                  <span class="variant-count">${group.scenarios.length} variants</span> - ~${avgProcs} imaging options each
                </div>
              </div>
            </div>
            <div class="accordion-children hidden">
              ${group.scenarios.map((scenario, i) => {
                const diff = this.getDifferentiator(scenario, group.formattedTitle);
                const procCount = scenario.procedures?.length || 0;
                const highRated = (scenario.procedures || []).filter(p => p.rating >= 7).length;

                return `
                  <div class="scenario-card scenario-child" data-index="${group.originalIndices[i]}">
                    <div class="scenario-title child-title">${this.escapeHtml(diff)}</div>
                    <div class="scenario-meta">
                      ${highRated > 0 ? `<span class="high-rated-count">${highRated} rec</span> - ` : ''}
                      ${procCount} options
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
        cardIndex++;
      }
    });

    this.scenariosList.innerHTML = html;

    // Bind accordion toggle events
    this.scenariosList.querySelectorAll('.accordion-header').forEach(header => {
      header.addEventListener('click', (e) => {
        const accordion = header.closest('.scenario-accordion');
        const children = accordion.querySelector('.accordion-children');
        const icon = accordion.querySelector('.accordion-icon');

        children.classList.toggle('hidden');
        icon.classList.toggle('expanded');
        accordion.classList.toggle('expanded');
      });
    });

    // Bind click events for scenario cards (both regular and child)
    this.scenariosList.querySelectorAll('.scenario-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent accordion toggle when clicking child

        const index = parseInt(card.dataset.index);

        // Update active state
        if (this.activeScenarioCard) {
          this.activeScenarioCard.classList.remove('active');
        }
        card.classList.add('active');
        this.activeScenarioCard = card;

        // Call handler with the original scenario
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
    // Format scenario name for display - show full text
    const displayName = this.formatScenarioTitle(scenario.name);
    this.selectedScenario.textContent = displayName;

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
  renderMriProtocol(protocol, procedure, matchType = 'suggested', supplementalSequences = null) {
    if (!protocol) {
      this.showMriProtocolMessage(procedure);
      return;
    }

    this.mriProtocolCard.classList.remove('hidden');

    // Set protocol name
    this.protocolName.textContent = protocol.display_name || protocol.name;

    // Set source badge (human verified vs AI generated)
    if (this.sourceBadge) {
      this.sourceBadge.classList.remove('hidden', 'curated', 'suggested');
      this.sourceBadge.classList.add(matchType);
      if (this.sourceBadgeText) {
        this.sourceBadgeText.textContent = matchType === 'curated' ? 'Human Verified' : 'AI Generated';
      }
      // Update tooltip
      this.sourceBadge.title = matchType === 'curated'
        ? 'Protocol verified by radiologists for this scenario'
        : 'Protocol generated by AI based on clinical context';
    }

    // Set contrast badge
    const hasContrast = protocol.uses_contrast || (procedure && procedure.usesContrast);
    this.contrastBadge.textContent = hasContrast ? 'With Contrast' : 'No Contrast';
    this.contrastBadge.className = `contrast-badge ${hasContrast ? 'with-contrast' : 'no-contrast'}`;

    // Render sequences
    const sequences = protocol.sequences || [];
    let html = '';

    if (sequences.length > 0) {
      const preContrast = sequences.filter(s => !s.is_post_contrast);
      const postContrast = sequences.filter(s => s.is_post_contrast);

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
    } else {
      html = '<p class="empty-state">No sequences defined</p>';
    }

    // Add supplemental sequences if available
    if (supplementalSequences) {
      const allSupplements = [
        ...(supplementalSequences.always || []),
        ...(supplementalSequences.contextual || [])
      ];

      if (allSupplements.length > 0) {
        html += `
          <div class="supplemental-sequences">
            <div class="supplemental-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>Consider Adding</span>
            </div>
        `;

        allSupplements.forEach(supp => {
          html += `<div class="supplemental-group">`;
          if (supp.reason) {
            html += `<div class="supplemental-reason">${this.escapeHtml(supp.reason)}</div>`;
          }
          html += `<div class="supplemental-seqs">`;
          supp.sequences.forEach(seq => {
            html += `
              <div class="sequence-tag supplemental">
                <span class="seq-marker"></span>
                <span>${this.escapeHtml(seq)}</span>
              </div>
            `;
          });
          html += `</div></div>`;
        });

        html += `</div>`;
      }
    }

    this.sequencesGrid.innerHTML = html;

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

    // Hide source badge when no protocol found
    if (this.sourceBadge) {
      this.sourceBadge.classList.add('hidden');
    }

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
  // Concept Header
  // ========================================
  showConceptHeader(concept) {
    if (!this.conceptHeader) return;

    this.conceptHeader.classList.remove('hidden');
    this.conceptHeader.innerHTML = `
      <div class="concept-match">
        <svg class="concept-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 12l2 2 4-4"/>
          <circle cx="12" cy="12" r="10"/>
        </svg>
        <span class="concept-name">${this.escapeHtml(concept.displayName)}</span>
        <span class="concept-region">${this.escapeHtml(this.formatRegionName(concept.bodyRegion))}</span>
      </div>
    `;
  }

  hideConceptHeader() {
    if (!this.conceptHeader) return;
    this.conceptHeader.classList.add('hidden');
    this.conceptHeader.innerHTML = '';
  }

  // ========================================
  // Summary Card (Quick Consensus)
  // ========================================
  showSummaryCard(card, onDetailedSearch, intent = null) {
    const summaryCard = document.getElementById('summaryCard');
    if (!summaryCard || !card) return;

    const cardTypeClass = `card-type-${card.card_type.toLowerCase().replace('_', '-')}`;
    summaryCard.className = `summary-card ${cardTypeClass}`;
    summaryCard.classList.remove('hidden');

    const cardTypeLabels = {
      'STRONG': 'Strong Consensus',
      'CONDITIONAL': 'Conditional',
      'HIGH_VARIANCE': 'High Variance',
      'CLINICAL_FIRST': 'Clinical First'
    };

    const cardTypeIcons = {
      'STRONG': '<path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/>',
      'CONDITIONAL': '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
      'HIGH_VARIANCE': '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
      'CLINICAL_FIRST': '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'
    };

    const rec = card.primary_recommendation;
    const displayName = card.display_name || card.topic;

    let bodyContent = '';

    if (card.card_type === 'CLINICAL_FIRST') {
      bodyContent = `
        <div class="summary-card-clinical-msg">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
          </svg>
          <span><strong>${card.no_imaging_pct}%</strong> of scenarios suggest clinical assessment before imaging</span>
        </div>
        ${rec.name ? `
          <div class="summary-card-recommendation" style="margin-top: var(--space-sm)">
            <span class="summary-card-rec-label">When imaging needed:</span>
            <span class="summary-card-rec-primary">${this.escapeHtml(rec.name)}</span>
          </div>
        ` : ''}
      `;
    } else if (card.card_type === 'HIGH_VARIANCE') {
      bodyContent = `
        <div class="summary-card-clinical-msg" style="background: rgba(244, 67, 54, 0.08)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--rating-low)">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/>
            <path d="M12 17h.01"/>
          </svg>
          <span>Recommendations vary significantly based on clinical context</span>
        </div>
      `;
    } else {
      // STRONG or CONDITIONAL
      const rawEquivProcs = rec.equivalent_procedures || [];
      // Deduplicate equivalent procedures (removes redundant namings like "CT brain" vs "CT head")
      const equivProcs = this.deduplicateEquivalentProcedures(rawEquivProcs, rec.name);

      bodyContent = `
        <div class="summary-card-recommendation">
          <span class="summary-card-rec-label">Primary:</span>
          <span class="summary-card-rec-primary">${this.escapeHtml(rec.name || 'None')}</span>
          ${rec.consensus_pct ? `<span class="summary-card-rec-consensus">(${rec.consensus_pct}% consensus)</span>` : ''}
        </div>
        ${equivProcs.length > 0 ? `
          <div class="summary-card-equivalents">
            ${equivProcs.map(p => `<span class="summary-card-equiv-chip">${this.escapeHtml(this.truncateProcedure(p, 30))}</span>`).join('')}
          </div>
        ` : ''}
        ${card.alternatives && card.alternatives.length > 0 ? `
          <div class="summary-card-alternatives">
            <strong>Also consider:</strong>
            ${card.alternatives.slice(0, 2).map(a => `${this.escapeHtml(this.truncateProcedure(a.name, 25))} (${a.percentage}%)`).join(', ')}
          </div>
        ` : ''}
      `;
    }

    // Build assumed context indicator if intent has a matched condition
    let contextIndicator = '';
    if (intent && intent.matchedCondition) {
      const urgencyLabels = { 'acute': 'Acute', 'routine': 'Routine', 'chronic': 'Chronic' };
      const urgencyColors = { 'acute': '#dc3545', 'routine': '#28a745', 'chronic': '#ffc107' };
      const urgencyLabel = urgencyLabels[intent.urgency] || intent.urgency;
      const urgencyColor = urgencyColors[intent.urgency] || '#6c757d';
      contextIndicator = `
        <div class="summary-card-context" style="background: ${urgencyColor}15; border-left: 3px solid ${urgencyColor}; padding: 6px 10px; margin-bottom: 8px; font-size: 12px; color: ${urgencyColor};">
          <strong>${urgencyLabel}</strong> context assumed for "${intent.matchedCondition}"
        </div>
      `;
    }

    summaryCard.innerHTML = `
      <div class="summary-card-header">
        <div class="summary-card-title-row">
          <svg class="summary-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${cardTypeIcons[card.card_type] || cardTypeIcons['CONDITIONAL']}
          </svg>
          <span class="summary-card-title">${this.escapeHtml(displayName)}</span>
          <span class="summary-card-badge">${cardTypeLabels[card.card_type] || card.card_type}</span>
        </div>
        <button class="summary-card-dismiss" title="Dismiss">&times;</button>
      </div>
      <div class="summary-card-meta">Based on ${card.scenario_count} ACR scenarios</div>
      ${contextIndicator}
      <div class="summary-card-body">
        ${bodyContent}
      </div>
      <div class="summary-card-footer">
        <span class="summary-card-source">ACR Appropriateness Criteria</span>
        ${card.recommend_detailed_search || card.card_type === 'HIGH_VARIANCE' ? `
          <button class="summary-card-action" id="summaryDetailedSearch">
            See detailed scenarios &rarr;
          </button>
        ` : ''}
      </div>
    `;

    // Bind dismiss button
    const dismissBtn = summaryCard.querySelector('.summary-card-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => this.hideSummaryCard());
    }

    // Bind detailed search button
    const detailBtn = summaryCard.querySelector('#summaryDetailedSearch');
    if (detailBtn && onDetailedSearch) {
      detailBtn.addEventListener('click', () => onDetailedSearch(card.topic));
    }
  }

  hideSummaryCard() {
    const summaryCard = document.getElementById('summaryCard');
    if (summaryCard) {
      summaryCard.classList.add('hidden');
      summaryCard.innerHTML = '';
    }
  }

  truncateProcedure(name, maxLen = 30) {
    if (!name || name.length <= maxLen) return name || '';
    return name.substring(0, maxLen - 3) + '...';
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

  // ========================================
  // Phase Filter Chips
  // ========================================
  showPhaseFilterChips(phases, activePhase, onFilterChange) {
    if (!this.phaseFilterChips) return;

    this.phaseFilterChips.classList.remove('hidden');

    // Generate chips HTML
    const chipsHtml = phases.map(p => {
      const isActive = activePhase === p.phase;
      return `
        <button class="filter-chip phase-chip ${isActive ? 'active' : ''}" data-phase="${this.escapeHtml(p.phase)}">
          ${this.escapeHtml(p.phaseDisplay)}
          <span class="phase-count">${p.count}</span>
        </button>
      `;
    }).join('');

    this.phaseFilterChips.innerHTML = `
      <div class="phase-filter-label">Filter by phase:</div>
      <div class="phase-chips-container">${chipsHtml}</div>
    `;

    // Bind click events
    this.phaseFilterChips.querySelectorAll('.phase-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const phase = chip.dataset.phase;
        onFilterChange(phase);
      });
    });
  }

  hidePhaseFilterChips() {
    if (!this.phaseFilterChips) return;
    this.phaseFilterChips.classList.add('hidden');
    this.phaseFilterChips.innerHTML = '';
  }

  updatePhaseChipActive(activePhase) {
    if (!this.phaseFilterChips) return;
    this.phaseFilterChips.querySelectorAll('.phase-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.phase === activePhase);
    });
  }

  // ========================================
  // Grouped Scenarios Rendering
  // ========================================
  renderGroupedScenarios(groups, onSelect) {
    if (!groups || groups.length === 0) {
      this.clearScenarios();
      return;
    }

    // Count total scenarios
    const totalScenarios = groups.reduce((sum, g) => sum + g.scenarios.length, 0);
    this.resultCount.textContent = `${totalScenarios} result${totalScenarios !== 1 ? 's' : ''}`;

    let html = '';

    for (const group of groups) {
      const scenarioCount = group.scenarios.length;
      if (scenarioCount === 0) continue;

      // Group header
      html += `
        <div class="scenario-phase-group" data-phase="${this.escapeHtml(group.phase)}">
          <div class="phase-group-header">
            <span class="phase-group-title">${this.escapeHtml(group.phaseDisplay)}</span>
            <span class="phase-group-count">${scenarioCount}</span>
          </div>
          <div class="phase-group-scenarios">
      `;

      // Render scenarios in this group
      for (let i = 0; i < group.scenarios.length; i++) {
        const scenario = group.scenarios[i];
        const formattedTitle = this.formatScenarioTitle(scenario.name);
        const procCount = scenario.procedures?.length || 0;
        const highRated = (scenario.procedures || []).filter(p => p.rating >= 7).length;

        html += `
          <div class="scenario-card" data-phase="${this.escapeHtml(group.phase)}" data-index="${i}">
            <div class="scenario-title">${this.escapeHtml(formattedTitle)}</div>
            <div class="scenario-meta">
              ${highRated > 0 ? `<span class="high-rated-count">${highRated} recommended</span> - ` : ''}
              ${procCount} imaging options
            </div>
          </div>
        `;
      }

      html += `
          </div>
        </div>
      `;
    }

    this.scenariosList.innerHTML = html;

    // Build flat lookup for click handling
    const flatScenarios = [];
    const scenarioLookup = new Map();

    groups.forEach(group => {
      group.scenarios.forEach((scenario, idx) => {
        scenarioLookup.set(`${group.phase}-${idx}`, scenario);
        flatScenarios.push(scenario);
      });
    });

    // Bind click events
    this.scenariosList.querySelectorAll('.scenario-card').forEach(card => {
      card.addEventListener('click', () => {
        const phase = card.dataset.phase;
        const index = parseInt(card.dataset.index);
        const key = `${phase}-${index}`;
        const scenario = scenarioLookup.get(key);

        if (scenario) {
          // Update active state
          if (this.activeScenarioCard) {
            this.activeScenarioCard.classList.remove('active');
          }
          card.classList.add('active');
          this.activeScenarioCard = card;

          this.currentScenario = scenario;
          onSelect(scenario);
        }
      });
    });

    // Auto-select first if only one result
    if (totalScenarios === 1) {
      this.scenariosList.querySelector('.scenario-card')?.click();
    }
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

  // ========================================
  // Quick Reference Card (Dual Pathway)
  // ========================================

  /**
   * Render the Quick Reference card showing both clinical pathways
   * @param {Object} data - { conceptName, acute: [...], followup: [...] }
   */
  renderQuickReference(data) {
    if (!this.quickReferenceCard || !data) {
      this.hideQuickReference();
      return;
    }

    const { conceptName, acute, followup } = data;

    // Don't show if we have no recommendations for either pathway
    if ((!acute || acute.length === 0) && (!followup || followup.length === 0)) {
      this.hideQuickReference();
      return;
    }

    this.quickReferenceCard.classList.remove('hidden');

    const renderRecommendations = (recs) => {
      if (!recs || recs.length === 0) {
        return '<div class="pathway-empty">No specific recommendations</div>';
      }
      return recs.slice(0, 3).map(rec => `
        <div class="pathway-rec">
          <span class="pathway-rec-name">${this.escapeHtml(rec.name)}</span>
          <div class="pathway-rec-rating">
            <span class="rating-badge ${this.getRatingClass(rec.rating)}">${rec.rating}</span>
          </div>
        </div>
      `).join('');
    };

    this.quickReferenceCard.innerHTML = `
      <div class="quick-reference-header">
        <div class="quick-reference-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          ${this.escapeHtml(conceptName)} - Quick Reference
        </div>
        <span class="quick-reference-badge">Both Pathways</span>
      </div>
      <div class="quick-reference-body">
        <div class="pathway-section">
          <div class="pathway-header">
            <div class="pathway-indicator acute"></div>
            <span class="pathway-title">Acute / Initial Workup</span>
            <span class="pathway-subtitle">${acute?.length || 0} options</span>
          </div>
          <div class="pathway-recommendations">
            ${renderRecommendations(acute)}
          </div>
        </div>
        <div class="pathway-section">
          <div class="pathway-header">
            <div class="pathway-indicator followup"></div>
            <span class="pathway-title">Follow-up / Surveillance</span>
            <span class="pathway-subtitle">${followup?.length || 0} options</span>
          </div>
          <div class="pathway-recommendations">
            ${renderRecommendations(followup)}
          </div>
        </div>
      </div>
      <div class="quick-reference-footer">
        Top imaging recommendations by clinical context
      </div>
    `;
  }

  hideQuickReference() {
    if (this.quickReferenceCard) {
      this.quickReferenceCard.classList.add('hidden');
      this.quickReferenceCard.innerHTML = '';
    }
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
  // Preserves distinguishing qualifiers to avoid duplicate-looking titles
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
                       'bladder', 'prostate', 'uterus', 'ovary', 'breast', 'thyroid',
                       'mesenteric', 'renal', 'aortic', 'carotid', 'coronary', 'pulmonary'];

    // Extract key components
    const condition = parts[0];
    const qualifiers = parts.slice(1);

    // Group qualifiers by type (order matters for display priority)
    const bodyPart = [];
    const size = [];        // Size qualifiers like <1cm, >1cm
    const severity = [];    // Stage, risk level, invasiveness
    const subtype = [];     // Tumor subtypes, specific variants
    const clinical = [];    // Clinical context, treatment status
    const imaging = [];     // Imaging findings
    const purpose = [];     // Purpose of imaging (staging, surveillance, etc.)
    const other = [];

    qualifiers.forEach(q => {
      const ql = q.toLowerCase();

      // Skip generic phrases
      if (ql.includes('next imaging') || ql.includes('initial imaging')) {
        return;
      }

      // Size qualifiers (critical for differentiation)
      if (ql.match(/<\s*\d|>\s*\d|>=\s*\d|<=\s*\d|\d+\s*cm|\d+\s*mm/)) {
        size.push(q);
      }
      // Risk levels and severity
      else if (ql.includes('high risk') || ql.includes('intermediate risk') ||
               ql.includes('low risk') || ql.includes('average risk') ||
               ql.includes('elevated risk') || ql.includes('very high risk')) {
        severity.push(q);
      }
      // Stage and invasiveness
      else if (ql.match(/stage\s*[0-9ivab]+/i) ||
               ql.includes('muscle invasive') || ql.includes('nonmuscle invasive') ||
               ql.includes('non-muscle invasive') || ql.includes('locally advanced') ||
               ql.includes('metastatic') || ql.includes('localized')) {
        severity.push(q);
      }
      // Tumor characteristics and subtypes
      else if (ql.includes('aggressive') || ql.includes('malignant') || ql.includes('benign') ||
               ql.includes('seminoma') || ql.includes('nonseminoma') ||
               ql.includes('adenocarcinoma') || ql.includes('squamous') ||
               ql.includes('appearance') || ql.includes('indeterminate')) {
        subtype.push(q);
      }
      // Body parts and anatomic locations
      else if (bodyParts.some(bp => ql.includes(bp)) ||
               ql.includes('extremity') || ql.includes('joint') ||
               ql.includes('arterial system') || ql.includes('urinary tract')) {
        bodyPart.push(q);
      }
      // Clinical/treatment qualifiers
      else if (ql.includes('acute') || ql.includes('chronic') || ql.includes('subacute') ||
               ql.includes('suspected') || ql.includes('known') || ql.includes('diabetic') ||
               ql.includes('hardware') || ql.includes('implant') ||
               ql.includes('post ') || ql.includes('preop') || ql.includes('pre-op') ||
               ql.includes('repair') || ql.includes('tevar') || ql.includes('evar') ||
               ql.includes('surgery') || ql.includes('stent') || ql.includes('graft') ||
               ql.includes('without repair') || ql.includes('new symptoms') ||
               ql.includes('recurrence') || ql.includes('recurrent') ||
               ql.includes('fracture completion') || ql.includes('need-to-know') ||
               ql.includes('osteoporosis') || ql.includes('bisphosphonate') ||
               ql.includes('puncture wound') || ql.includes('foreign body') ||
               ql.includes('mri contraindicated') || ql.includes('contraindication') ||
               ql.includes('cannot tolerate') || ql.includes('incomplete') ||
               ql.includes('complicated') || ql.includes('uncomplicated') ||
               ql.includes('frequent') || ql.includes('relapses') ||
               ql.includes('curative') || ql.includes('palliation') || ql.includes('palliative') ||
               ql.includes('wait and watch') || ql.includes('resection') ||
               ql.includes('mets suspected') || ql.includes('regional recurrence') ||
               ql.includes('treated') || ql.includes('asymptomatic') || ql.includes('symptomatic') ||
               ql.includes('no hx of') || ql.includes('hx of hcc') ||
               ql.includes('fibrosis') || ql.includes('neoadjuvant') || ql.includes('surgical planning') ||
               ql.includes('equivocal') || ql.includes('fever') || ql.includes('wbc') ||
               // Age and hormonal status
               ql.includes('postmenopausal') || ql.includes('premenopausal') ||
               ql.includes('transfeminine') || ql.includes('transmasculine') || ql.includes('pregnant') ||
               // Specific risk factors
               ql.includes('family hx') || ql.includes('personal hx') || ql.includes('genetic') ||
               ql.includes('ca-125') || ql.includes('smoking') || ql.includes('lifetime risk') ||
               ql.includes('hormone') || ql.includes('mastectomy') || ql.includes('mammoplasty') ||
               ql.includes('lobular') || ql.includes('ductal') || ql.includes('atypical')) {
        clinical.push(q);
      }
      // Imaging findings and modality
      else if (ql.includes('radiograph') || ql.includes('x-ray') || ql.includes('on ct') ||
               ql.includes('on mri') || ql.includes('on us') || ql.includes('on imaging') ||
               ql.includes('noncontrast mri') || ql.includes('noncontrast ct') ||
               ql.includes('single phase ct') || ql.includes('finding on us') ||
               ql.includes('normal') || ql.includes('negative') || ql.includes('positive') ||
               ql.includes('finding') || ql.includes('nondiagnostic')) {
        imaging.push(q);
      }
      // Purpose/outcome of imaging
      else if (ql.includes('surveillance') || ql.includes('follow-up') || ql.includes('follow up') ||
               ql.includes('staging') || ql.includes('restaging') ||
               ql.includes('complication') || ql.includes('determining extent') ||
               ql.includes('posttreatment') || ql.includes('pretreatment') ||
               ql.includes('screening') || ql.includes('evaluation') ||
               ql.includes('active surveillance') || ql.includes('post treatment') ||
               ql.includes('diagnosis')) {
        purpose.push(q);
      }
      // Everything else
      else {
        other.push(q);
      }
    });

    // Build readable title with distinguishing info
    let result = condition;

    // Add body part directly after condition
    if (bodyPart.length > 0) {
      result += ' - ' + bodyPart.join('/');
    }

    // Collect key differentiators (prioritized)
    const differentiators = [];

    // Size is critical - always include all size qualifiers
    if (size.length > 0) {
      differentiators.push(...size.map(s => this.shortenQualifier(s)));
    }

    // Severity/stage is important - include with purpose for context
    if (severity.length > 0) {
      differentiators.push(...severity.slice(0, 1).map(s => this.shortenQualifier(s)));
      // Always add purpose with severity to distinguish staging vs surveillance
      if (purpose.length > 0) {
        differentiators.push(...purpose.slice(0, 1).map(s => this.shortenQualifier(s)));
      }
    }

    // Subtype for tumors
    if (subtype.length > 0) {
      differentiators.push(...subtype.slice(0, 1).map(s => this.shortenQualifier(s)));
    }

    // Clinical context - include up to 2, more if they're differentiating risk factors
    if (clinical.length > 0) {
      // Always show at least 2 clinical qualifiers to capture risk factors
      const clinicalCount = Math.min(clinical.length, 2);
      differentiators.push(...clinical.slice(0, clinicalCount).map(s => this.shortenQualifier(s)));
    }

    // Purpose if not already added with severity
    if (severity.length === 0 && purpose.length > 0) {
      differentiators.push(...purpose.slice(0, 1).map(s => this.shortenQualifier(s)));
    }

    // Imaging findings/modality - important for liver lesions etc.
    if (imaging.length > 0 && differentiators.length < 3) {
      differentiators.push(...imaging.slice(0, 1).map(s => this.shortenQualifier(s)));
    }

    // Other qualifiers as fallback
    if (differentiators.length === 0 && other.length > 0) {
      differentiators.push(...other.slice(0, 2).map(s => this.shortenQualifier(s)));
    }

    // Add differentiators to result (limit to 4 to keep readable but informative)
    if (differentiators.length > 0) {
      const displayDiffs = differentiators.slice(0, 4);
      result += ' (' + displayDiffs.join(', ') + ')';
    }

    return result;
  }

  // Shorten common qualifier phrases
  shortenQualifier(q) {
    return q
      .replace(/follow[- ]?up imaging/gi, 'F/U')
      .replace(/preop(erative)? planning/gi, 'preop')
      .replace(/posttreatment/gi, 'post-tx')
      .replace(/pretreatment/gi, 'pre-tx')
      .replace(/local recurrence surveillance/gi, 'recurrence surveil.')
      .replace(/without repair/gi, 'no repair')
      .replace(/without or with new symptoms/gi, 'new sx')
      .replace(/radiograph(y|s)? (normal|negative)/gi, 'XR neg')
      .replace(/radiograph(y|s)? (indeterminate)/gi, 'XR indet')
      .replace(/radiograph(y|s)? and noncontrast US nondiagnostic/gi, 'XR/US non-dx')
      .replace(/incidental finding on /gi, 'incidental ')
      .replace(/hx of extrahepatic malignancy/gi, 'hx malig')
      .replace(/hx of malignancy/gi, 'hx malig')
      .replace(/no hx of malignancy/gi, 'no hx malig')
      .replace(/cannot tolerate colonoscopy/gi, 'no colonoscopy')
      .replace(/incomplete colonoscopy/gi, 'incomplete scope')
      .replace(/no recurrence suspected/gi, 'no recurrence')
      .replace(/recurrence suspected/gi, 'recurrence?')
      .replace(/fracture completion risk/gi, 'fx completion')
      .replace(/immediate need-to-know/gi, 'urgent')
      .replace(/osteoporosis or bisphosphonate therapy/gi, 'osteoporosis/bisph')
      .replace(/aggressive appearance for malignancy/gi, 'aggressive')
      .replace(/benign appearance/gi, 'benign')
      .replace(/muscle invasive/gi, 'invasive')
      .replace(/nonmuscle invasive/gi, 'non-invasive')
      .replace(/determining extent/gi, 'extent')
      .replace(/associated complication/gi, 'complication')
      .replace(/arterial system/gi, 'artery')
      .replace(/urinary tract/gi, 'UT')
      .replace(/no response to conventional therapy/gi, 'tx-refractory')
      .replace(/no risk factors/gi, 'no RF')
      .replace(/risk factors/gi, 'RF')
      .replace(/MRI contraindicated/gi, 'no MRI')
      .replace(/contraindication to iodinated and gadolinium based contrast/gi, 'no contrast')
      .replace(/contraindication to iodinated contrast/gi, 'no iodine')
      .replace(/no contraindication to iodinated or gadolinium based contrast/gi, 'contrast OK')
      // New shortening rules
      .replace(/pretreatment staging/gi, 'staging')
      .replace(/active surveillance/gi, 'active surveil.')
      .replace(/systemic disease monitoring/gi, 'systemic')
      .replace(/curative resection/gi, 'curative')
      .replace(/after curative resection/gi, 'post-curative')
      .replace(/during palliation/gi, 'palliation')
      .replace(/during watch and wait/gi, 'watch & wait')
      .replace(/wait and watch/gi, 'watch & wait')
      .replace(/locoregional restaging/gi, 'restaging')
      .replace(/mets suspected/gi, 'mets?')
      .replace(/regional recurrence suspected/gi, 'regional recur?')
      .replace(/frequent relapses/gi, 'frequent relapse')
      .replace(/incidental finding on noncontrast MRI/gi, 'incidental MRI')
      .replace(/incidental finding on noncontrast or single phase CT/gi, 'incidental CT')
      .replace(/incidental finding on US/gi, 'incidental US')
      .replace(/US equivocal/gi, 'US equiv')
      .replace(/US negative/gi, 'US neg')
      .replace(/screening and surveillance/gi, 'screening')
      .replace(/post treatment imaging/gi, 'post-tx')
      .replace(/neoadjuvant therapy/gi, 'neoadjuvant')
      .replace(/surgical planning/gi, 'surgical plan')
      .replace(/distant metastatic evaluation/gi, 'distant mets')
      .replace(/postprocedure surveillance/gi, 'post-proc surveil.')
      .replace(/no hx of HCC/gi, 'no HCC hx')
      .replace(/hx of HCC/gi, 'HCC hx')
      .replace(/fibrosis suspected/gi, 'fibrosis?')
      .replace(/diagnosis and staging/gi, 'dx/staging')
      // Age and risk factor shortening
      .replace(/postmenopausal/gi, 'postmeno')
      .replace(/premenopausal/gi, 'premeno')
      .replace(/transfeminine/gi, 'transfem')
      .replace(/transmasculine/gi, 'transmasc')
      .replace(/family hx of ovarian cancer/gi, 'fam hx ovarian')
      .replace(/family hx of breast cancer/gi, 'fam hx breast')
      .replace(/family hx of AAA/gi, 'fam hx AAA')
      .replace(/personal hx of ovarian cancer/gi, 'pers hx ovarian')
      .replace(/personal hx of breast cancer/gi, 'pers hx breast')
      .replace(/genetic predisposition suspected/gi, 'genetic?')
      .replace(/genetic predisposition/gi, 'genetic')
      .replace(/elevated CA-125/gi, 'CA-125+')
      .replace(/with or without smoking hx/gi, 'smoking hx')
      .replace(/with or without family hx/gi, 'fam hx')
      .replace(/reduction mammoplasty/gi, 'mammoplasty')
      .replace(/personal hx lobular neoplasia/gi, 'pers hx lobular')
      .replace(/personal hx atypical ductal hyperplasia/gi, 'pers hx ADH')
      .replace(/15-20% lifetime risk/gi, '15-20% risk')
      .replace(/no hormone use/gi, 'no hormones')
      .replace(/pelvic US suspicious for malignancy/gi, 'US suspicious');
  }
}
