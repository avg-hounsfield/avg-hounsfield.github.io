/**
 * Recommendation Rendering Module v2
 *
 * Clinical algorithm-focused display.
 * Shows stepwise imaging workup, not just a flat list of options.
 */

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe || '';
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
export function renderRecommendationLoading() {
    return `
        <div class="recommendation-loading">
            <div class="loading-spinner"></div>
            <p>Analyzing clinical scenario...</p>
        </div>
    `;
}

/**
 * Render error state
 */
export function renderRecommendationError(message) {
    return `
        <div class="recommendation-error">
            <span class="material-symbols-outlined">error</span>
            <h3>Unable to generate recommendations</h3>
            <p>${escapeHtml(message)}</p>
            <p class="error-tip">Try rephrasing your clinical question or use more specific terms.</p>
        </div>
    `;
}

/**
 * Render clarification needed
 */
export function renderClarificationNeeded(result) {
    const { interpretation, clarifyingQuestions } = result;

    return `
        <div class="clarification-panel">
            <div class="clarification-header">
                <span class="material-symbols-outlined">help_outline</span>
                <h3>Help us understand better</h3>
            </div>

            ${interpretation ? `
                <p class="clarification-interpretation">
                    Looking for: <strong>${escapeHtml(interpretation)}</strong>
                </p>
            ` : ''}

            <div class="clarification-questions">
                <p>Please clarify:</p>
                <ul>
                    ${(clarifyingQuestions || []).map(q => `<li>${escapeHtml(q)}</li>`).join('')}
                </ul>
            </div>

            <div class="clarification-input">
                <input type="text" id="clarificationInput" placeholder="Type your response..." autocomplete="off">
                <button class="clarification-submit" id="submitClarification">
                    <span class="material-symbols-outlined">send</span>
                </button>
            </div>
        </div>
    `;
}

/**
 * Main recommendation renderer - Algorithm-focused
 */
export function renderRecommendations(result) {
    const { interpretation, recommendations, clinicalContext } = result;

    if (!recommendations) {
        return renderRecommendationError('No matching imaging scenarios found.');
    }

    const { scenario, procedures, clinicalSummary, variants, relatedScenarios } = recommendations;

    // Build the algorithm from procedures
    const algorithm = buildClinicalAlgorithm(procedures, scenario);

    return `
        <div class="recommendation-result">
            <!-- Matched Condition Header -->
            <div class="condition-header">
                <div class="condition-badge">
                    <span class="material-symbols-outlined">clinical_notes</span>
                    ACR Appropriateness Criteria
                </div>
                <h2 class="condition-title">${escapeHtml(simplifyScenarioName(scenario.name))}</h2>
                <p class="condition-region">${escapeHtml(formatBodyRegion(scenario.bodyRegion))}</p>
            </div>

            ${interpretation ? `
                <div class="interpretation-banner">
                    <span class="material-symbols-outlined">lightbulb</span>
                    ${escapeHtml(interpretation)}
                </div>
            ` : ''}

            <!-- Primary Recommendation (The Answer) -->
            ${algorithm.primary ? `
                <div class="primary-recommendation">
                    <div class="primary-label">
                        <span class="gold-badge">1st</span>
                        Recommended First-Line Study
                    </div>
                    <div class="primary-study">
                        <div class="study-name">${escapeHtml(algorithm.primary.name)}</div>
                        <div class="study-meta">
                            <span class="modality-badge">${escapeHtml(algorithm.primary.modality)}</span>
                            <span class="rating-badge high">${algorithm.primary.rating}/9</span>
                        </div>
                        ${algorithm.primary.rationale ? `
                            <p class="study-rationale">${escapeHtml(algorithm.primary.rationale)}</p>
                        ` : ''}
                    </div>
                </div>
            ` : ''}

            <!-- Secondary Options -->
            ${algorithm.secondary.length > 0 ? `
                <div class="secondary-recommendations">
                    <div class="section-label">
                        <span class="silver-badge">2nd</span>
                        Additional/Follow-up Studies
                    </div>
                    <div class="study-list">
                        ${algorithm.secondary.map(proc => `
                            <div class="study-item">
                                <div class="study-info">
                                    <span class="study-name">${escapeHtml(proc.name)}</span>
                                    <span class="modality-tag">${escapeHtml(proc.modality)}</span>
                                </div>
                                <span class="rating-pill high">${proc.rating}/9</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            <!-- Alternative Options (May Be Appropriate) -->
            ${algorithm.alternatives.length > 0 ? `
                <div class="alternative-recommendations">
                    <div class="section-label">
                        <span class="alt-badge">Alt</span>
                        May Be Appropriate (case-dependent)
                    </div>
                    <div class="study-list compact">
                        ${algorithm.alternatives.slice(0, 5).map(proc => `
                            <div class="study-item small">
                                <span class="study-name">${escapeHtml(proc.name)}</span>
                                <span class="rating-pill medium">${proc.rating}/9</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            <!-- Clinical Context (Collapsed) -->
            ${clinicalSummary ? `
                <details class="clinical-context">
                    <summary>
                        <span class="material-symbols-outlined">info</span>
                        Clinical Background
                    </summary>
                    <p>${escapeHtml(truncateText(clinicalSummary, 600))}</p>
                </details>
            ` : ''}

            <!-- Variants (if multiple) -->
            ${variants && variants.length > 1 ? `
                <details class="variants-section">
                    <summary>
                        <span class="material-symbols-outlined">list</span>
                        ${variants.length} Clinical Variants
                    </summary>
                    <ul class="variants-list">
                        ${variants.slice(0, 8).map(v => `
                            <li>${escapeHtml(v.name)}</li>
                        `).join('')}
                        ${variants.length > 8 ? `<li class="more">+${variants.length - 8} more...</li>` : ''}
                    </ul>
                </details>
            ` : ''}

            <!-- Related Scenarios -->
            ${relatedScenarios && relatedScenarios.length > 0 ? `
                <div class="related-section">
                    <span class="related-label">Related:</span>
                    ${relatedScenarios.map(s => `
                        <button class="related-chip" data-scenario-name="${escapeHtml(s.name)}">
                            ${escapeHtml(truncateText(s.name, 30))}
                        </button>
                    `).join('')}
                </div>
            ` : ''}

            <!-- Footer -->
            <div class="recommendation-footer">
                <p class="disclaimer">Based on ACR Appropriateness Criteria. Clinical judgment should always be applied.</p>
            </div>
        </div>
    `;
}

/**
 * Build a clinical algorithm from flat procedure list
 * Identifies primary study, secondary studies, and alternatives
 */
function buildClinicalAlgorithm(procedures, scenario) {
    const { usuallyAppropriate, mayBeAppropriate } = procedures;

    // Define clinical priorities for different modalities
    const modalityPriority = {
        'CT': 1,      // Usually fastest, most available for emergent
        'XR': 2,      // Fast, cheap, first for trauma
        'US': 3,      // No radiation, good for certain indications
        'MRI': 4,     // Most sensitive but slower
        'CTA': 5,     // Vascular evaluation
        'MRA': 6,     // Vascular without radiation
        'PET': 7,     // Specialized
        'NM': 8,      // Specialized
    };

    // Get contrast preference (without > with for most scenarios)
    const contrastPriority = (proc) => {
        if (proc.usesContrast === 0) return 0; // No contrast preferred
        if (proc.usesContrast === 2) return 1; // With/without
        return 2; // With contrast
    };

    // Sort usually appropriate by: rating DESC, modality priority, contrast preference
    const sortedAppropriate = [...usuallyAppropriate].sort((a, b) => {
        // First by rating
        if (b.rating !== a.rating) return b.rating - a.rating;
        // Then by modality priority (lower = more primary)
        const aPriority = modalityPriority[a.modality] || 10;
        const bPriority = modalityPriority[b.modality] || 10;
        if (aPriority !== bPriority) return aPriority - bPriority;
        // Then by contrast (no contrast first)
        return contrastPriority(a) - contrastPriority(b);
    });

    // Determine primary recommendation
    let primary = null;
    let secondary = [];

    if (sortedAppropriate.length > 0) {
        primary = sortedAppropriate[0];

        // Add clinical rationale based on modality
        primary.rationale = getModalityRationale(primary.modality, scenario.bodyRegion);

        // Secondary: other high-rated but different modalities
        const usedModalities = new Set([primary.modality]);
        for (const proc of sortedAppropriate.slice(1)) {
            // Include if it's a different modality family
            const modalityFamily = getModalityFamily(proc.modality);
            const primaryFamily = getModalityFamily(primary.modality);

            if (modalityFamily !== primaryFamily && secondary.length < 4) {
                secondary.push(proc);
                usedModalities.add(proc.modality);
            }
        }
    }

    return {
        primary,
        secondary,
        alternatives: mayBeAppropriate.slice(0, 5)
    };
}

/**
 * Get modality family (CT/CTA are same family, MRI/MRA are same family)
 */
function getModalityFamily(modality) {
    if (['CT', 'CTA'].includes(modality)) return 'CT';
    if (['MRI', 'MRA', 'MRV'].includes(modality)) return 'MRI';
    return modality;
}

/**
 * Generate rationale for primary modality choice
 */
function getModalityRationale(modality, bodyRegion) {
    const rationales = {
        'CT': {
            'neuro': 'Fast, widely available. First-line to exclude hemorrhage.',
            'chest': 'Excellent for lung parenchyma and mediastinum.',
            'abdomen': 'Comprehensive evaluation of abdominal pathology.',
            'default': 'Fast, widely available, excellent spatial resolution.'
        },
        'MRI': {
            'neuro': 'Most sensitive for parenchymal abnormalities.',
            'spine': 'Best for soft tissue, cord, and disc evaluation.',
            'msk': 'Superior soft tissue contrast for joints and tendons.',
            'default': 'Superior soft tissue characterization.'
        },
        'US': {
            'abdomen': 'No radiation, excellent for biliary and renal evaluation.',
            'peds': 'No radiation, no sedation required.',
            'default': 'Real-time, no radiation, portable.'
        },
        'XR': {
            'chest': 'Fast, low-cost screening for acute pathology.',
            'msk': 'First-line for fracture evaluation.',
            'default': 'Fast, widely available, low radiation.'
        }
    };

    const modalityRationales = rationales[modality] || {};
    return modalityRationales[bodyRegion] || modalityRationales['default'] || '';
}

/**
 * Simplify verbose scenario names
 */
function simplifyScenarioName(name) {
    if (!name) return 'Clinical Scenario';

    // Remove common suffixes
    let simplified = name
        .replace(/,\s*initial imaging\.?$/i, '')
        .replace(/,\s*follow[- ]?up imaging\.?$/i, '')
        .replace(/,\s*surveillance\.?$/i, '')
        .replace(/,\s*emergent imaging\.?$/i, '');

    // Capitalize properly
    return simplified.charAt(0).toUpperCase() + simplified.slice(1);
}

/**
 * Format body region for display
 */
function formatBodyRegion(region) {
    if (!region) return 'General';
    const formatted = {
        'neuro': 'Neuroimaging',
        'spine': 'Spine',
        'chest': 'Chest',
        'abdomen': 'Abdomen/Pelvis',
        'msk': 'Musculoskeletal',
        'breast': 'Breast',
        'vascular': 'Vascular',
        'peds': 'Pediatric'
    };
    return formatted[region.toLowerCase()] || region;
}

/**
 * Truncate text
 */
function truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    const truncated = text.substring(0, maxLength);
    const lastPeriod = truncated.lastIndexOf('.');
    if (lastPeriod > maxLength * 0.6) {
        return truncated.substring(0, lastPeriod + 1);
    }
    return truncated.trim() + '...';
}

/**
 * Welcome state
 */
export function renderWelcomeState(stats) {
    return `
        <div class="welcome-container">
            <div class="welcome-header">
                <span class="material-symbols-outlined welcome-icon">radiology</span>
                <h2>What imaging should I order?</h2>
                <p>Describe your clinical scenario for ACR-based recommendations</p>
            </div>

            <div class="example-queries">
                <p class="examples-label">Try these:</p>
                <div class="example-chips">
                    <button class="example-chip" data-query="acute stroke symptoms">Acute stroke</button>
                    <button class="example-chip" data-query="worst headache of life">Thunderclap headache</button>
                    <button class="example-chip" data-query="low back pain with radiculopathy">Back pain + radiculopathy</button>
                    <button class="example-chip" data-query="right lower quadrant pain appendicitis">RLQ pain</button>
                    <button class="example-chip" data-query="pulmonary embolism">Suspected PE</button>
                    <button class="example-chip" data-query="knee injury ACL tear">Knee injury</button>
                </div>
            </div>

            <div class="stats-bar">
                <div class="stat-item">
                    <span class="stat-value">${(stats?.scenarios || 0).toLocaleString()}</span>
                    <span class="stat-label">Clinical Scenarios</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${(stats?.ratings || 0).toLocaleString()}</span>
                    <span class="stat-label">ACR Ratings</span>
                </div>
            </div>
        </div>
    `;
}
