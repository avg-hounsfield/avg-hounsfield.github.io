// js/main.js - OPTIMIZED VERSION WITH ENHANCED COMPATIBILITY

// Dynamic imports with fallbacks for better compatibility
let initFuzzy, fuzzySearch, renderGroupedProtocols;
let initFavorites, addFavoriteButtons, initFeedback;

// Import modules with graceful fallbacks
async function loadModules() {
  try {
    const searchModule = await import('./search.js');
    initFuzzy = searchModule.initFuzzy;
    fuzzySearch = searchModule.fuzzySearch;
  } catch (error) {
    console.warn('Failed to load search module, using fallback:', error);
    // Fallback search function
    window.fuzzySearch = fuzzySearch = function(query, data) {
      return data.filter(function(item) {
        return item.study && item.study.toLowerCase().indexOf(query.toLowerCase()) !== -1;
      });
    };
    initFuzzy = function() { console.log('Using fallback search'); };
  }

  try {
    const renderModule = await import('./render.js');
    renderGroupedProtocols = renderModule.renderGroupedProtocols;
  } catch (error) {
    console.warn('Failed to load render module, using fallback:', error);
    // Basic fallback renderer
    renderGroupedProtocols = function(grouped) {
      let html = '';
      for (const section in grouped) {
        html += '<h3>' + section + '</h3>';
        grouped[section].forEach(function(protocol) {
          html += '<div class="protocol-card"><h4>' + protocol.study + '</h4></div>';
        });
      }
      return html;
    };
  }

  try {
    const favoritesModule = await import('./favorites.js');
    initFavorites = favoritesModule.initFavorites;
    addFavoriteButtons = favoritesModule.addFavoriteButtons;
  } catch (error) {
    console.warn('Failed to load favorites module:', error);
    initFavorites = function() {};
    addFavoriteButtons = function() {};
  }


  try {
    const feedbackModule = await import('./feedback.js');
    initFeedback = feedbackModule.initFeedback;
  } catch (error) {
    console.warn('Failed to load feedback module:', error);
    initFeedback = function() {};
  }
}

let protocolData = [];
let ordersData = [];
let allStudies = []; // Add a new variable to hold the flattened list of all studies
let allOrders = []; // Add a new variable to hold the flattened list of all orders
const DEBOUNCE_DELAY = 250; // Reduced delay for better responsiveness

// Comprehensive pathology-to-imaging mapping database
const pathologyMapping = {
  // Neurological conditions
  stroke: ['CT ANGIO NECK', 'CT ANGIO BRAIN/HEAD', 'CT ANGIO BRAIN AND NECK', 'MRA BRAIN/HEAD W/O CONTRAST', 'MRA NECK/CAROTID W/O CONTRAST', 'CT BRAIN W/ CONTRAST', 'MRI BRAIN W/ + W/O CONTRAST'],
  'transient ischemic attack': ['CT ANGIO NECK', 'CT ANGIO BRAIN/HEAD', 'MRA BRAIN/HEAD W/O CONTRAST', 'MRA NECK/CAROTID W/O CONTRAST'],
  tia: ['CT ANGIO NECK', 'CT ANGIO BRAIN/HEAD', 'MRA BRAIN/HEAD W/O CONTRAST', 'MRA NECK/CAROTID W/O CONTRAST'],
  headache: ['CT BRAIN W/ CONTRAST', 'MRI BRAIN W/O CONTRAST', 'MRI BRAIN W/ + W/O CONTRAST', 'MRA BRAIN/HEAD W/O CONTRAST'],
  'brain tumor': ['MRI BRAIN W/ + W/O CONTRAST', 'CT BRAIN W/ CONTRAST'],
  seizure: ['MRI BRAIN W/ + W/O CONTRAST', 'CT BRAIN W/ CONTRAST'],
  'hearing loss': ['MRI IAC W/ + W/O CONTRAST', 'MRI IAC W/O CONTRAST', 'CT TEMPORAL BONE W/O CONTRAST'],
  tinnitus: ['MRI IAC W/ + W/O CONTRAST', 'MRI IAC W/O CONTRAST', 'CT TEMPORAL BONE W/O CONTRAST'],
  vertigo: ['MRI IAC W/ + W/O CONTRAST', 'MRI IAC W/O CONTRAST', 'CT TEMPORAL BONE W/O CONTRAST'],
  'facial numbness': ['MRI FACE NECK ORBIT W/ + W/O CONTRAST', 'CT MAXILLOFACIAL W/ CONTRAST'],
  'neck pain': ['CT SPINE CERVICAL W/O CONTRAST', 'MRI SPINE CERVICAL W/O CONTRAST', 'CT NECK SOFT TISSUE W/ CONTRAST'],
  'back pain': ['CT SPINE LUMBAR W/O CONTRAST', 'MRI SPINE LUMBAR W/O CONTRAST', 'CT SPINE THORACIC W/O CONTRAST'],
  'spine pain': ['CT SPINE CERVICAL W/O CONTRAST', 'CT SPINE LUMBAR W/O CONTRAST', 'CT SPINE THORACIC W/O CONTRAST'],
  'vision changes': ['MRI ORBITS W/ + W/O CONTRAST', 'CT MAXILLOFACIAL W/ CONTRAST'],
  'sinus infection': ['CT SINUS W/O CONTRAST'],
  sinusitis: ['CT SINUS W/O CONTRAST'],
  
  // Chest conditions
  'chest pain': ['CT CHEST W/ CONTRAST', 'CT CHEST W/O CONTRAST', 'CT ANGIO CORONARY ARTERY STR/MPH/FNT CNT'],
  'shortness of breath': ['CT CHEST W/ CONTRAST', 'CT ANGIO PULMONARY'],
  dyspnea: ['CT CHEST W/ CONTRAST', 'CT ANGIO PULMONARY'],
  'pulmonary embolism': ['CT ANGIO PULMONARY'],
  'lung cancer': ['CT CHEST W/ CONTRAST', 'CT LOW DOSE LUNG SCREENING'],
  'lung screening': ['CT LOW DOSE LUNG SCREENING'],
  'heart disease': ['CT ANGIO CORONARY ARTERY STR/MPH/FNT CNT', 'CT HEART CALCIUM SCORING', 'MRI CARDIAC W/ + W/O CONTRAST'],
  'coronary disease': ['CT ANGIO CORONARY ARTERY STR/MPH/FNT CNT', 'CT HEART CALCIUM SCORING'],
  
  // Abdominal conditions
  'abdominal pain': ['CT ABDOMEN AND PELVIS W/ CONTRAST', 'CT ABDOMEN AND PELVIS W/O CONTRAST'],
  'kidney stones': ['CT STONE PROTOCOL'],
  'kidney disease': ['CT KIDNEY W/ + W/O CONTRAST (MULTIPHASE)', 'MRI KIDNEY W/ + W/O CONTRAST'],
  'kidney mass': ['CT KIDNEY W/ + W/O CONTRAST (MULTIPHASE)', 'MRI KIDNEY W/ + W/O CONTRAST'],
  'liver disease': ['CT LIVER W/ + W/O (MULTIPHASE)', 'MRI LIVER STUDY'],
  'liver mass': ['CT LIVER W/ + W/O (MULTIPHASE)', 'MRI LIVER STUDY'],
  jaundice: ['MRI MRCP PROTOCOL'],
  'bile duct': ['MRI MRCP PROTOCOL'],
  'pancreatic disease': ['MRI PANCREAS W/ + W/O CONTRAST'],
  'prostate cancer': ['MRI PROSTATE W/ + W/O CONTRAST'],
  'rectal cancer': ['MRI PROSTATE W/ + W/O CONTRAST'],
  'bowel disease': ['MRI ENTEROGRAPHY W/ + W/O CONTRAST'],
  'crohns disease': ['MRI ENTEROGRAPHY W/ + W/O CONTRAST'],
  'inflammatory bowel': ['MRI ENTEROGRAPHY W/ + W/O CONTRAST'],
  'swallowing difficulty': ['RF SWALLOW FUNCTION W/ SPEECH', 'RF ESOPHAGUS'],
  dysphagia: ['RF SWALLOW FUNCTION W/ SPEECH', 'RF ESOPHAGUS'],
  
  // Pregnancy and gynecological
  pregnancy: ['US PREGNANCY 1ST TRIMESTER TRANSAB', 'US PELVIS COMP W/ TRANSVAG IF INDICATED'],
  'pelvic pain': ['US PELVIS COMP W/ TRANSVAG IF INDICATED', 'CT PELVIS W/ CONTRAST'],
  'ovarian cyst': ['US PELVIS COMP W/ TRANSVAG IF INDICATED'],
  fibroids: ['US PELVIS COMP W/ TRANSVAG IF INDICATED'],
  
  // Vascular conditions
  'aortic aneurysm': ['US ABDOMINAL AORTA', 'CT ANGIO ABDOMEN AND PELVIS'],
  'blood clot': ['US LOWER EXT VENOUS DUPLEX', 'CT ANGIO PULMONARY'],
  'deep vein thrombosis': ['US LOWER EXT VENOUS DUPLEX'],
  dvt: ['US LOWER EXT VENOUS DUPLEX'],
  
  // General symptoms
  fever: ['CT CHEST W/ CONTRAST', 'CT ABDOMEN AND PELVIS W/ CONTRAST'],
  'weight loss': ['CT CHEST W/ CONTRAST', 'CT ABDOMEN AND PELVIS W/ CONTRAST'],
  fatigue: ['CT CHEST W/ CONTRAST', 'CT ABDOMEN AND PELVIS W/ CONTRAST'],
  
  // Oncology
  cancer: ['CT CHEST/ABDOMEN/PELVIS W/ CONTRAST', 'NM PET/CT WHOLE BODY'],
  'cancer screening': ['CT LOW DOSE LUNG SCREENING', 'CT CHEST/ABDOMEN/PELVIS W/ CONTRAST'],
  metastasis: ['NM PET/CT WHOLE BODY', 'CT CHEST/ABDOMEN/PELVIS W/ CONTRAST'],
  'tumor staging': ['NM PET/CT SKULL BASE TO MIDTHIGH', 'CT CHEST/ABDOMEN/PELVIS W/ CONTRAST'],
  
  // Bone and joint
  'bone pain': ['NM BONE IMAGING WHOLE BODY', 'NM BONE IMAGING LIMITED'],
  fracture: ['CT SPINE CERVICAL W/O CONTRAST', 'CT SPINE LUMBAR W/O CONTRAST'],
  osteoporosis: ['BD BONE DENSITY DEXA AXIAL SKELETON'],
  'bone density': ['BD BONE DENSITY DEXA AXIAL SKELETON', 'NM BONE DENSITY DUAL PHOTON'],
  
  // Thyroid and endocrine
  'thyroid nodule': ['US THYROID'],
  'thyroid mass': ['US THYROID'],
  hyperthyroidism: ['US THYROID'],
  hypothyroidism: ['US THYROID']
};

// Symptom-based keywords that should trigger smart search
const symptomKeywords = [
  'pain', 'ache', 'hurt', 'sore', 'tender',
  'mass', 'lump', 'bump', 'growth', 'tumor', 'nodule',
  'bleeding', 'blood', 'hemorrhage',
  'swelling', 'swollen', 'edema', 'inflammation',
  'numbness', 'tingling', 'weakness', 'paralysis',
  'difficulty', 'trouble', 'problem', 'issue',
  'changes', 'loss', 'decrease', 'increase',
  'infection', 'fever', 'sick', 'illness',
  'screening', 'checkup', 'monitor', 'follow-up'
];

// Smart pathology search function
function performPathologySearch(query, orders) {
  const queryLower = query.toLowerCase().trim();
  const matchedOrders = new Set();
  
  // Direct pathology mapping search
  for (const [condition, orderNames] of Object.entries(pathologyMapping)) {
    if (queryLower.includes(condition.toLowerCase())) {
      orderNames.forEach(orderName => {
        const matchingOrder = orders.find(order => 
          order.study.toUpperCase() === orderName.toUpperCase()
        );
        if (matchingOrder) {
          matchedOrders.add(matchingOrder);
        }
      });
    }
  }
  
  // Anatomical region search
  const anatomicalMappings = {
    brain: ['CT BRAIN', 'MRI BRAIN', 'CT ANGIO BRAIN', 'MRA BRAIN'],
    head: ['CT BRAIN', 'MRI BRAIN', 'CT ANGIO BRAIN', 'MRA BRAIN', 'CT MAXILLOFACIAL', 'MRI FACE'],
    neck: ['CT NECK', 'MRI NECK', 'CT ANGIO NECK', 'MRA NECK', 'CT SPINE CERVICAL', 'MRI SPINE CERVICAL'],
    chest: ['CT CHEST', 'CT ANGIO CHEST', 'CT ANGIO CORONARY', 'CT ANGIO PULMONARY', 'MRI CARDIAC'],
    abdomen: ['CT ABDOMEN', 'MRI ABDOMEN', 'CT ANGIO ABDOMEN', 'US ABDOMEN'],
    pelvis: ['CT PELVIS', 'US PELVIS', 'MRI PROSTATE'],
    spine: ['CT SPINE', 'MRI SPINE'],
    heart: ['CT HEART', 'CT ANGIO CORONARY', 'MRI CARDIAC'],
    kidney: ['CT KIDNEY', 'MRI KIDNEY'],
    liver: ['CT LIVER', 'MRI LIVER'],
    thyroid: ['US THYROID']
  };
  
  for (const [region, patterns] of Object.entries(anatomicalMappings)) {
    if (queryLower.includes(region)) {
      patterns.forEach(pattern => {
        orders.forEach(order => {
          if (order.study.toUpperCase().includes(pattern.toUpperCase())) {
            matchedOrders.add(order);
          }
        });
      });
    }
  }
  
  // Symptom-based contextual search
  const hasSymptomKeyword = symptomKeywords.some(keyword => 
    queryLower.includes(keyword.toLowerCase())
  );
  
  if (hasSymptomKeyword) {
    // Enhanced contextual search for symptoms + anatomy
    const words = queryLower.split(/\s+/);
    
    words.forEach(word => {
      // Check if word matches any anatomical region
      for (const [region, patterns] of Object.entries(anatomicalMappings)) {
        if (word.includes(region) || region.includes(word)) {
          patterns.forEach(pattern => {
            orders.forEach(order => {
              if (order.study.toUpperCase().includes(pattern.toUpperCase())) {
                matchedOrders.add(order);
              }
            });
          });
        }
      }
    });
    
    // Default comprehensive search for unspecific symptoms
    if (matchedOrders.size === 0) {
      const commonSymptomOrders = [
        'CT CHEST W/ CONTRAST',
        'CT ABDOMEN AND PELVIS W/ CONTRAST',
        'CT CHEST/ABDOMEN/PELVIS W/ CONTRAST'
      ];
      
      commonSymptomOrders.forEach(orderName => {
        const matchingOrder = orders.find(order => 
          order.study.toUpperCase() === orderName.toUpperCase()
        );
        if (matchingOrder) {
          matchedOrders.add(matchingOrder);
        }
      });
    }
  }
  
  return Array.from(matchedOrders);
}

// Optimize debounce function
const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
};

// Map to store active timeouts for accordion animations to prevent memory leaks
const accordionTimeouts = new Map();

// Function to toggle accordion display with smooth height-based animations
window.toggleAccordion = function(accordionId) {
  const content = document.getElementById(accordionId);
  const toggle = document.getElementById('toggle-' + accordionId);
  
  if (!content || !toggle) return; // Safety check
  
  // Clear any existing timeout for this accordion to prevent memory leaks
  if (accordionTimeouts.has(accordionId)) {
    clearTimeout(accordionTimeouts.get(accordionId));
    accordionTimeouts.delete(accordionId);
  }
  
  // Determine current state
  const isCurrentlyHidden = content.classList.contains('accordion-closed') || 
                           content.style.display === 'none' || 
                           !content.classList.contains('accordion-open');
  
  if (isCurrentlyHidden) {
    // Opening: measure natural height first
    content.style.display = 'block';
    content.style.height = 'auto';
    content.style.overflow = 'visible';
    const naturalHeight = content.scrollHeight;
    
    // Set up for animation
    content.style.height = '0px';
    content.style.overflow = 'hidden';
    content.style.transition = 'height 0.15s ease-out';
    content.classList.remove('accordion-closed');
    content.classList.add('accordion-open');
    
    // Trigger animation
    requestAnimationFrame(() => {
      content.style.height = naturalHeight + 'px';
    });
    
    // Clean up after animation
    const timeoutId = setTimeout(() => {
      content.style.height = 'auto';
      content.style.overflow = 'visible';
      content.style.transition = '';
      accordionTimeouts.delete(accordionId);
    }, 150);
    accordionTimeouts.set(accordionId, timeoutId);
    
  } else {
    // Closing: get current height first
    const currentHeight = content.scrollHeight;
    content.style.height = currentHeight + 'px';
    content.style.overflow = 'hidden';
    content.style.transition = 'height 0.15s ease-out';
    content.classList.remove('accordion-open');
    content.classList.add('accordion-closed');
    
    // Trigger animation
    requestAnimationFrame(() => {
      content.style.height = '0px';
    });
    
    // Hide after animation
    const timeoutId = setTimeout(() => {
      content.style.display = 'none';
      content.style.transition = '';
      accordionTimeouts.delete(accordionId);
    }, 150);
    accordionTimeouts.set(accordionId, timeoutId);
  }
  
  // Update toggle button
  toggle.textContent = isCurrentlyHidden ? '−' : '+';
  toggle.classList.toggle('expanded', isCurrentlyHidden);
};

// Cache DOM elements to avoid repeated queries
let cachedSearchInput;
let cachedResultsContainer;

// Optimized search and render function
function runSearchAndRender() {
  // Use cached elements or query them once
  if (!cachedSearchInput) cachedSearchInput = document.getElementById('searchInput');
  if (!cachedResultsContainer) cachedResultsContainer = document.getElementById('results');
  
  const searchInput = cachedSearchInput;
  const resultsContainer = cachedResultsContainer;
  
  if (!searchInput || !resultsContainer) return;
  
  const query = searchInput.value.trim();

  // Early return for empty queries
  if (!query) {
    resultsContainer.innerHTML = '';
    searchInput.classList.remove('search-loading');
    return;
  }

  // Show loading state
  searchInput.classList.add('search-loading');
  resultsContainer.innerHTML = `
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p class="loading-text">Searching protocols...</p>
      <p class="loading-subtext">Finding matches for "${query}"</p>
    </div>
  `;

  // Get current toggle state and determine which dataset to use
  const isOrdersOnly = window.getOrdersOnlyState ? window.getOrdersOnlyState() : false;
  const currentDataset = isOrdersOnly ? allOrders : allStudies;
  const datasetName = isOrdersOnly ? 'orders' : 'protocols';

  console.log('Search debug:', { 
    query, 
    isOrdersOnly, 
    datasetName, 
    currentDatasetLength: currentDataset?.length,
    allStudiesLength: allStudies?.length,
    allOrdersLength: allOrders?.length
  });

  // Data validation
  if (!currentDataset?.length) {
    console.error(`No ${datasetName} data available`);
    resultsContainer.innerHTML = 
      `<p class="error">Loading ${datasetName}...</p>`;
    searchInput.classList.remove('search-loading');
    return;
  }

  try {
    let results;
    
    // Use fuzzy search on the current dataset
    const allResults = fuzzySearch(query, currentDataset) || [];
    
    if (isOrdersOnly) {
      // Filter to only orders (items with modality field)
      results = allResults.filter(item => item.modality);
      
      // Try smart pathology search first for orders
      const pathologyResults = performPathologySearch(query, currentDataset);
      if (pathologyResults.length > 0) {
        results = pathologyResults;
      }
    } else {
      // Filter to only protocols (items without modality field)
      results = allResults.filter(item => !item.modality);
    }
    
    if (results.length === 0) {
      resultsContainer.innerHTML = `<p>No matching ${datasetName} found.</p>`;
      searchInput.classList.remove('search-loading');
      return;
    }

    // Apply different logic for orders vs protocols
    let filteredResults = results;
    
    if (isOrdersOnly) {
      // For orders, group by section and add smart search info
      const grouped = filteredResults.reduce((acc, order) => {
        let sectionKey = order.section || 'Other';
        if (!acc[sectionKey]) {
          acc[sectionKey] = [];
        }
        acc[sectionKey].push(order);
        return acc;
      }, {});

      resultsContainer.innerHTML = renderGroupedProtocols(grouped, isOrdersOnly);
    } else {
      // Original protocol consolidation logic
      applyProtocolConsolidation();
    }

    function applyProtocolConsolidation() {
      // Smart protocol consolidation filtering based on search query
      const consolidationGroups = {
        brain: ['BRAIN', 'BRAIN TUMOR/INF', 'BRAIN MS', 'CRANIAL NERVES/PAROTID', 'TRIGEMINAL NEURALGIA', 'PITUITARY', 'PEDIATRIC BRAIN MRI'],
        spine: ['C-SPINE', 'T-SPINE', 'L-SPINE', 'SACRUM', 'SCREENING SPINE', 'SCOLIOSIS SPINE', 'C-SPINE MS', 'T-SPINE MS'],
        cerebrovascular: ['TIA', 'TIA MRA DISSECTION', 'MRA ANEURYSM'],
        arthrography: ['SHOULDER ARTHROGRAM', 'WRIST ARTHROGRAM', 'HIP ARTHROGRAM'],
        orbital: ['ORBITS', 'ORBIT NEMMERS'],
        upperExtremity: ['SHOULDER', 'ELBOW', 'WRIST', 'HAND/FINGER'],
        lowerExtremity: ['HIP', 'KNEE', 'ANKLE', 'FOOT/TOE']
      };
    
      const queryLower = query.toLowerCase();
    
      // Filter protocols based on search specificity
      let protocolFilteredResults = results;
    
    // Define specific searches for each consolidation group
    const specificSearches = {
      // Brain specific searches
      'tumor': 'BRAIN TUMOR/INF',
      'tumour': 'BRAIN TUMOR/INF',
      'mass': 'BRAIN TUMOR/INF',
      'lesion': 'BRAIN TUMOR/INF',
      'infection': 'BRAIN TUMOR/INF',
      'inf': 'BRAIN TUMOR/INF',
      'abscess': 'BRAIN TUMOR/INF',
      'ms': ['BRAIN MS', 'C-SPINE MS', 'T-SPINE MS'],
      'multiple sclerosis': ['BRAIN MS', 'C-SPINE MS', 'T-SPINE MS'],
      'demyelinating': ['BRAIN MS', 'C-SPINE MS', 'T-SPINE MS'],
      'cranial': 'CRANIAL NERVES/PAROTID',
      'nerve': 'CRANIAL NERVES/PAROTID',
      'nerves': 'CRANIAL NERVES/PAROTID',
      'facial': 'CRANIAL NERVES/PAROTID',
      'parotid': 'CRANIAL NERVES/PAROTID',
      'trigeminal': 'TRIGEMINAL NEURALGIA',
      'neuralgia': 'TRIGEMINAL NEURALGIA',
      'facial pain': 'TRIGEMINAL NEURALGIA',
      'pituitary': 'PITUITARY',
      'sella': 'PITUITARY',
      'sellar': 'PITUITARY',
      'sella turcica': 'PITUITARY',
      'adenoma': 'PITUITARY',
      'hypophyseal': 'PITUITARY',
      'hypophysis': 'PITUITARY',
      
      // Spine specific searches
      'cervical': 'C-SPINE',
      'c-spine': 'C-SPINE',
      'thoracic': 'T-SPINE',
      't-spine': 'T-SPINE',
      'lumbar': 'L-SPINE',
      'l-spine': 'L-SPINE',
      'sacrum': 'SACRUM',
      'scoliosis': 'SCOLIOSIS SPINE',
      'screening spine': 'SCREENING SPINE',
      
      // Cerebrovascular specific searches
      'tia': ['TIA', 'TIA MRA DISSECTION'],
      'stroke': ['TIA', 'TIA MRA DISSECTION'],
      'dissection': 'TIA MRA DISSECTION',
      'aneurysm': 'MRA ANEURYSM',
      
      // Arthrography specific searches
      'arthrogram': ['SHOULDER ARTHROGRAM', 'WRIST ARTHROGRAM', 'HIP ARTHROGRAM'],
      'shoulder arthrogram': 'SHOULDER ARTHROGRAM',
      'wrist arthrogram': 'WRIST ARTHROGRAM',
      'hip arthrogram': 'HIP ARTHROGRAM',
      
      // Orbital specific searches
      'orbit': ['ORBITS', 'ORBIT NEMMERS'],
      'orbital': ['ORBITS', 'ORBIT NEMMERS'],
      'orbits': ['ORBITS', 'ORBIT NEMMERS'],
      'eye': ['ORBITS', 'ORBIT NEMMERS'],
      'eyes': ['ORBITS', 'ORBIT NEMMERS'],
      'optic': ['ORBITS', 'ORBIT NEMMERS'],
      'vision': ['ORBITS', 'ORBIT NEMMERS'],
      'nemmers': 'ORBIT NEMMERS',
      
      // Upper extremity specific searches
      'shoulder': ['SHOULDER', 'SHOULDER ARTHROGRAM'],
      'elbow': 'ELBOW',
      'wrist': ['WRIST', 'WRIST ARTHROGRAM'],
      'hand': 'HAND/FINGER',
      'finger': 'HAND/FINGER',
      
      // Lower extremity specific searches
      'hip': ['HIP', 'HIP ARTHROGRAM'],
      'knee': 'KNEE',
      'ankle': 'ANKLE',
      'foot': 'FOOT/TOE',
      'toe': 'FOOT/TOE'
    };
    
    // Check for specific searches
    let isSpecificSearch = false;
    let targetProtocols = [];
    
    for (const [searchTerm, protocolNames] of Object.entries(specificSearches)) {
      if (queryLower.includes(searchTerm)) {
        isSpecificSearch = true;
        targetProtocols = Array.isArray(protocolNames) ? protocolNames : [protocolNames];
        break;
      }
    }
    
      // If it's a specific search, filter to only show those protocols
      if (isSpecificSearch) {
        protocolFilteredResults = results.filter(protocol => targetProtocols.includes(protocol.study));
      }
      // If searching for general terms, show all protocols in that group for consolidation
      else if (queryLower === 'brain') {
        protocolFilteredResults = results.filter(protocol => 
          consolidationGroups.brain.includes(protocol.study)
        );
      }
      else if (queryLower === 'spine') {
        protocolFilteredResults = results.filter(protocol => 
          consolidationGroups.spine.includes(protocol.study)
        );
      }
      else if (queryLower.includes('cerebrovascular') || queryLower.includes('vessel')) {
        protocolFilteredResults = results.filter(protocol => 
          consolidationGroups.cerebrovascular.includes(protocol.study)
        );
      }
      else if (queryLower.includes('arthrography')) {
        protocolFilteredResults = results.filter(protocol => 
          consolidationGroups.arthrography.includes(protocol.study)
        );
      }
      else if (queryLower.includes('upper extremity')) {
        protocolFilteredResults = results.filter(protocol => 
          consolidationGroups.upperExtremity.includes(protocol.study)
        );
      }
      else if (queryLower.includes('lower extremity')) {
        protocolFilteredResults = results.filter(protocol => 
          consolidationGroups.lowerExtremity.includes(protocol.study)
        );
      }
      else if (queryLower === 'orbit' || queryLower === 'orbital' || queryLower.includes('orbit')) {
        protocolFilteredResults = results.filter(protocol => 
          consolidationGroups.orbital.includes(protocol.study)
        );
      }

      // Optimize grouping with special handling for all consolidation groups
      const grouped = protocolFilteredResults.reduce((acc, protocol) => {
      let sectionKey = protocol.section || 'Other';
      
      // Determine which consolidation group this protocol belongs to
      let consolidationGroup = null;
      for (const [groupName, protocols] of Object.entries(consolidationGroups)) {
        if (protocols.includes(protocol.study)) {
          consolidationGroup = groupName;
          break;
        }
      }
      
      // Handle consolidation grouping
      if (consolidationGroup) {
        // If showing specific protocol or main protocol, keep original section
        if (isSpecificSearch || 
            queryLower === 'brain' || queryLower === 'spine' || 
            queryLower.includes('cerebrovascular') || queryLower.includes('vessel') ||
            queryLower.includes('arthrography') || 
            queryLower.includes('upper extremity') || queryLower.includes('lower extremity')) {
          sectionKey = protocol.section || 'Other';
        } else {
          // Otherwise consolidate under appropriate category
          switch (consolidationGroup) {
            case 'brain':
              sectionKey = 'Brain';
              break;
            case 'spine':
              sectionKey = 'Spine';
              break;
            case 'cerebrovascular':
              sectionKey = 'Cerebrovascular';
              break;
            case 'arthrography':
              sectionKey = 'Joint Arthrography';
              break;
            case 'orbital':
              sectionKey = 'Orbital Imaging';
              break;
            case 'upperExtremity':
              sectionKey = 'Upper Extremity';
              break;
            case 'lowerExtremity':
              sectionKey = 'Lower Extremity';
              break;
          }
        }
      }
      
      if (!acc[sectionKey]) {
        acc[sectionKey] = [];
      }
      acc[sectionKey].push(protocol);
      return acc;
      }, {});

      resultsContainer.innerHTML = renderGroupedProtocols(grouped);
      
    }
    
    // Apply animations for both orders and protocols
    
    // Professional staggered animations with optimized timing
    const cards = resultsContainer.querySelectorAll('.protocol-card');
    cards.forEach((card, index) => {
      // Smooth staggered animation with professional timing curve
      card.style.animationDelay = `${index * 120}ms`;
      card.classList.add('fade-in-up');
      
      // Enhanced performance optimization
      card.style.willChange = 'transform, opacity, filter';
      
      // Clean up will-change after animation completes with extended timing
      setTimeout(() => {
        card.style.willChange = 'auto';
      }, 1200 + (index * 120));
    });
    
    // Remove loading state and add favorite buttons after rendering
    searchInput.classList.remove('search-loading');
    setTimeout(() => {
      try {
        if (typeof addFavoriteButtons === 'function') {
          addFavoriteButtons();
        }
      } catch (error) {
        console.warn('Failed to add favorite buttons:', error);
      }
    }, 100);
    
  } catch (error) {
    console.error('Search error:', error);
    resultsContainer.innerHTML = '<p class="error">Search error. Please try again.</p>';
    searchInput.classList.remove('search-loading');
  }
}

// Create a debounced version of the search function
const debouncedSearch = debounce(runSearchAndRender, DEBOUNCE_DELAY);

// Feature detection and graceful degradation
function checkBrowserCompatibility() {
  const warnings = [];
  
  // Check for ES6 module support
  const supportsModules = 'noModule' in HTMLScriptElement.prototype;
  
  // Check for essential APIs
  if (!window.fetch) {
    warnings.push('Your browser doesn\'t support modern networking. Some features may not work.');
  }
  
  if (!window.localStorage && !window.sessionStorage) {
    warnings.push('Your browser doesn\'t support data storage. Favorites won\'t be saved.');
  }
  
  if (!window.requestAnimationFrame) {
    warnings.push('Your browser doesn\'t support smooth animations.');
  }
  
  // Show warnings if any
  if (warnings.length > 0) {
    setTimeout(function() {
      const warningDiv = document.createElement('div');
      warningDiv.style.cssText = `
        position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
        background: #ff9800; color: #ffffff; padding: 12px 16px;
        border-radius: 8px; font-size: 0.9em; z-index: 3000;
        max-width: 90%; text-align: center;
      `;
      warningDiv.innerHTML = `
        <strong>Browser Compatibility Notice:</strong><br>
        ${warnings.join('<br>')}
        <br><small>Consider updating your browser for the best experience.</small>
        <button onclick="this.parentElement.remove()" style="margin-left: 8px; background: rgba(255,255,255,0.2); border: none; color: inherit; padding: 2px 6px; border-radius: 3px; cursor: pointer;">×</button>
      `;
      document.body.appendChild(warningDiv);
      
      // Auto-remove after 10 seconds
      setTimeout(function() {
        if (warningDiv.parentNode) {
          warningDiv.parentNode.removeChild(warningDiv);
        }
      }, 10000);
    }, 1000);
  }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Check browser compatibility first
  checkBrowserCompatibility();
  
  // Load modules with fallbacks - handle browsers without async/await support
  if (typeof Promise === 'undefined' || !window.Promise) {
    // Fallback for browsers without Promise support
    console.warn('Browser does not support modern modules, using basic functionality');
    initBasicFunctionality();
    return;
  }
  
  loadModules().then(function() {
    console.log('Modules loaded successfully');
  }).catch(function(error) {
    console.error('Failed to load modules:', error);
    initBasicFunctionality();
  });

  function initBasicFunctionality() {
    // Set up basic fallback functions if modules fail to load
    if (typeof fuzzySearch === 'undefined') {
      window.fuzzySearch = fuzzySearch = function(query, data) {
        return data.filter(function(item) {
          return item.study && item.study.toLowerCase().indexOf(query.toLowerCase()) !== -1;
        });
      };
    }
    if (typeof renderGroupedProtocols === 'undefined') {
      renderGroupedProtocols = function(grouped) {
        let html = '';
        for (const section in grouped) {
          html += '<h3>' + section + '</h3>';
          grouped[section].forEach(function(protocol) {
            html += '<div class="protocol-card"><h4>' + protocol.study + '</h4></div>';
          });
        }
        return html;
      };
    }
    // Initialize without module dependencies
    initFavorites = initFavorites || function() {};
    addFavoriteButtons = addFavoriteButtons || function() {};
    initFeedback = initFeedback || function() {};
  }
  
  var searchInput = document.getElementById('searchInput');
  var searchButton = document.getElementById('searchButton');
  var resultsContainer = document.getElementById('results');
  var dataSourceToggle = document.getElementById('dataSourceToggle');
  var protocolsLabel = document.getElementById('protocolsLabel');
  var ordersLabel = document.getElementById('ordersLabel');

  // Validate required DOM elements exist
  if (!searchInput || !resultsContainer) {
    console.error('Required DOM elements not found. Application cannot initialize.');
    return;
  }

  // Data source state (protocols vs orders)
  var currentDataSource = 'protocols'; // default

  // Toggle functionality for Protocols/Orders
  function toggleDataSource() {
    if (!dataSourceToggle || !protocolsLabel || !ordersLabel) return; // Safety check
    
    if (dataSourceToggle.checked) {
      currentDataSource = 'orders';
      protocolsLabel.classList.remove('active');
      ordersLabel.classList.add('active');
      searchInput.placeholder = 'Search orders...';
    } else {
      currentDataSource = 'protocols';
      protocolsLabel.classList.add('active');
      ordersLabel.classList.remove('active');
      searchInput.placeholder = 'Search protocols...';
    }
    
    // Re-run search if there's a query
    if (searchInput && searchInput.value.trim()) {
      runSearchAndRender();
    }
  }

  // Add change event to toggle
  if (dataSourceToggle) {
    dataSourceToggle.addEventListener('change', toggleDataSource);
  }

  // Make data source state accessible globally for search function
  window.getOrdersOnlyState = function() {
    return currentDataSource === 'orders';
  };

  // Feature detection
  var supportsES6 = (function() {
    try {
      return new Function("(a = 0) => a");
    } catch (e) {
      return false;
    }
  })();

  // Cross-browser event listener helper
  function addEvent(element, event, handler) {
    if (element.addEventListener) {
      element.addEventListener(event, handler, false);
    } else if (element.attachEvent) {
      element.attachEvent('on' + event, handler);
    } else {
      element['on' + event] = handler;
    }
  }

  // Load protocols data with fetch polyfill fallback
  function loadProtocols() {
    if (window.fetch) {
      return fetch('./data/protocols.json')
        .then(function(res) { 
          if (!res.ok) {
            throw new Error('HTTP error! status: ' + res.status);
          }
          return res.json(); 
        })
        .then(function(data) {
          // Validate data structure
          if (!Array.isArray(data)) {
            throw new Error('Invalid data format: expected array');
          }
          return data;
        });
    } else {
      // Fallback for older browsers
      return new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', './data/protocols.json');
        xhr.timeout = 10000; // 10 second timeout
        
        xhr.onload = function() {
          if (xhr.status === 200) {
            try {
              var data = JSON.parse(xhr.responseText);
              // Validate data structure
              if (!Array.isArray(data)) {
                reject(new Error('Invalid data format: expected array'));
                return;
              }
              resolve(data);
            } catch (e) {
              reject(new Error('JSON parse error: ' + e.message));
            }
          } else {
            reject(new Error('HTTP error! status: ' + xhr.status));
          }
        };
        
        xhr.onerror = function() {
          reject(new Error('Network error'));
        };
        
        xhr.ontimeout = function() {
          reject(new Error('Request timeout'));
        };
        
        xhr.send();
      });
    }
  }

  // Load orders data with fetch polyfill fallback
  function loadOrders() {
    if (window.fetch) {
      return fetch('./data/imaging-orders.json')
        .then(function(res) { return res.json(); });
    } else {
      // Fallback for older browsers
      return new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', './data/imaging-orders.json');
        xhr.onload = function() {
          if (xhr.status === 200) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error('Failed to load'));
          }
        };
        xhr.onerror = function() {
          reject(new Error('Network error'));
        };
        xhr.send();
      });
    }
  }

  // Load both datasets concurrently
  Promise.all([loadProtocols(), loadOrders()])
    .then(function(results) {
      protocolData = results[0];
      ordersData = results[1];
      
      // Flatten all studies, duplicating them for each section they belong to
      allStudies = [];
      protocolData.forEach(function(sectionObj) {
        if (Array.isArray(sectionObj.studies)) {
          var sections = Array.isArray(sectionObj.section) ? sectionObj.section : ['Other'];
          sectionObj.studies.forEach(function(study) {
            sections.forEach(function(sectionName) {
              // Create a new object for each study-section pair
              // Use fallback for Object.assign if not available
              var newStudy = {};
              for (var key in study) {
                if (study.hasOwnProperty(key)) {
                  newStudy[key] = study[key];
                }
              }
              newStudy.section = sectionName;
              allStudies.push(newStudy);
            });
          });
        }
      });

      // Flatten all orders, duplicating them for each section they belong to
      allOrders = [];
      ordersData.forEach(function(sectionObj) {
        if (Array.isArray(sectionObj.studies)) {
          var sections = Array.isArray(sectionObj.section) ? sectionObj.section : ['Other'];
          sectionObj.studies.forEach(function(order) {
            sections.forEach(function(sectionName) {
              // Create a new object for each order-section pair
              var newOrder = {};
              for (var key in order) {
                if (order.hasOwnProperty(key)) {
                  newOrder[key] = order[key];
                }
              }
              newOrder.section = sectionName;
              allOrders.push(newOrder);
            });
          });
        }
      });

      // Initialize fuzzy search with both flattened lists
      try {
        if (typeof initFuzzy === 'function') {
          // Initialize with all studies - we'll switch datasets dynamically in search
          initFuzzy(allStudies.concat(allOrders));
        }
      } catch (error) {
        console.error('Failed to initialize search:', error);
        // Fallback: basic search without fuzzy matching
        window.fuzzySearch = fuzzySearch = function(query, data) {
          return data.filter(function(item) {
            return item.study && item.study.toLowerCase().indexOf(query.toLowerCase()) !== -1;
          });
        };
      }
      
      // Initialize systems with enhanced error handling
      try {
        if (typeof initFavorites === 'function') {
          // Delay favorites initialization to ensure DOM is ready
          setTimeout(() => {
            initFavorites();
          }, 100);
        }
      } catch (error) {
        console.error('Failed to initialize favorites:', error);
      }
      
      
      try {
        if (typeof initFeedback === 'function') {
          initFeedback();
        }
      } catch (error) {
        console.error('Failed to initialize feedback:', error);
      }
      
      // Don't show any results initially
      resultsContainer.innerHTML = '';
      
      // Always setup fallback favorites as backup
      console.log('Setting up fallback favorites as backup...');
      setupFallbackFavorites();
      
      if (searchInput.value.trim()) {
        runSearchAndRender();
      }
    })
    .catch(function(error) {
      console.error('Failed to load data:', error);
      
      // Show user-friendly error message
      var errorMessage = 'Failed to load protocols and orders. ';
      if (!navigator.onLine) {
        errorMessage += 'Please check your internet connection.';
      } else if (error.name === 'TypeError') {
        errorMessage += 'Please refresh the page and try again.';
      } else {
        errorMessage += 'Please try again later.';
      }
      
      resultsContainer.innerHTML = '<p class="error">' + errorMessage + '</p>';
    });

  // Enhanced keyboard shortcuts
  function setupKeyboardShortcuts() {
    // Global keyboard shortcuts
    document.addEventListener('keydown', function(e) {
      // Ctrl+K or Cmd+K to focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
        return;
      }
      
      // Escape to clear search (when search is focused)
      if (e.key === 'Escape' && document.activeElement === searchInput) {
        e.preventDefault();
        searchInput.value = '';
        resultsContainer.innerHTML = '';
        searchInput.classList.remove('search-loading');
        return;
      }
      
      // Ctrl+/ to show keyboard shortcuts help
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        showKeyboardShortcuts();
        return;
      }
    });
    
    // Search input specific shortcuts
    searchInput.addEventListener('keydown', function(e) {
      // Enter to search immediately (bypass debounce)
      if (e.key === 'Enter') {
        e.preventDefault();
        runSearchAndRender();
        return;
      }
      
      // Escape to clear and blur
      if (e.key === 'Escape') {
        e.preventDefault();
        searchInput.value = '';
        resultsContainer.innerHTML = '';
        searchInput.classList.remove('search-loading');
        searchInput.blur();
        return;
      }
    });
  }
  
  // Show keyboard shortcuts help
  function showKeyboardShortcuts() {
    const shortcuts = `
      <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                  background: var(--primary-surface-bg); border: 1px solid var(--border-color); 
                  border-radius: 12px; padding: 24px; z-index: 2000; min-width: 300px;
                  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);">
        <h3 style="margin: 0 0 16px 0; color: var(--text-primary);">Keyboard Shortcuts</h3>
        <div style="font-family: 'Jost', sans-serif; line-height: 1.6;">
          <div style="margin-bottom: 8px;"><kbd style="background: var(--secondary-surface-bg); padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">Ctrl + K</kbd> Focus search</div>
          <div style="margin-bottom: 8px;"><kbd style="background: var(--secondary-surface-bg); padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">Enter</kbd> Search immediately</div>
          <div style="margin-bottom: 8px;"><kbd style="background: var(--secondary-surface-bg); padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">Esc</kbd> Clear search</div>
          <div style="margin-bottom: 16px;"><kbd style="background: var(--secondary-surface-bg); padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">Ctrl + /</kbd> Show this help</div>
          <button onclick="this.parentElement.parentElement.remove()" 
                  style="background: var(--interactive-accent); color: var(--interactive-accent-text); 
                         border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">Close</button>
        </div>
      </div>
    `;
    
    // Remove existing shortcuts overlay
    const existing = document.querySelector('.shortcuts-overlay');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.className = 'shortcuts-overlay';
    overlay.innerHTML = shortcuts;
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
      background: rgba(0, 0, 0, 0.5); z-index: 1999;
    `;
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) overlay.remove();
    });
    
    document.body.appendChild(overlay);
  }

  // Set up event listeners for search with cross-browser support
  addEvent(searchInput, 'input', debouncedSearch);
  addEvent(searchButton, 'click', runSearchAndRender);
  
  // Setup keyboard shortcuts
  setupKeyboardShortcuts();

  // Enhanced fallback favorites functionality with debugging
  function setupFallbackFavorites() {
    console.log('Setting up fallback favorites...');
    
    const trigger = document.getElementById('sidebar-trigger');
    const close = document.getElementById('sidebar-close');
    const content = document.getElementById('sidebar-content');
    let sidebarOpen = false;

    console.log('Favorites elements found:', { 
      trigger: !!trigger, 
      close: !!close, 
      content: !!content 
    });

    if (trigger) {
      trigger.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Fallback favorites trigger clicked - current state:', sidebarOpen);
        
        if (content) {
          if (sidebarOpen) {
            content.classList.remove('open');
            sidebarOpen = false;
            console.log('Sidebar closed');
          } else {
            content.classList.add('open');
            sidebarOpen = true;
            console.log('Sidebar opened');
          }
        } else {
          console.error('Sidebar content not found');
        }
      });
      
      console.log('Click listener added to trigger');
    } else {
      console.error('Sidebar trigger not found');
    }

    if (close) {
      close.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Close button clicked');
        
        if (content) {
          content.classList.remove('open');
          sidebarOpen = false;
          console.log('Sidebar closed via close button');
        }
      });
    }
    
    // Add escape key listener
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && sidebarOpen && content) {
        content.classList.remove('open');
        sidebarOpen = false;
        console.log('Sidebar closed via Escape key');
      }
    });
  }
});