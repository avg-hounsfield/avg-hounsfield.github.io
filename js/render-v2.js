/**
 * Rendering Module v2
 *
 * Professional card designs with prominent ACR appropriateness scoring.
 * Scenario-centric layout with integrated MRI protocol information.
 */

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Render loading state
 */
export function renderLoading() {
    return `
        <div class="loading-container">
            <div class="loading-spinner"></div>
            <p class="loading-text">Loading imaging database...</p>
            <p class="loading-subtext">This may take a moment on first load</p>
        </div>
    `;
}

/**
 * Render error state
 */
export function renderError(title, message) {
    return `
        <div class="error-container">
            <span class="material-symbols-outlined error-icon">error</span>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(message)}</p>
            <button onclick="location.reload()" class="retry-btn">
                <span class="material-symbols-outlined">refresh</span>
                Retry
            </button>
        </div>
    `;
}

/**
 * Render empty results
 */
export function renderEmpty(query) {
    return `
        <div class="empty-container">
            <span class="material-symbols-outlined empty-icon">search_off</span>
            <h3>No results found</h3>
            <p>No imaging scenarios match "<strong>${escapeHtml(query)}</strong>"</p>
            <div class="search-tips">
                <p>Try:</p>
                <ul>
                    <li>Using different keywords (e.g., "headache" instead of "head pain")</li>
                    <li>Searching by body part (e.g., "brain", "knee", "spine")</li>
                    <li>Searching by condition (e.g., "stroke", "tumor", "fracture")</li>
                </ul>
            </div>
        </div>
    `;
}

/**
 * Render welcome screen with stats
 */
export function renderWelcome(stats) {
    return `
        <div class="welcome-container">
            <div class="welcome-header">
                <span class="material-symbols-outlined welcome-icon">medical_information</span>
                <h2>Search Clinical Imaging Scenarios</h2>
                <p>Find the right imaging study with ACR Appropriateness Criteria</p>
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <span class="stat-number">${(stats.scenarios || 0).toLocaleString()}</span>
                    <span class="stat-label">Clinical Scenarios</span>
                </div>
                <div class="stat-card">
                    <span class="stat-number">${(stats.procedures || 0).toLocaleString()}</span>
                    <span class="stat-label">Imaging Procedures</span>
                </div>
                <div class="stat-card">
                    <span class="stat-number">${(stats.protocols || 0).toLocaleString()}</span>
                    <span class="stat-label">MRI Protocols</span>
                </div>
                <div class="stat-card">
                    <span class="stat-number">${(stats.ratings || 0).toLocaleString()}</span>
                    <span class="stat-label">ACR Ratings</span>
                </div>
            </div>

            <div class="quick-searches">
                <p class="quick-label">Popular searches:</p>
                <div class="quick-chips">
                    <button class="quick-chip" onclick="document.getElementById('searchInput').value='headache';window.protocolApp.performSearch('headache')">Headache</button>
                    <button class="quick-chip" onclick="document.getElementById('searchInput').value='stroke';window.protocolApp.performSearch('stroke')">Stroke</button>
                    <button class="quick-chip" onclick="document.getElementById('searchInput').value='knee pain';window.protocolApp.performSearch('knee pain')">Knee Pain</button>
                    <button class="quick-chip" onclick="document.getElementById('searchInput').value='back pain';window.protocolApp.performSearch('back pain')">Back Pain</button>
                    <button class="quick-chip" onclick="document.getElementById('searchInput').value='chest pain';window.protocolApp.performSearch('chest pain')">Chest Pain</button>
                    <button class="quick-chip" onclick="document.getElementById('searchInput').value='tumor';window.protocolApp.performSearch('tumor')">Tumor</button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Group scenarios by their base condition (first part of title before comma)
 */
function groupScenariosByBase(scenarios) {
    const groups = new Map();

    scenarios.forEach(scenario => {
        const { base } = parseScenarioTitle(scenario.scenario_name);
        const baseNormalized = base.toLowerCase().trim();

        if (!groups.has(baseNormalized)) {
            groups.set(baseNormalized, {
                baseName: base,
                scenarios: [],
                topRating: 0,
                bodyRegion: scenario.body_region
            });
        }

        const group = groups.get(baseNormalized);
        group.scenarios.push(scenario);
        group.topRating = Math.max(group.topRating, scenario.topRating || 0);
    });

    // Convert to array and sort by top rating
    return Array.from(groups.values())
        .sort((a, b) => b.topRating - a.topRating);
}

/**
 * Render search results
 */
export function renderResults(results, query, options = {}) {
    const { scenarios, protocols, totalCount } = results;
    const { aiEnhanced, aiInterpretation } = options;

    let html = `
        <div class="results-header">
            <span class="results-count">${totalCount} result${totalCount !== 1 ? 's' : ''}</span>
            <span class="results-query">for "${escapeHtml(query)}"</span>
            ${aiEnhanced ? '<span class="ai-badge"><span class="material-symbols-outlined">smart_toy</span>AI Enhanced</span>' : ''}
        </div>
    `;

    // Show AI interpretation if available
    if (aiEnhanced && aiInterpretation) {
        html += `
            <div class="ai-interpretation">
                <span class="material-symbols-outlined">lightbulb</span>
                <span>${escapeHtml(aiInterpretation)}</span>
            </div>
        `;
    }

    // Show MRI Protocols first if any exist (more actionable for users)
    if (protocols.length > 0) {
        html += `
            <section class="results-section protocols-section-highlight">
                <h2 class="section-title">
                    <span class="material-symbols-outlined">radiology</span>
                    MRI Protocols
                    <span class="section-count">${protocols.length}</span>
                </h2>
                <div class="protocols-grid">
                    ${protocols.map(p => renderProtocolCard(p, true)).join('')}
                </div>
            </section>
        `;
    }

    // Render scenarios grouped by base condition
    if (scenarios.length > 0) {
        const groupedScenarios = groupScenariosByBase(scenarios);
        const groupCount = groupedScenarios.length;

        html += `
            <section class="results-section">
                <h2 class="section-title">
                    <span class="material-symbols-outlined">clinical_notes</span>
                    Clinical Scenarios
                    <span class="section-count">${scenarios.length} in ${groupCount} group${groupCount !== 1 ? 's' : ''}</span>
                </h2>
                <div class="scenarios-grid">
                    ${groupedScenarios.map(group =>
                        group.scenarios.length === 1
                            ? renderScenarioCard(group.scenarios[0], query)
                            : renderScenarioGroup(group, query)
                    ).join('')}
                </div>
            </section>
        `;
    }

    return html;
}

/**
 * Render a group of related scenarios under one card
 */
function renderScenarioGroup(group, query) {
    const accordionId = `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const topRating = group.topRating || 0;
    const ratingClass = getRatingClass(topRating);
    const ratingText = getRatingText(topRating);

    // Find the best (highest rated) scenario to show its procedures
    const bestScenario = group.scenarios.reduce((best, s) =>
        (s.topRating || 0) > (best.topRating || 0) ? s : best, group.scenarios[0]);

    const topProcedures = (bestScenario.procedures || []).slice(0, 5);

    return `
        <article class="scenario-card scenario-group ${ratingClass}">
            <header class="scenario-header">
                <div class="scenario-title-row">
                    <h3 class="scenario-title">${escapeHtml(group.baseName)}</h3>
                    ${topRating > 0 ? `
                        <div class="acr-score ${ratingClass}">
                            <span class="acr-number">${topRating}</span>
                            <span class="acr-max">/9</span>
                        </div>
                    ` : ''}
                </div>

                <div class="scenario-meta">
                    <span class="meta-badge region-badge">${escapeHtml(formatBodyRegion(group.bodyRegion))}</span>
                    <span class="meta-badge group-badge">
                        <span class="material-symbols-outlined">folder</span>
                        ${group.scenarios.length} sub-scenarios
                    </span>
                    ${topRating > 0 ? `
                        <span class="meta-badge rating-badge ${ratingClass}">${ratingText}</span>
                    ` : ''}
                </div>
            </header>

            <!-- Sub-scenarios list -->
            <div class="sub-scenarios-section">
                <div class="sub-scenarios-header" data-accordion-id="${accordionId}-subs">
                    <h4>
                        <span class="material-symbols-outlined">list</span>
                        Clinical Variants
                    </h4>
                    <span class="material-symbols-outlined accordion-icon">expand_more</span>
                </div>
                <div class="sub-scenarios-content accordion-content" id="${accordionId}-subs">
                    <ul class="sub-scenarios-list">
                        ${group.scenarios.map(s => renderSubScenarioItem(s)).join('')}
                    </ul>
                </div>
            </div>

            ${topProcedures.length > 0 ? `
                <div class="procedures-section">
                    <div class="procedures-header" data-accordion-id="${accordionId}-procs">
                        <h4>
                            <span class="material-symbols-outlined">format_list_bulleted</span>
                            Top Recommended Imaging
                        </h4>
                        <span class="material-symbols-outlined accordion-icon">expand_more</span>
                    </div>
                    <div class="procedures-content accordion-content" id="${accordionId}-procs">
                        <ul class="procedures-list">
                            ${topProcedures.map(p => renderProcedureItem(p)).join('')}
                        </ul>
                    </div>
                </div>
            ` : ''}

            <footer class="scenario-footer">
                <button class="favorite-btn" data-type="scenario-group" data-id="${group.baseName}" title="Save to favorites">
                    <span class="material-symbols-outlined">bookmark_border</span>
                </button>
            </footer>
        </article>
    `;
}

/**
 * Render a sub-scenario item within a group
 */
function renderSubScenarioItem(scenario) {
    const { qualifiers, action } = parseScenarioTitle(scenario.scenario_name);
    const rating = scenario.topRating || 0;
    const ratingClass = getRatingClass(rating);

    // Build display text from qualifiers and action
    let displayText = qualifiers.join(', ');
    if (action && !displayText.toLowerCase().includes(action.toLowerCase())) {
        displayText = displayText ? `${displayText} — ${action}` : action;
    }
    if (!displayText) {
        displayText = 'General case';
    }

    return `
        <li class="sub-scenario-item ${ratingClass}">
            <div class="sub-scenario-main">
                <span class="sub-scenario-text">${escapeHtml(displayText)}</span>
                ${scenario.variant_count > 1 ? `
                    <span class="variant-count" title="${scenario.variant_count} patient variants">${scenario.variant_count}v</span>
                ` : ''}
            </div>
            <div class="sub-scenario-rating">
                <span class="rating-value ${ratingClass}">${rating}/9</span>
            </div>
        </li>
    `;
}

/**
 * Parse scenario title to extract base condition and qualifiers
 * ACR titles follow pattern: "Base condition, qualifier1, qualifier2, ..., action"
 */
function parseScenarioTitle(title) {
    if (!title) return { base: 'Unknown', qualifiers: [], action: '' };

    // Split by comma
    const parts = title.split(',').map(p => p.trim()).filter(Boolean);

    if (parts.length <= 1) {
        return { base: title, qualifiers: [], action: '' };
    }

    // First part is the base condition
    const base = parts[0];

    // Last part is often the action (e.g., "initial imaging", "surveillance")
    const lastPart = parts[parts.length - 1].toLowerCase();
    const isAction = lastPart.includes('imaging') ||
                     lastPart.includes('surveillance') ||
                     lastPart.includes('evaluation') ||
                     lastPart.includes('follow-up') ||
                     lastPart.includes('screening');

    const action = isAction ? parts[parts.length - 1] : '';
    const qualifiers = isAction ? parts.slice(1, -1) : parts.slice(1);

    return { base, qualifiers, action };
}

/**
 * Render a scenario card with ACR ratings
 */
function renderScenarioCard(scenario, query) {
    const accordionId = `scenario-${scenario.scenario_id}-${Date.now()}`;
    const topRating = scenario.topRating || 0;
    const ratingClass = getRatingClass(topRating);
    const ratingText = getRatingText(topRating);

    // Parse title into base + qualifiers + action
    const { base: baseTitle, qualifiers, action } = parseScenarioTitle(scenario.scenario_name);

    // Get top 5 procedures
    const topProcedures = (scenario.procedures || []).slice(0, 5);
    const hasMoreProcedures = (scenario.procedures || []).length > 5;

    return `
        <article class="scenario-card ${ratingClass}">
            <header class="scenario-header">
                <div class="scenario-title-row">
                    <h3 class="scenario-title">${escapeHtml(baseTitle)}</h3>
                    ${topRating > 0 ? `
                        <div class="acr-score ${ratingClass}">
                            <span class="acr-number">${topRating}</span>
                            <span class="acr-max">/9</span>
                        </div>
                    ` : ''}
                </div>

                ${qualifiers.length > 0 ? `
                    <div class="scenario-qualifiers">
                        ${qualifiers.map(q => `<span class="qualifier-tag">${escapeHtml(q)}</span>`).join('')}
                    </div>
                ` : ''}

                <div class="scenario-meta">
                    <span class="meta-badge region-badge">${escapeHtml(formatBodyRegion(scenario.body_region))}</span>
                    ${action ? `
                        <span class="meta-badge action-badge">${escapeHtml(action)}</span>
                    ` : ''}
                    ${scenario.variant_count > 1 ? `
                        <span class="meta-badge variants-badge" title="Clinical sub-scenarios with specific patient presentations or conditions">
                            ${scenario.variant_count} variants
                        </span>
                    ` : ''}
                    ${topRating > 0 ? `
                        <span class="meta-badge rating-badge ${ratingClass}">${ratingText}</span>
                    ` : ''}
                </div>
            </header>

            ${scenario.description ? `
                <p class="scenario-description">${escapeHtml(smartTruncate(scenario.description, 180))}</p>
            ` : ''}

            ${topProcedures.length > 0 ? `
                <div class="procedures-section">
                    <div class="procedures-header" data-accordion-id="${accordionId}">
                        <h4>
                            <span class="material-symbols-outlined">format_list_bulleted</span>
                            Recommended Imaging
                        </h4>
                        <span class="material-symbols-outlined accordion-icon">expand_more</span>
                    </div>
                    <div class="procedures-content accordion-content" id="${accordionId}">
                        <ul class="procedures-list">
                            ${topProcedures.map(p => renderProcedureItem(p)).join('')}
                        </ul>
                        ${hasMoreProcedures ? `
                            <p class="more-procedures">
                                +${(scenario.procedures || []).length - 5} more procedures
                            </p>
                        ` : ''}
                    </div>
                </div>
            ` : ''}

            <footer class="scenario-footer">
                <button class="favorite-btn" data-type="scenario" data-id="${scenario.scenario_id}" title="Save to favorites">
                    <span class="material-symbols-outlined">bookmark_border</span>
                </button>
            </footer>
        </article>
    `;
}

/**
 * Render a procedure item within a scenario
 */
function renderProcedureItem(procedure) {
    const rating = procedure.rating || 0;
    const ratingClass = getRatingClass(rating);

    return `
        <li class="procedure-item ${ratingClass}">
            <div class="procedure-main">
                <span class="procedure-name">${escapeHtml(procedure.procedure_name)}</span>
                <div class="procedure-badges">
                    <span class="modality-badge">${escapeHtml(procedure.modality || 'Unknown')}</span>
                    ${procedure.uses_contrast ? '<span class="contrast-badge">Contrast</span>' : ''}
                </div>
            </div>
            <div class="procedure-rating">
                <div class="rating-bar">
                    <div class="rating-fill ${ratingClass}" style="width: ${(rating / 9) * 100}%"></div>
                </div>
                <span class="rating-value ${ratingClass}">${rating}/9</span>
            </div>
            ${procedure.rating_level ? `
                <span class="rating-label ${ratingClass}">${escapeHtml(procedure.rating_level)}</span>
            ` : ''}
        </li>
    `;
}

/**
 * Render an MRI protocol card
 * @param {Object} protocol - Protocol data
 * @param {boolean} expandSequences - Whether to show sequences expanded by default
 */
function renderProtocolCard(protocol, expandSequences = false) {
    const accordionId = `protocol-${protocol.id}-${Date.now()}`;
    const hasSequences = protocol.sequences && protocol.sequences.length > 0;
    const hasScannerNotes = protocol.scannerNotes && Object.keys(protocol.scannerNotes).length > 0;

    return `
        <article class="protocol-card">
            <header class="protocol-header">
                <div class="protocol-title-row">
                    <h3 class="protocol-title">${escapeHtml(protocol.name)}</h3>
                    <div class="protocol-badges">
                        <span class="section-badge">${escapeHtml(protocol.section)}</span>
                        ${protocol.uses_contrast ?
                            '<span class="contrast-badge yes">With Contrast</span>' :
                            '<span class="contrast-badge no">No Contrast</span>'
                        }
                    </div>
                </div>
            </header>

            ${protocol.indications ? `
                <p class="protocol-indications">${escapeHtml(truncateText(protocol.indications, 200))}</p>
            ` : ''}

            ${hasSequences ? `
                <div class="sequences-section">
                    <div class="sequences-header" data-accordion-id="${accordionId}">
                        <h4>
                            <span class="material-symbols-outlined">view_list</span>
                            Sequences (${protocol.sequences.length})
                        </h4>
                        <span class="material-symbols-outlined accordion-icon ${expandSequences ? 'rotated' : ''}">expand_more</span>
                    </div>
                    <div class="sequences-content accordion-content ${expandSequences ? 'open' : ''}" id="${accordionId}" ${expandSequences ? 'style="max-height: 2000px;"' : ''}>
                        <ul class="sequences-list">
                            ${protocol.sequences.map(seq => `
                                <li class="${seq.is_post_contrast ? 'post-contrast' : ''}">
                                    ${escapeHtml(seq.sequence_name)}
                                    ${seq.is_post_contrast ? '<span class="post-badge">POST</span>' : ''}
                                </li>
                            `).join('')}
                        </ul>

                        ${hasScannerNotes ? `
                            <div class="scanner-notes">
                                <h5>Scanner-Specific Notes</h5>
                                ${Object.entries(protocol.scannerNotes).map(([scanner, notes]) => `
                                    <div class="scanner-group">
                                        <span class="scanner-name">${escapeHtml(scanner)}:</span>
                                        <ul>
                                            ${notes.map(n => `
                                                <li class="${n.is_post_contrast ? 'post-contrast' : ''}">
                                                    ${escapeHtml(n.sequence_name)}
                                                </li>
                                            `).join('')}
                                        </ul>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}

                        ${protocol.contrast_rationale ? `
                            <div class="contrast-rationale">
                                <h5>Contrast Rationale</h5>
                                <p>${escapeHtml(protocol.contrast_rationale)}</p>
                            </div>
                        ` : ''}
                    </div>
                </div>
            ` : ''}

            <footer class="protocol-footer">
                <button class="favorite-btn" data-type="protocol" data-id="${protocol.id}" title="Save to favorites">
                    <span class="material-symbols-outlined">bookmark_border</span>
                </button>
            </footer>
        </article>
    `;
}

/**
 * Helper: Get rating CSS class
 */
function getRatingClass(rating) {
    if (rating >= 7) return 'rating-high';
    if (rating >= 4) return 'rating-medium';
    if (rating > 0) return 'rating-low';
    return 'rating-none';
}

/**
 * Helper: Get rating text
 */
function getRatingText(rating) {
    if (rating >= 7) return 'Usually Appropriate';
    if (rating >= 4) return 'May Be Appropriate';
    if (rating > 0) return 'Usually Not Appropriate';
    return '';
}

/**
 * Helper: Format body region for display
 */
function formatBodyRegion(region) {
    if (!region) return 'Unknown';
    const formatted = {
        'neuro': 'Neuro',
        'spine': 'Spine',
        'chest': 'Chest',
        'abdomen': 'Abdomen',
        'msk': 'MSK',
        'breast': 'Breast',
        'vascular': 'Vascular',
        'peds': 'Pediatrics',
        'other': 'Other'
    };
    return formatted[region.toLowerCase()] || region;
}

/**
 * Helper: Truncate text (simple)
 */
function truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
}

/**
 * Helper: Smart truncate at word boundary
 */
function smartTruncate(text, maxLength) {
    if (!text || text.length <= maxLength) return text;

    // Find the last space before maxLength
    let truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');

    // If we found a space, truncate there
    if (lastSpace > maxLength * 0.6) {
        truncated = truncated.substring(0, lastSpace);
    }

    // Remove trailing punctuation except periods
    truncated = truncated.replace(/[,;:\-]$/, '');

    return truncated.trim() + '...';
}
