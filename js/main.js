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


    // --- STATE ---
    let allProtocols = [];
    let allOrders = [];

    // --- FUNCTIONS ---

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
            // Check if a listener has already been attached
            if (!header.dataset.listenerAttached) {
                // Primary click handler
                header.addEventListener('click', (e) => {
                    e.preventDefault();
                    const accordionId = header.dataset.accordionId;
                    toggleAccordion(accordionId);
                }, { passive: false });

                // Touch feedback for mobile
                header.addEventListener('touchstart', () => {
                    header.style.opacity = '0.7';
                }, { passive: true });

                header.addEventListener('touchend', () => {
                    header.style.opacity = '';
                }, { passive: true });

                header.addEventListener('touchcancel', () => {
                    header.style.opacity = '';
                }, { passive: true });

                header.dataset.listenerAttached = 'true';
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

            allProtocols = protocolData.flatMap(p => p.studies.map(s => ({...s, section: p.section[0]})));
            allOrders = ordersData.flatMap(o => o.studies.map(s => ({...s, section: o.section[0]})));
            
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
        const isOrdersMode = dataSourceToggle.checked;
        const dataToSearch = isOrdersMode ? allOrders : allProtocols;

        if (!query) {
            resultsContainer.innerHTML = '<p>Enter a search term to begin.</p>';
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
        // Immediate search on button click
        searchButton.addEventListener('click', () => handleSearch(true));
        
        // Mobile-friendly search input handling
        searchInput.addEventListener('input', handleSearch, { passive: true });
        searchInput.addEventListener('keyup', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                handleSearch(true);
                // Blur input on mobile to hide keyboard
                if (window.innerWidth <= 768) {
                    searchInput.blur();
                }
            }
        });
        
        // Immediate search on toggle change
        dataSourceToggle.addEventListener('change', () => handleSearch(true));
    }
    
    // --- INITIALIZATION ---
    // Initialize favorites system
    initFavorites();
    
    // Start the application by loading the data
    loadData();

});