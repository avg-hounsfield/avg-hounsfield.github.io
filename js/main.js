// js/main.js - COMPLETE AND CORRECTED VERSION

// Import the render function at the very top
import { renderGroupedProtocols } from './render.js';

// The entire application logic is wrapped in this single event listener
document.addEventListener('DOMContentLoaded', () => {

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
     * @param {string} accordionId - The ID of the content panel to toggle.
     */
    function toggleAccordion(accordionId) {
        const content = document.getElementById(accordionId);
        if (!content) return;

        const header = document.querySelector(`[data-accordion-id="${accordionId}"]`);
        const toggleIcon = header ? header.querySelector('.accordion-toggle') : null;
        
        const isOpen = content.classList.contains('open');

        if (isOpen) {
            content.classList.remove('open');
            content.style.maxHeight = '0px';
            if (toggleIcon) toggleIcon.classList.remove('expanded');
        } else {
            content.classList.add('open');
            content.style.maxHeight = content.scrollHeight + 'px';
            if (toggleIcon) toggleIcon.classList.add('expanded');
        }
    }

    /**
     * Finds all accordion headers in the results and attaches click listeners.
     * This is called every time new results are rendered.
     */
    function attachAccordionListeners() {
        const accordionHeaders = document.querySelectorAll('[data-accordion-id]');
        accordionHeaders.forEach(header => {
            // Check if a listener has already been attached
            if (!header.dataset.listenerAttached) {
                header.addEventListener('click', () => {
                    const accordionId = header.dataset.accordionId;
                    toggleAccordion(accordionId);
                });
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
     */
    function handleSearch() {
        if (!searchInput || !dataSourceToggle || !resultsContainer) return;

        const query = searchInput.value.toLowerCase().trim();
        const isOrdersMode = dataSourceToggle.checked;
        const dataToSearch = isOrdersMode ? allOrders : allProtocols;

        if (!query) {
            resultsContainer.innerHTML = '<p>Enter a search term to begin.</p>';
            return;
        }

        const results = dataToSearch.filter(item => 
            item.study.toLowerCase().includes(query)
        );

        if (results.length === 0) {
            resultsContainer.innerHTML = `<p>No results found for "${query}".</p>`;
        } else {
            const grouped = results.reduce((acc, item) => {
                const key = item.section || 'Other';
                if (!acc[key]) acc[key] = [];
                acc[key].push(item);
                return acc;
            }, {});
            resultsContainer.innerHTML = renderGroupedProtocols(grouped, isOrdersMode);
            
            // After rendering, attach listeners to the new accordion elements
            attachAccordionListeners();
        }
    }

    // --- EVENT LISTENERS ---

    // Search event listeners
    if (searchButton && searchInput && dataSourceToggle) {
        searchButton.addEventListener('click', handleSearch);
        searchInput.addEventListener('keyup', (event) => {
            if (event.key === 'Enter') handleSearch();
        });
        dataSourceToggle.addEventListener('change', handleSearch);
    }
    
    // --- INITIALIZATION ---
    // Start the application by loading the data
    loadData();

});