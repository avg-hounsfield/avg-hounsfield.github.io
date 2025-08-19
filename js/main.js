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

    // Enhanced AI Chatbot Logic System
    const chatbotState = {
        conversationHistory: [],
        currentContext: null,
        userPreferences: {},
        lastQuery: '',
        clarificationNeeded: false,
        followUpSuggestions: []
    };

    // Enhanced natural language patterns for better understanding
    const conversationalPatterns = {
        // Question types
        questionTypes: {
            symptoms: /(?:patient has|patient with|experiencing|complaining of|presenting with|symptoms of|suffering from)/i,
            diagnostic: /(?:rule out|r\/o|exclude|differential|workup|evaluate for|assess for|screen for)/i,
            followup: /(?:follow up|followup|monitor|recheck|surveillance|repeat|progression)/i,
            comparison: /(?:compare|versus|vs|difference between|which is better|should i use)/i,
            protocol: /(?:protocol for|imaging for|best scan|what study|recommended)/i,
            urgency: /(?:urgent|stat|emergent|emergency|acute|now|immediate)/i,
            contrast: /(?:with contrast|without contrast|w\/|w\/o|gadolinium|iv contrast)/i
        },
        
        // Intent recognition
        intents: {
            findProtocol: /(?:find|search|look for|need|want|show me|protocol for)/i,
            compare: /(?:compare|versus|vs|difference|which|better|prefer)/i,
            explain: /(?:explain|what is|tell me about|describe|definition of)/i,
            recommend: /(?:recommend|suggest|advise|best|should|would)/i,
            clarify: /(?:clarify|unclear|confused|not sure|help|don't understand)/i
        },
        
        // Context extraction
        anatomy: {
            brain: /(?:brain|head|cranial|cerebral|intracranial|neural|neuro)/i,
            spine: /(?:spine|spinal|back|cervical|thoracic|lumbar|sacral|vertebr)/i,
            chest: /(?:chest|lung|pulmonary|thorax|heart|cardiac|coronary)/i,
            abdomen: /(?:abdomen|abdominal|belly|stomach|liver|kidney|bowel|intestin)/i,
            pelvis: /(?:pelvis|pelvic|hip|reproductive|uterus|prostate|bladder)/i,
            extremity: /(?:arm|leg|hand|foot|shoulder|knee|ankle|wrist|elbow)/i,
            neck: /(?:neck|cervical|throat|thyroid|carotid)/i,
            vascular: /(?:vessel|vascular|artery|vein|circulation|blood flow)/i
        },
        
        // Urgency levels
        urgency: {
            emergent: /(?:emergency|urgent|stat|acute|severe|critical|immediate)/i,
            routine: /(?:routine|standard|normal|regular|scheduled|elective)/i,
            followup: /(?:follow.?up|monitor|surveillance|routine)/i
        }
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

    // --- AI PROCESSING FUNCTIONS ---

    // AI-powered query understanding
    function parseNaturalLanguageQuery(query) {
        const analysis = {
            intent: 'findProtocol',
            anatomy: [],
            symptoms: [],
            urgency: 'routine',
            contrast: null,
            questionType: 'protocol',
            confidence: 0,
            context: {}
        };
        
        // Detect intent
        for (const [intent, pattern] of Object.entries(conversationalPatterns.intents)) {
            if (pattern.test(query)) {
                analysis.intent = intent;
                analysis.confidence += 0.2;
                break;
            }
        }
        
        // Extract anatomy
        for (const [anatomy, pattern] of Object.entries(conversationalPatterns.anatomy)) {
            if (pattern.test(query)) {
                analysis.anatomy.push(anatomy);
                analysis.confidence += 0.15;
            }
        }
        
        // Detect question type
        for (const [type, pattern] of Object.entries(conversationalPatterns.questionTypes)) {
            if (pattern.test(query)) {
                analysis.questionType = type;
                analysis.confidence += 0.1;
                break;
            }
        }
        
        // Detect urgency
        for (const [urgency, pattern] of Object.entries(conversationalPatterns.urgency)) {
            if (pattern.test(query)) {
                analysis.urgency = urgency;
                analysis.confidence += 0.1;
                break;
            }
        }
        
        // Extract symptoms and conditions
        const medicalTerms = extractMedicalTermsFromQuery(query);
        analysis.symptoms = medicalTerms.symptoms;
        analysis.confidence += medicalTerms.confidence;
        
        return analysis;
    }

    // Extract medical terms and conditions from query
    function extractMedicalTermsFromQuery(query) {
        const result = {
            symptoms: [],
            conditions: [],
            confidence: 0
        };
        
        // Extract symptoms
        symptomKeywords.forEach(symptom => {
            if (query.toLowerCase().includes(symptom)) {
                result.symptoms.push(symptom);
                result.confidence += 0.1;
            }
        });
        
        return result;
    }

    // Generate intelligent follow-up questions and suggestions
    function generateFollowUpSuggestions(query, results, analysis) {
        const suggestions = [];
        
        // If low confidence, ask clarifying questions
        if (analysis.confidence < 0.3) {
            if (analysis.anatomy.length === 0) {
                suggestions.push({
                    type: 'clarification',
                    text: 'Which body part or organ system are you interested in?',
                    options: ['Brain/Head', 'Spine', 'Chest', 'Abdomen', 'Pelvis', 'Extremities']
                });
            }
            
            if (analysis.symptoms.length === 0 && analysis.questionType === 'symptoms') {
                suggestions.push({
                    type: 'clarification',
                    text: 'What symptoms is the patient experiencing?',
                    options: ['Pain', 'Mass/Lump', 'Neurological symptoms', 'Breathing issues', 'Other']
                });
            }
        }
        
        // Suggest related protocols based on results
        if (results.length > 0) {
            const relatedAnatomy = analysis.anatomy[0];
            if (relatedAnatomy) {
                suggestions.push({
                    type: 'related',
                    text: `Other ${relatedAnatomy} studies you might consider:`,
                    queries: generateRelatedQueries(relatedAnatomy, results)
                });
            }
        }
        
        // Suggest contrast considerations
        if (results.some(r => r.usesContrast) && results.some(r => !r.usesContrast)) {
            suggestions.push({
                type: 'contrast',
                text: 'Would you like to see options with or without contrast?',
                options: ['With Contrast', 'Without Contrast', 'Both']
            });
        }
        
        // Urgency-based suggestions
        if (analysis.urgency === 'emergent') {
            suggestions.push({
                type: 'urgency',
                text: 'For urgent cases, consider these faster alternatives:',
                focus: 'ct' // Prioritize CT over MRI for urgent cases
            });
        }
        
        return suggestions;
    }

    // Generate related search queries
    function generateRelatedQueries(anatomy, currentResults) {
        const relatedQueries = {
            brain: ['brain tumor', 'stroke workup', 'headache evaluation', 'seizure workup'],
            spine: ['back pain', 'cervical spine', 'lumbar spine', 'spinal stenosis'],
            chest: ['chest pain', 'lung nodule', 'pulmonary embolism', 'coronary assessment'],
            abdomen: ['abdominal pain', 'liver lesion', 'kidney stones', 'bowel obstruction'],
            pelvis: ['pelvic pain', 'prostate', 'ovarian cyst', 'bladder'],
            extremity: ['joint pain', 'fracture', 'sports injury', 'arthritis']
        };
        
        return relatedQueries[anatomy] || [];
    }

    // Track user interactions for learning
    function trackUserInteraction(query, selectedResult, analysis) {
        // Store interaction in chatbot state
        chatbotState.conversationHistory.push({
            timestamp: Date.now(),
            query: query,
            analysis: analysis,
            selectedResult: selectedResult,
            context: chatbotState.currentContext
        });
        
        // Update user preferences
        if (selectedResult) {
            const modality = selectedResult.modality || 'unknown';
            chatbotState.userPreferences[modality] = (chatbotState.userPreferences[modality] || 0) + 1;
            
            // Track anatomy preferences
            if (analysis.anatomy.length > 0) {
                analysis.anatomy.forEach(anatomy => {
                    chatbotState.userPreferences[anatomy] = (chatbotState.userPreferences[anatomy] || 0) + 1;
                });
            }
        }
        
        // Limit history size
        if (chatbotState.conversationHistory.length > 50) {
            chatbotState.conversationHistory.shift();
        }
    }

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

        const query = searchInput.value.trim();
        const isOrdersMode = dataSourceToggle?.checked || dataSourceToggleMobile?.checked || ordersOnlyToggle?.checked || false;
        const dataToSearch = isOrdersMode ? allOrders : allProtocols;

        if (!query) {
            resultsContainer.innerHTML = '<p>Enter a search term to begin.</p>';
            document.body.classList.remove('search-active');
            return;
        }

        // Add search active state for mobile full-screen and favorites hiding
        document.body.classList.add('search-active');

        // Use requestAnimationFrame for smooth rendering on mobile
        requestAnimationFrame(() => {
            // Parse query with AI understanding
            const queryAnalysis = parseNaturalLanguageQuery(query);
            
            // Update chatbot state
            chatbotState.lastQuery = query;
            chatbotState.currentContext = queryAnalysis;

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

            // Limit results to top 2 suggestions for chatbot-style interface
            const topResults = results.slice(0, 2);
            
            console.log(`Found ${results.length} results, showing top 2 for query "${query}":`, topResults.map(r => r.study));

            // Render as suggestion cards with AI analysis
            renderSuggestionCards(topResults, isOrdersMode, query, queryAnalysis);
        });
    }

    // Enhanced chatbot-style suggestion cards with AI logic
    function renderSuggestionCards(results, isOrdersOnly, query, queryAnalysis) {
        // Generate intelligent follow-up suggestions
        const followUpSuggestions = generateFollowUpSuggestions(query, results, queryAnalysis);
        chatbotState.followUpSuggestions = followUpSuggestions;
        
        // Create conversational search context
        let searchContext = '';
        
        if (queryAnalysis.confidence > 0.6) {
            if (queryAnalysis.urgency === 'emergent') {
                searchContext = `
                    <div class="search-context urgent">
                        <p class="context-note">
                            <span class="material-symbols-outlined">emergency</span>
                            🚨 <strong>Urgent Case Detected:</strong> Prioritizing rapid imaging options
                        </p>
                    </div>
                `;
            } else if (queryAnalysis.questionType === 'symptoms') {
                const symptoms = queryAnalysis.symptoms.join(', ') || 'these symptoms';
                searchContext = `
                    <div class="search-context">
                        <p class="context-note">
                            <span class="material-symbols-outlined">medical_services</span>
                            For patient with <strong>${symptoms}</strong>, here are the recommended imaging studies:
                        </p>
                    </div>
                `;
            } else if (queryAnalysis.questionType === 'diagnostic') {
                searchContext = `
                    <div class="search-context">
                        <p class="context-note">
                            <span class="material-symbols-outlined">search</span>
                            Diagnostic workup recommendations:
                        </p>
                    </div>
                `;
            }
        } else if (queryAnalysis.confidence < 0.3) {
            searchContext = `
                <div class="search-context clarification">
                    <p class="context-note">
                        <span class="material-symbols-outlined">help</span>
                        I found some results, but could you be more specific? 
                    </p>
                </div>
            `;
        }

        if (results.length === 0) {
            resultsContainer.innerHTML = `${searchContext}<p>No results found for "${query}".</p>`;
            return;
        }

        const suggestionCards = results.map((item, index) => {
            const contrastText = item.usesContrast ? 'YES' : 'NO';
            const contrastClass = item.usesContrast ? 'contrast-yes' : 'contrast-no';
            
            // Create enhanced preview content with AI insights
            let previewContent = '';
            let aiInsight = '';
            
            if (isOrdersOnly) {
                previewContent = `${item.modality || 'Unknown modality'} • ${item.section || 'Other'}`;
                if (item.orderType && item.orderType !== 'Standard') {
                    previewContent += ` • ${item.orderType}`;
                }
                
                // Add AI insights for orders
                if (queryAnalysis.urgency === 'emergent' && item.modality === 'CT') {
                    aiInsight = '⚡ Fast option for urgent cases';
                } else if (queryAnalysis.questionType === 'symptoms' && item.study.includes('ANGIO')) {
                    aiInsight = '🔍 Excellent for vascular assessment';
                }
            } else {
                const sequenceCount = item.keywords ? item.keywords.length : 0;
                if (sequenceCount > 0) {
                    previewContent = `${sequenceCount} sequence${sequenceCount !== 1 ? 's' : ''}`;
                }
                if (item.indication) {
                    const truncatedIndications = item.indication.length > 100 ? 
                        item.indication.substring(0, 100) + '...' : item.indication;
                    previewContent += previewContent ? ` • ${truncatedIndications}` : truncatedIndications;
                }
                if (!previewContent) {
                    previewContent = `${item.section || 'Other'} protocol`;
                }
                
                // Add AI insights for protocols
                if (queryAnalysis.anatomy.length > 0 && 
                    queryAnalysis.anatomy.some(anatomy => item.study.toLowerCase().includes(anatomy))) {
                    aiInsight = `🎯 Matches ${queryAnalysis.anatomy.join(', ')} anatomy`;
                }
            }
            
            // Combine preview with AI insight
            if (aiInsight) {
                previewContent += ` • ${aiInsight}`;
            }
            
            return `
                <div class="suggestion-card" onclick="showDetailView(${index}, ${isOrdersOnly})" data-index="${index}">
                    <div class="suggestion-header">
                        <h3 class="suggestion-title">${item.study || 'Untitled'}</h3>
                        <div class="suggestion-badges">
                            <span class="contrast-badge ${contrastClass}">
                                ${contrastText === 'YES' ? 'With Contrast' : 'No Contrast'}
                            </span>
                        </div>
                    </div>
                    <p class="suggestion-preview">${previewContent}</p>
                    <button class="view-details-btn">View Details</button>
                </div>
            `;
        }).join('');
        
        // Generate follow-up suggestions HTML
        let followUpHTML = '';
        if (followUpSuggestions.length > 0) {
            followUpHTML = renderFollowUpSuggestions(followUpSuggestions);
        }
        
        resultsContainer.innerHTML = `
            ${searchContext}
            <div class="search-suggestions">
                ${suggestionCards}
            </div>
            ${followUpHTML}
        `;
        
        // Store results globally for detail view access
        window.currentSearchResults = results;
        window.currentIsOrdersMode = isOrdersOnly;
        window.currentQueryAnalysis = queryAnalysis;
        
        // Add animations
        setTimeout(() => {
            const cards = resultsContainer.querySelectorAll('.suggestion-card');
            cards.forEach((card, index) => {
                card.style.animationDelay = `${index * 120}ms`;
                card.classList.add('fade-in-up');
            });
            
            // Animate follow-up suggestions
            const followUpCards = resultsContainer.querySelectorAll('.follow-up-suggestion');
            followUpCards.forEach((card, index) => {
                card.style.animationDelay = `${(cards.length + index) * 120}ms`;
                card.classList.add('fade-in-up');
            });
        }, 100);
    }

    // Render follow-up suggestions
    function renderFollowUpSuggestions(suggestions) {
        if (!suggestions.length) return '';
        
        const suggestionCards = suggestions.map((suggestion, index) => {
            if (suggestion.type === 'clarification') {
                return `
                    <div class="follow-up-suggestion clarification" data-type="${suggestion.type}">
                        <div class="suggestion-header">
                            <span class="material-symbols-outlined">help_outline</span>
                            <h4>${suggestion.text}</h4>
                        </div>
                        <div class="suggestion-options">
                            ${suggestion.options.map(option => 
                                `<button class="suggestion-option" onclick="handleFollowUpClick('${option}')">${option}</button>`
                            ).join('')}
                        </div>
                    </div>
                `;
            } else if (suggestion.type === 'related') {
                return `
                    <div class="follow-up-suggestion related" data-type="${suggestion.type}">
                        <div class="suggestion-header">
                            <span class="material-symbols-outlined">explore</span>
                            <h4>${suggestion.text}</h4>
                        </div>
                        <div class="suggestion-options">
                            ${suggestion.queries.map(query => 
                                `<button class="suggestion-option" onclick="handleFollowUpClick('${query}')">${query}</button>`
                            ).join('')}
                        </div>
                    </div>
                `;
            } else if (suggestion.type === 'contrast') {
                return `
                    <div class="follow-up-suggestion contrast" data-type="${suggestion.type}">
                        <div class="suggestion-header">
                            <span class="material-symbols-outlined">science</span>
                            <h4>${suggestion.text}</h4>
                        </div>
                        <div class="suggestion-options">
                            ${suggestion.options.map(option => 
                                `<button class="suggestion-option" onclick="handleContrastFilter('${option}')">${option}</button>`
                            ).join('')}
                        </div>
                    </div>
                `;
            } else if (suggestion.type === 'urgency') {
                return `
                    <div class="follow-up-suggestion urgency urgent" data-type="${suggestion.type}">
                        <div class="suggestion-header">
                            <span class="material-symbols-outlined">emergency</span>
                            <h4>${suggestion.text}</h4>
                        </div>
                        <p>CT scans are typically faster than MRI for urgent cases.</p>
                    </div>
                `;
            }
            return '';
        }).filter(Boolean).join('');
        
        return `
            <div class="follow-up-suggestions">
                <h3>💡 Suggestions</h3>
                ${suggestionCards}
            </div>
        `;
    }

    // Global interaction handlers
    window.handleFollowUpClick = function(query) {
        searchInput.value = query;
        handleSearch(true);
    };

    window.handleContrastFilter = function(contrastOption) {
        const currentResults = window.currentSearchResults || [];
        let filteredResults = currentResults;
        
        if (contrastOption === 'With Contrast') {
            filteredResults = currentResults.filter(r => r.usesContrast);
        } else if (contrastOption === 'Without Contrast') {
            filteredResults = currentResults.filter(r => !r.usesContrast);
        }
        
        // Re-render with filtered results
        renderSuggestionCards(filteredResults.slice(0, 2), window.currentIsOrdersMode, chatbotState.lastQuery, window.currentQueryAnalysis);
    };

    window.showDetailView = function(index, isOrdersOnly) {
        const item = window.currentSearchResults[index];
        if (!item) return;
        
        // Track user interaction for learning
        trackUserInteraction(chatbotState.lastQuery, item, window.currentQueryAnalysis);
        
        // Create overlay with detailed protocol information
        const overlay = document.createElement('div');
        overlay.className = 'detail-overlay';
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        };
        
        // Use existing render function or create simplified version
        let detailContent;
        if (typeof renderGroupedProtocols === 'function') {
            const grouped = { [item.section || 'Details']: [item] };
            detailContent = renderGroupedProtocols(grouped, isOrdersOnly, chatbotState.lastQuery);
        } else {
            // Fallback detailed view
            detailContent = `
                <div style="margin: 2rem; padding: 2rem;">
                    <h2>${item.study}</h2>
                    <p><strong>Section:</strong> ${item.section || 'Other'}</p>
                    <p><strong>Contrast:</strong> ${item.usesContrast ? 'Yes' : 'No'}</p>
                    ${item.indication ? `<p><strong>Indication:</strong> ${item.indication}</p>` : ''}
                    ${item.keywords ? `<p><strong>Keywords:</strong> ${item.keywords.join(', ')}</p>` : ''}
                </div>
            `;
        }
        
        overlay.innerHTML = `
            <div class="detail-content">
                <button class="detail-close" onclick="document.body.removeChild(this.closest('.detail-overlay'))">
                    <span class="material-symbols-outlined">close</span>
                </button>
                ${detailContent}
            </div>
        `;
        
        document.body.appendChild(overlay);
    };

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