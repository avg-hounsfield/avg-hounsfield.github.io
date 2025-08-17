// js/main.js

// Import your render function
// Make sure you have a render.js file that exports this function
import { renderGroupedProtocols } from './render.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM ELEMENTS ---
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const resultsContainer = document.getElementById('results');
    const dataSourceToggle = document.getElementById('dataSourceToggle');

    if (!searchInput || !searchButton || !resultsContainer || !dataSourceToggle) {
        console.error('One or more critical UI elements are missing from the HTML!');
        resultsContainer.innerHTML = '<p class="error">Page failed to initialize. Please check the console.</p>';
        return;
    }
    
    // --- STATE ---
    let allProtocols = [];
    let allOrders = [];

    // --- FUNCTIONS ---
    async function loadData() {
        resultsContainer.innerHTML = `<p>Loading data...</p>`;
        try {
            const [protocolRes, ordersRes] = await Promise.all([
                fetch('./data/protocols.json'),
                fetch('./data/imaging-orders.json')
            ]);
            if (!protocolRes.ok || !ordersRes.ok) throw new Error('Failed to fetch data files.');
            
            const protocolData = await protocolRes.json();
            const ordersData = await ordersRes.json();

            // Simple flattening of data
            allProtocols = protocolData.flatMap(p => p.studies.map(s => ({...s, section: p.section[0]})));
            allOrders = ordersData.flatMap(o => o.studies.map(s => ({...s, section: o.section[0]})));
            
            // Initial render
            handleSearch();
            
        } catch (error) {
            console.error('Data loading error:', error);
            resultsContainer.innerHTML = `<p class="error">Could not load protocol data.</p>`;
        }
    }

    function handleSearch() {
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
            // Group results for the render function
            const grouped = results.reduce((acc, item) => {
                const key = item.section || 'Other';
                if (!acc[key]) acc[key] = [];
                acc[key].push(item);
                return acc;
            }, {});
            resultsContainer.innerHTML = renderGroupedProtocols(grouped, isOrdersMode);
        }
    }

    // --- EVENT LISTENERS ---
    searchButton.addEventListener('click', handleSearch);
    searchInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') {
            handleSearch();
        }
    });
    dataSourceToggle.addEventListener('change', handleSearch);

    // --- INITIALIZATION ---
    loadData();
});