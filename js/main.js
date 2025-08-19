// js/main.js - COMPLETE AND CORRECTED VERSION

// Import the render function at the very top
import { renderGroupedProtocols } from './render.js';
import { initFavorites, addFavoriteButtons } from './favorites.js';

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
    const dataSourceToggleMobile = document.getElementById('dataSourceToggleMobile');
    const ordersOnlyToggle = document.getElementById('ordersOnlyToggle');


    // --- STATE ---
    let allProtocols = [];
    let allOrders = [];


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

        const query = searchInput.value.toLowerCase().trim();
        const isOrdersMode = dataSourceToggle?.checked || dataSourceToggleMobile?.checked || ordersOnlyToggle?.checked || false;
        const dataToSearch = isOrdersMode ? allOrders : allProtocols;

        if (!query) {
            resultsContainer.innerHTML = '';
            return;
        }

        // Use requestAnimationFrame for smooth rendering on mobile
        requestAnimationFrame(() => {

            const results = dataToSearch.filter(item => {
                // Search in study name
                if (item.study.toLowerCase().includes(query)) {
                    return true;
                }
                
                // Search in keywords if they exist (protocols)
                if (item.keywords && Array.isArray(item.keywords)) {
                    if (item.keywords.some(keyword => 
                        keyword.toLowerCase().includes(query)
                    )) {
                        return true;
                    }
                }
                
                // Search in indication field (orders)
                if (item.indication && item.indication.toLowerCase().includes(query)) {
                    return true;
                }
                
                // Search in ACR appropriateness data (orders)
                if (item.acrData && item.acrData.appropriateness) {
                    const acrConditions = Object.keys(item.acrData.appropriateness);
                    if (acrConditions.some(condition => 
                        condition.toLowerCase().includes(query) || 
                        query.includes(condition.toLowerCase())
                    )) {
                        return true;
                    }
                }
                
                return false;
            });
            
            // Sort by ACR appropriateness when in orders mode and we have medical conditions or ACR data
            if (isOrdersMode && (extractMedicalConditions(query).length > 0 || 
                results.some(r => r.acrData && r.acrData.appropriateness))) {
                results.sort((a, b) => {
                    const aMaxRating = getMaxAcrRating(a, query);
                    const bMaxRating = getMaxAcrRating(b, query);
                    return bMaxRating - aMaxRating; // Sort highest rating first
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
                
                console.log('Grouped results:', grouped);
                resultsContainer.innerHTML = renderGroupedProtocols(grouped, isOrdersMode, query);
                
                // Use next frame for attaching listeners to prevent blocking
                requestAnimationFrame(() => {
                    attachAccordionListeners();
                    addFavoriteButtons();
                    initializeOpenAccordions();
                });
            }
        });
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
            // Sync mobile toggle with desktop toggle
            if (dataSourceToggleMobile) {
                dataSourceToggleMobile.checked = dataSourceToggle.checked;
            }
            handleSearch(true);
        });
    }
    
    // Mobile toggle event listener
    if (dataSourceToggleMobile) {
        dataSourceToggleMobile.addEventListener('change', function() {
            // Sync desktop toggle with mobile toggle
            if (dataSourceToggle) {
                dataSourceToggle.checked = dataSourceToggleMobile.checked;
            }
            handleSearch(true);
        });
    }
    
    // --- INITIALIZATION ---
    // Initialize favorites system
    initFavorites();
    
    // Start the application by loading the data
    loadData();

});