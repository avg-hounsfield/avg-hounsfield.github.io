// js/main.js - COMPLETE AND CORRECTED VERSION

// Import the render function at the very top
import { renderGroupedProtocols } from './render.js';
import { initFavorites, addFavoriteButtons } from './favorites.js';
import { QueryExpander } from './query-expansion.js';
import { initACRDatabase, isACRDatabaseReady, searchACRScenarios } from './acr-lookup.js';

// Mobile viewport optimization
function optimizeMobileViewport() {
    // Ensure proper viewport meta tag
    let viewport = document.querySelector("meta[name=viewport]");
    if (!viewport) {
        viewport = document.createElement('meta');
        viewport.name = 'viewport';
        document.head.appendChild(viewport);
    }
    viewport.content = 'width=device-width, initial-scale=1.0, user-scalable=yes, viewport-fit=cover';
    
    // Prevent zoom on input focus for better UX
    if (window.innerWidth <= 768) {
        const inputs = document.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            input.addEventListener('focus', () => {
                viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
            }, { passive: true });
            
            input.addEventListener('blur', () => {
                viewport.content = 'width=device-width, initial-scale=1.0, user-scalable=yes, viewport-fit=cover';
            }, { passive: true });
        });
    }
}

// The entire application logic is wrapped in this single event listener
document.addEventListener('DOMContentLoaded', () => {
    
    // Initialize mobile optimizations first
    optimizeMobileViewport();

    // --- DOM ELEMENTS ---
    // All element variables are declared together at the top for clarity
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const resultsContainer = document.getElementById('results');
    const dataSourceToggle = document.getElementById('dataSourceToggle');


    // --- STATE ---
    let allProtocols = [];
    let allOrders = [];
    let acrDatabaseLoading = false;
    let acrDatabaseLoaded = false;


    // --- FUNCTIONS ---

    /**
     * Extracts medical conditions from a clinical query using contextual patterns.
     * @param {string} query - The clinical query or phrase
     * @returns {string[]} - Array of extracted medical conditions
     */
    function extractMedicalConditions(query) {
        const queryLower = query.toLowerCase().trim();
        
        // Medical condition patterns and their synonyms/variations
        const medicalPatterns = {
            'stroke': [
                'stroke', 'cva', 'cerebrovascular accident', 'brain attack',
                'concern for stroke', 'stroke like', 'stroke-like', 'strokelike',
                'possible stroke', 'suspected stroke', 'r/o stroke', 'rule out stroke',
                'stroke symptoms', 'stroke workup', 'acute stroke'
            ],
            'headache': [
                'headache', 'head ache', 'cephalgia', 'head pain',
                'severe headache', 'chronic headache', 'migraine',
                'concern for headache', 'headache workup'
            ],
            'seizure': [
                'seizure', 'seizures', 'convulsion', 'epilepsy', 'fits',
                'seizure like', 'seizure-like', 'possible seizure',
                'concern for seizure', 'r/o seizure', 'rule out seizure',
                'seizure activity', 'convulsive episode'
            ],
            'trauma': [
                'trauma', 'injury', 'accident', 'fall', 'hit', 'struck',
                'head trauma', 'brain trauma', 'traumatic injury',
                'post trauma', 'after fall', 'motor vehicle accident', 'mva'
            ],
            'tumor': [
                'tumor', 'tumour', 'mass', 'lesion', 'growth', 'neoplasm',
                'brain tumor', 'brain mass', 'intracranial mass',
                'concern for tumor', 'possible tumor', 'r/o tumor',
                'rule out tumor', 'mass effect'
            ],
            'infection': [
                'infection', 'infectious', 'sepsis', 'abscess',
                'concern for infection', 'possible infection',
                'r/o infection', 'rule out infection'
            ],
            'meningitis': [
                'meningitis', 'meningeal', 'neck stiffness',
                'concern for meningitis', 'possible meningitis',
                'r/o meningitis', 'rule out meningitis'
            ],
            'altered mental status': [
                'altered mental status', 'ams', 'confusion', 'confused',
                'mental status change', 'altered consciousness',
                'cognitive change', 'behavioral change'
            ],
            'back pain': [
                'back pain', 'lower back pain', 'lumbar pain',
                'spine pain', 'spinal pain', 'dorsalgia'
            ],
            'neck pain': [
                'neck pain', 'cervical pain', 'cervicalgia'
            ],
            'sciatica': [
                'sciatica', 'sciatic pain', 'radicular pain',
                'leg pain', 'shooting pain down leg'
            ],
            'radiculopathy': [
                'radiculopathy', 'nerve root', 'pinched nerve',
                'compressed nerve', 'nerve compression'
            ],
            'chest pain': [
                'chest pain', 'chest discomfort', 'thoracic pain',
                'precordial pain', 'retrosternal pain'
            ],
            'shortness of breath': [
                'shortness of breath', 'dyspnea', 'sob', 'difficulty breathing',
                'breathing problems', 'breathlessness'
            ],
            'pulmonary embolism': [
                'pulmonary embolism', 'pe', 'blood clot', 'clot',
                'concern for pe', 'possible pe', 'r/o pe', 'rule out pe'
            ],
            'kidney stones': [
                'kidney stones', 'renal stones', 'nephrolithiasis',
                'kidney stone', 'renal calculi', 'ureteral stone'
            ],
            'abdominal pain': [
                'abdominal pain', 'belly pain', 'stomach pain',
                'abd pain', 'epigastric pain', 'right upper quadrant pain',
                'left lower quadrant pain', 'rlq pain', 'llq pain'
            ]
        };
        
        const extractedConditions = [];
        
        // Check each medical condition pattern - Edge compatible
        var conditionKeys = Object.keys(medicalPatterns);
        for (var i = 0; i < conditionKeys.length; i++) {
            var condition = conditionKeys[i];
            var patterns = medicalPatterns[condition];
            for (var j = 0; j < patterns.length; j++) {
                var pattern = patterns[j];
                if (queryLower.includes(pattern)) {
                    extractedConditions.push(condition);
                    break; // Don't add the same condition multiple times
                }
            }
        }
        
        return extractedConditions;
    }

    /**
     * Gets the maximum ACR appropriateness rating for a study based on the search query.
     * @param {Object} study - The study object with potential acrData
     * @param {string} query - The search query to match against ACR conditions
     * @returns {number} - The highest ACR rating found, or 0 if no ACR data
     */
    function getMaxAcrRating(study, query) {
        if (!study.acrData || !study.acrData.appropriateness) {
            return 0;
        }
        
        const appropriateness = study.acrData.appropriateness;
        let maxRating = 0;
        
        // Extract medical conditions from the query
        const extractedConditions = extractMedicalConditions(query);
        
        // If we found specific medical conditions, prioritize them
        if (extractedConditions.length > 0) {
            for (const condition of extractedConditions) {
                if (appropriateness[condition]) {
                    maxRating = Math.max(maxRating, appropriateness[condition].rating || 0);
                }
            }
        }
        
        // If no extracted conditions matched, fall back to simple keyword matching - Edge compatible
        if (maxRating === 0) {
            const queryLower = query.toLowerCase();
            var conditions = Object.keys(appropriateness);
            for (var i = 0; i < conditions.length; i++) {
                var condition = conditions[i];
                var data = appropriateness[condition];
                if (condition.toLowerCase().includes(queryLower) || 
                    queryLower.includes(condition.toLowerCase())) {
                    maxRating = Math.max(maxRating, data.rating || 0);
                }
            }
        }
        
        // If still no matches, return the highest rating overall for any condition - Edge compatible
        if (maxRating === 0) {
            var allConditions = Object.keys(appropriateness);
            for (var j = 0; j < allConditions.length; j++) {
                var conditionData = appropriateness[allConditions[j]];
                maxRating = Math.max(maxRating, conditionData.rating || 0);
            }
        }
        
        return maxRating;
    }

    /**
     * Toggles the visibility of an accordion panel with a smooth animation.
     * Mobile-optimized with better touch feedback.
     * @param {string} accordionId - The ID of the content panel to toggle.
     */
    function toggleAccordion(accordionId) {
        const content = document.getElementById(accordionId);
        if (!content) return;

        const header = document.querySelector(`[data-accordion-id="${accordionId}"]`);
        const toggleIcon = header ? header.querySelector('.accordion-toggle') : null;
        
        const isOpen = content.classList.contains('open');

        // Add visual feedback for touch
        if (header) {
            header.style.transform = 'scale(0.98)';
            setTimeout(() => {
                header.style.transform = '';
            }, 100);
        }

        if (isOpen) {
            content.classList.remove('open');
            content.style.maxHeight = '0px';
            if (toggleIcon) {
                toggleIcon.classList.remove('expanded');
                toggleIcon.style.transform = 'rotate(0deg)';
            }
        } else {
            content.classList.add('open');
            content.style.maxHeight = content.scrollHeight + 'px';
            if (toggleIcon) {
                toggleIcon.classList.add('expanded');
                toggleIcon.style.transform = 'rotate(180deg)';
            }
        }
    }

    /**
     * Initialize any accordions that start in the open state
     */
    function initializeOpenAccordions() {
        const openAccordions = document.querySelectorAll('.accordion-content.open');
        openAccordions.forEach(content => {
            content.style.maxHeight = content.scrollHeight + 'px';
        });
    }

    /**
     * Finds all accordion headers in the results and attaches click/touch listeners.
     * Mobile-optimized with passive listeners and touch feedback.
     */
    function attachAccordionListeners() {
        const accordionHeaders = document.querySelectorAll('[data-accordion-id]');
        accordionHeaders.forEach(header => {
            // Check if a listener has already been attached - Edge compatible
            if (!header.getAttribute('data-listener-attached')) {
                // Primary click handler - Edge compatible
                header.addEventListener('click', function(e) {
                    e.preventDefault();
                    const accordionId = header.getAttribute('data-accordion-id');
                    toggleAccordion(accordionId);
                });

                // Touch feedback for mobile - Edge compatible
                header.addEventListener('touchstart', function() {
                    header.style.opacity = '0.7';
                });

                header.addEventListener('touchend', function() {
                    header.style.opacity = '';
                });

                header.addEventListener('touchcancel', function() {
                    header.style.opacity = '';
                });

                header.setAttribute('data-listener-attached', 'true');
            }
        });
    }

    /**
     * Fetches protocol and order data from JSON files.
     */
    async function loadData() {
        if (!resultsContainer) return;
        resultsContainer.innerHTML = `<p>Loading data...</p>`;
        try {
            const [protocolRes, ordersRes] = await Promise.all([
                fetch('./data/protocols.json'),
                fetch('./data/imaging-orders.json')
            ]);
            if (!protocolRes.ok || !ordersRes.ok) throw new Error('Failed to fetch data files.');
            
            const protocolData = await protocolRes.json();
            const ordersData = await ordersRes.json();

            // Edge compatible flatMap alternative
            allProtocols = [];
            protocolData.forEach(function(p) {
                p.studies.forEach(function(s) {
                    var study = {};
                    for (var key in s) {
                        if (s.hasOwnProperty(key)) {
                            study[key] = s[key];
                        }
                    }
                    study.section = p.section[0];
                    allProtocols.push(study);
                });
            });
            
            allOrders = [];
            ordersData.forEach(function(o) {
                o.studies.forEach(function(s) {
                    var study = {};
                    for (var key in s) {
                        if (s.hasOwnProperty(key)) {
                            study[key] = s[key];
                        }
                    }
                    study.section = o.section[0];
                    allOrders.push(study);
                });
            });
            
            handleSearch(); // Initial render after data is loaded
            
        } catch (error) {
            console.error('Data loading error:', error);
            resultsContainer.innerHTML = `<p class="error">Could not load protocol data.</p>`;
        }
    }

    /**
     * Render ACR scenario results with appropriateness ratings
     */
    function renderACRResults(scenarios, query) {
        if (scenarios.length === 0) {
            return `<p>No ACR scenarios found for "${query}".</p>`;
        }

        const getRatingClass = (rating) => {
            if (rating >= 7) return 'rating-high';
            if (rating >= 4) return 'rating-medium';
            return 'rating-low';
        };

        const getRatingLabel = (rating) => {
            if (rating >= 7) return 'Usually Appropriate';
            if (rating >= 4) return 'May Be Appropriate';
            return 'Usually Not Appropriate';
        };

        const scenarioCards = scenarios.map((scenario, idx) => {
            const accordionId = `acr-${idx}-${Date.now()}`;
            const topProc = scenario.topProcedure;

            // Build procedures list
            const proceduresList = (scenario.procedures || []).map(proc => `
                <div class="acr-procedure-item ${getRatingClass(proc.rating)}">
                    <span class="proc-name">${escapeHtml(proc.name)}</span>
                    <span class="proc-modality">${escapeHtml(proc.modality)}</span>
                    <span class="proc-rating">${proc.rating}/9</span>
                </div>
            `).join('');

            return `
                <div class="protocol-card acr-scenario-card">
                    <div class="card-header" data-accordion-id="${accordionId}">
                        <div class="card-title-row">
                            <h3>${escapeHtml(simplifyScenarioName(scenario.name))}</h3>
                            ${topProc ? `
                                <span class="acr-badge ${getRatingClass(topProc.rating)}">
                                    ${topProc.modality} ${topProc.rating}/9
                                </span>
                            ` : ''}
                        </div>
                        <span class="body-region-tag">${escapeHtml(scenario.body_region || 'General')}</span>
                        <span class="accordion-toggle material-symbols-outlined">expand_more</span>
                    </div>
                    <div class="accordion-content" id="${accordionId}">
                        ${topProc ? `
                            <div class="primary-recommendation">
                                <div class="rec-label">Top Recommendation</div>
                                <div class="rec-study ${getRatingClass(topProc.rating)}">
                                    <span class="study-name">${escapeHtml(topProc.procedure_name)}</span>
                                    <span class="study-rating">${getRatingLabel(topProc.rating)}</span>
                                </div>
                            </div>
                        ` : ''}
                        ${scenario.clinical_summary ? `
                            <div class="clinical-summary">
                                <strong>Clinical Context:</strong>
                                <p>${escapeHtml(truncateSummary(scenario.clinical_summary, 300))}</p>
                            </div>
                        ` : ''}
                        ${proceduresList ? `
                            <div class="acr-procedures-list">
                                <strong>All Rated Procedures:</strong>
                                ${proceduresList}
                            </div>
                        ` : ''}
                        ${scenario.source_url ? `
                            <a href="${escapeHtml(scenario.source_url)}" target="_blank" class="acr-source-link">
                                <span class="material-symbols-outlined">open_in_new</span>
                                View on ACR
                            </a>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="results-section acr-results">
                <div class="section-header">
                    <h2>ACR Appropriateness Criteria</h2>
                    <span class="result-count">${scenarios.length} scenarios</span>
                </div>
                ${scenarioCards}
            </div>
        `;
    }

    /**
     * Simplify long ACR scenario names for display
     */
    function simplifyScenarioName(name) {
        if (!name) return 'Unknown';
        // Remove redundant prefixes
        let clean = name.replace(/^(Adult|Pediatric)\.\s*/i, '');
        // Truncate if too long
        if (clean.length > 80) {
            clean = clean.substring(0, 77) + '...';
        }
        return clean;
    }

    /**
     * Truncate text to a reasonable length
     */
    function truncateSummary(text, maxLen) {
        if (!text || text.length <= maxLen) return text;
        const truncated = text.substring(0, maxLen);
        const lastPeriod = truncated.lastIndexOf('.');
        if (lastPeriod > maxLen * 0.6) {
            return truncated.substring(0, lastPeriod + 1);
        }
        return truncated.trim() + '...';
    }

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
     * Handle ACR database search (for ORDERS mode)
     */
    async function handleACRSearch(query) {
        if (!resultsContainer) return;

        // Show loading state
        resultsContainer.innerHTML = `
            <div class="acr-loading">
                <div class="loading-spinner"></div>
                <p>Searching ACR database...</p>
            </div>
        `;

        try {
            // Ensure database is loaded
            if (!acrDatabaseLoaded) {
                await initACRDatabase();
                acrDatabaseLoaded = true;
            }

            // Expand layperson terms
            const expandedQuery = QueryExpander.expand(query);
            if (expandedQuery !== query) {
                console.log(`QueryExpander: "${query}" -> "${expandedQuery}"`);
            }

            // Search ACR scenarios
            const scenarios = await searchACRScenarios(expandedQuery, 15);
            console.log(`ACR Search: Found ${scenarios.length} scenarios for "${query}"`);

            // Render results
            resultsContainer.innerHTML = renderACRResults(scenarios, query);

            // Attach accordion listeners
            requestAnimationFrame(() => {
                attachAccordionListeners();
            });

        } catch (error) {
            console.error('ACR search error:', error);
            resultsContainer.innerHTML = `
                <div class="acr-error">
                    <span class="material-symbols-outlined">error</span>
                    <p>Error searching ACR database. Falling back to basic search.</p>
                </div>
            `;
            // Fallback to regular orders search
            handleProtocolSearch(query, true);
        }
    }

    /**
     * Handle protocol search (for PROTOCOLS mode)
     */
    function handleProtocolSearch(query, isOrdersMode) {
        const dataToSearch = isOrdersMode ? allOrders : allProtocols;

        // Apply layperson query expansion
        const expandedQuery = QueryExpander.expand(query);
        const searchTerms = expandedQuery.toLowerCase().split(/\s+/).filter(t => t.length > 1);

        if (expandedQuery !== query) {
            console.log(`QueryExpander: "${query}" -> "${expandedQuery}"`);
        }

        const results = dataToSearch.filter(item => {
            const studyLower = item.study.toLowerCase();
            const keywordsText = (item.keywords || []).join(' ').toLowerCase();
            const indicationText = (item.indication || '').toLowerCase();

            for (const term of searchTerms) {
                if (studyLower.includes(term)) return true;
                if (keywordsText.includes(term)) return true;
                if (indicationText.includes(term)) return true;
            }

            if (studyLower.includes(query) || keywordsText.includes(query)) return true;

            if (item.acrData && item.acrData.appropriateness) {
                const acrConditions = Object.keys(item.acrData.appropriateness);
                if (acrConditions.some(condition =>
                    condition.toLowerCase().includes(query) ||
                    query.includes(condition.toLowerCase()) ||
                    searchTerms.some(term => condition.toLowerCase().includes(term))
                )) return true;
            }

            return false;
        });

        // Sort by ACR appropriateness in orders mode
        if (isOrdersMode && (extractMedicalConditions(query).length > 0 ||
            results.some(r => r.acrData && r.acrData.appropriateness))) {
            results.sort((a, b) => {
                const aMaxRating = getMaxAcrRating(a, query);
                const bMaxRating = getMaxAcrRating(b, query);
                return bMaxRating - aMaxRating;
            });
        }

        console.log(`Found ${results.length} results for query "${query}":`, results.map(r => r.study));

        if (results.length === 0) {
            resultsContainer.innerHTML = `<p>No results found for "${query}".</p>`;
        } else {
            const grouped = results.reduce((acc, item) => {
                const key = item.section || 'Other';
                if (!acc[key]) acc[key] = [];
                acc[key].push(item);
                return acc;
            }, {});

            resultsContainer.innerHTML = renderGroupedProtocols(grouped, isOrdersMode, query);

            requestAnimationFrame(() => {
                attachAccordionListeners();
                addFavoriteButtons();
                initializeOpenAccordions();
            });
        }
    }

    /**
     * Filters data based on search query and renders the results.
     * Mobile-optimized with debouncing and performance improvements.
     */
    let searchTimeout;
    function handleSearch(immediate = false) {
        if (!searchInput || !dataSourceToggle || !resultsContainer) return;

        // Debounce search for mobile performance (except for immediate calls)
        if (!immediate) {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => handleSearch(true), 150);
            return;
        }

        const rawQuery = searchInput.value.toLowerCase().trim();
        const isOrdersMode = dataSourceToggle?.checked || false;

        if (!rawQuery) {
            resultsContainer.innerHTML = '';
            return;
        }

        // Use ACR database for ORDERS mode (comprehensive ACR data)
        if (isOrdersMode) {
            handleACRSearch(rawQuery);
            return;
        }

        // Use local protocols for PROTOCOLS mode (detailed sequences)
        handleProtocolSearch(rawQuery, false);
    }

    // --- EVENT LISTENERS ---

    // Mobile-optimized search event listeners
    if (searchButton && searchInput && dataSourceToggle) {
        // Immediate search on button click - Edge compatible
        searchButton.addEventListener('click', function() {
            handleSearch(true);
        });
        
        // Mobile-friendly search input handling - Edge compatible
        searchInput.addEventListener('input', handleSearch);
        searchInput.addEventListener('keyup', function(event) {
            // Edge compatible key check
            var key = event.key || event.keyCode;
            if (key === 'Enter' || key === 13) {
                event.preventDefault();
                handleSearch(true);
                // Blur input on mobile to hide keyboard
                if (window.innerWidth <= 768) {
                    searchInput.blur();
                }
            }
        });
        
        // Immediate search on toggle change - Edge compatible
        dataSourceToggle.addEventListener('change', function() {
            handleSearch(true);
        });
    }
    
    // --- INITIALIZATION ---
    // Initialize favorites system
    initFavorites();
    
    // Start the application by loading the data
    loadData();

});