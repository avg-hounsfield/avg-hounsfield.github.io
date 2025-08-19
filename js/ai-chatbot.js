// js/ai-chatbot.js - AI Chatbot for Medical Imaging Assistance

class ImagingAIAssistant {
    constructor() {
        this.protocols = [];
        this.orders = [];
        this.isOpen = false;
        this.isTyping = false;
        
        // Initialize when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    async init() {
        this.initElements();
        this.setupEventListeners();
        await this.loadData();
    }

    initElements() {
        this.trigger = document.getElementById('chatbot-trigger');
        this.container = document.getElementById('chatbot-container');
        this.closeBtn = document.getElementById('chatbot-close');
        this.messagesContainer = document.getElementById('chatbot-messages');
        this.input = document.getElementById('chatbot-input');
        this.sendBtn = document.getElementById('chatbot-send');
        this.typingIndicator = document.getElementById('chatbot-typing');
    }

    setupEventListeners() {
        this.trigger?.addEventListener('click', () => this.toggleChat());
        this.closeBtn?.addEventListener('click', () => this.closeChat());
        this.sendBtn?.addEventListener('click', () => this.sendMessage());
        
        this.input?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.sendMessage();
            }
        });

        this.input?.addEventListener('input', () => {
            const hasText = this.input.value.trim().length > 0;
            this.sendBtn.disabled = !hasText;
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (this.isOpen && !e.target.closest('.ai-chatbot')) {
                this.closeChat();
            }
        });
    }

    async loadData() {
        try {
            const [protocolRes, ordersRes] = await Promise.all([
                fetch('./data/protocols.json'),
                fetch('./data/imaging-orders.json')
            ]);

            if (!protocolRes.ok || !ordersRes.ok) {
                throw new Error('Failed to load data');
            }

            const protocolData = await protocolRes.json();
            const ordersData = await ordersRes.json();

            this.protocols = protocolData.flatMap(p => 
                p.studies.map(s => ({...s, section: p.section[0], type: 'protocol'}))
            );
            
            this.orders = ordersData.flatMap(o => 
                o.studies.map(s => ({...s, section: o.section[0], type: 'order'}))
            );

            console.log('AI Assistant loaded:', this.protocols.length, 'protocols,', this.orders.length, 'orders');
        } catch (error) {
            console.error('Failed to load imaging data:', error);
        }
    }

    toggleChat() {
        if (this.isOpen) {
            this.closeChat();
        } else {
            this.openChat();
        }
    }

    openChat() {
        this.isOpen = true;
        this.container?.classList.add('open');
        this.input?.focus();
    }

    closeChat() {
        this.isOpen = false;
        this.container?.classList.remove('open');
    }

    async sendMessage() {
        const message = this.input?.value.trim();
        if (!message || this.isTyping) return;

        // Add user message
        this.addMessage(message, 'user');
        this.input.value = '';
        this.sendBtn.disabled = true;

        // Show typing indicator
        this.showTyping();

        // Generate AI response
        try {
            const response = await this.generateResponse(message);
            this.hideTyping();
            this.addMessage(response, 'ai');
        } catch (error) {
            this.hideTyping();
            this.addMessage('Sorry, I encountered an error. Please try again.', 'ai');
        }
    }

    addMessage(content, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = content;
        
        messageDiv.appendChild(contentDiv);
        this.messagesContainer?.appendChild(messageDiv);
        
        // Scroll to bottom
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    showTyping() {
        this.isTyping = true;
        this.typingIndicator.style.display = 'flex';
    }

    hideTyping() {
        this.isTyping = false;
        this.typingIndicator.style.display = 'none';
    }

    async generateResponse(userMessage) {
        const query = userMessage.toLowerCase().trim();
        
        // Simulate AI thinking time
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

        // Pattern matching for different types of questions
        if (this.isACRQuestion(query)) {
            return this.handleACRQuestion(query);
        } else if (this.isContrastQuestion(query)) {
            return this.handleContrastQuestion(query);
        } else if (this.isSymptomQuestion(query)) {
            return this.handleSymptomQuestion(query);
        } else if (this.isModalityQuestion(query)) {
            return this.handleModalityQuestion(query);
        } else if (this.isProtocolQuestion(query)) {
            return this.handleProtocolQuestion(query);
        } else {
            return this.handleGeneralQuestion(query);
        }
    }

    isACRQuestion(query) {
        return query.includes('acr') || query.includes('appropriateness') || 
               query.includes('rating') || query.includes('appropriate');
    }

    isContrastQuestion(query) {
        return query.includes('contrast') || query.includes('gadolinium') || 
               query.includes('dye') || query.includes('injection');
    }

    isSymptomQuestion(query) {
        const symptoms = ['headache', 'pain', 'seizure', 'stroke', 'tumor', 'infection', 
                         'fracture', 'trauma', 'bleeding', 'mass', 'cancer', 'cyst'];
        return symptoms.some(symptom => query.includes(symptom));
    }

    isModalityQuestion(query) {
        return query.includes('mri') || query.includes('ct') || query.includes('ultrasound') ||
               query.includes('nuclear') || query.includes('pet') || query.includes('scan');
    }

    isProtocolQuestion(query) {
        return query.includes('protocol') || query.includes('sequence') || 
               query.includes('how to') || query.includes('procedure');
    }

    handleACRQuestion(query) {
        // Extract condition from query
        const conditions = this.extractMedicalConditions(query);
        
        if (conditions.length === 0) {
            return `<p>I can help with ACR appropriateness ratings! Please specify a medical condition.</p>
                    <p><strong>Examples:</strong></p>
                    <ul>
                        <li>"ACR rating for brain tumor"</li>
                        <li>"What's appropriate for headache?"</li>
                        <li>"Best imaging for stroke"</li>
                    </ul>`;
        }

        const condition = conditions[0];
        const recommendations = this.findACRRecommendations(condition);

        if (recommendations.length === 0) {
            return `<p>I don't have specific ACR data for "${condition}" in our database.</p>
                    <p>Try searching for related terms like: brain tumor, headache, stroke, knee pain, or back pain.</p>`;
        }

        let response = `<p><strong>ACR Appropriateness for "${condition}":</strong></p>`;
        
        recommendations.forEach(rec => {
            const ratingClass = rec.rating >= 7 ? 'acr-rating-high' : rec.rating >= 4 ? 'acr-rating-medium' : 'acr-rating-low';
            response += `
                <div class="acr-recommendation">
                    <strong>${rec.study}</strong><br>
                    <span class="acr-rating ${ratingClass}">ACR Rating: ${rec.rating}/9</span> - ${rec.level}<br>
                    <small>Priority: ${rec.priority}</small>
                    ${rec.notes ? `<br><em>${rec.notes}</em>` : ''}
                </div>
            `;
        });

        return response;
    }

    handleContrastQuestion(query) {
        const contrastOrders = this.orders.filter(order => order.usesContrast);
        const noContrastOrders = this.orders.filter(order => !order.usesContrast);

        if (query.includes('when') || query.includes('why')) {
            return `<p><strong>When is contrast used?</strong></p>
                    <ul>
                        <li><strong>Brain/Spine:</strong> Tumor detection, infection, inflammation</li>
                        <li><strong>Abdomen:</strong> Organ enhancement, infection, vascular studies</li>
                        <li><strong>Chest:</strong> Lung masses, lymph nodes, pulmonary embolism</li>
                        <li><strong>MSK:</strong> Infection, tumors, detailed soft tissue evaluation</li>
                    </ul>
                    <p><strong>Contraindications:</strong> Kidney disease, allergies, pregnancy concerns</p>`;
        }

        return `<p>I can help with contrast-related questions!</p>
                <p><strong>We have:</strong></p>
                <ul>
                    <li>${contrastOrders.length} orders that use contrast</li>
                    <li>${noContrastOrders.length} orders without contrast</li>
                </ul>
                <p>Ask me: "When is contrast used?" or "Why use contrast for brain MRI?"</p>`;
    }

    handleSymptomQuestion(query) {
        const conditions = this.extractMedicalConditions(query);
        
        if (conditions.length === 0) {
            return `<p>I can suggest imaging based on symptoms!</p>
                    <p><strong>Try asking about:</strong></p>
                    <ul>
                        <li>Headache, stroke, seizure (brain)</li>
                        <li>Back pain, neck pain (spine)</li>
                        <li>Knee pain, shoulder pain (MSK)</li>
                        <li>Chest pain, shortness of breath (chest)</li>
                        <li>Abdominal pain (abdomen)</li>
                    </ul>`;
        }

        const condition = conditions[0];
        const recommendations = this.findImagingRecommendations(condition);

        if (recommendations.length === 0) {
            return `<p>I don't have specific recommendations for "${condition}" in our database.</p>
                    <p>Try related terms or ask about general imaging approaches for this area.</p>`;
        }

        let response = `<p><strong>Imaging recommendations for "${condition}":</strong></p>`;
        
        // Sort by ACR rating if available
        recommendations.sort((a, b) => (b.rating || 0) - (a.rating || 0));

        recommendations.slice(0, 3).forEach(rec => {
            response += `
                <div class="acr-recommendation">
                    <strong>${rec.study}</strong><br>
                    ${rec.rating ? `ACR Rating: ${rec.rating}/9 - ${rec.level}<br>` : ''}
                    <small>Modality: ${rec.modality} | ${rec.usesContrast ? 'With Contrast' : 'No Contrast'}</small>
                    ${rec.indication ? `<br><em>${rec.indication}</em>` : ''}
                </div>
            `;
        });

        return response;
    }

    handleModalityQuestion(query) {
        const modalities = ['CT', 'MRI', 'Ultrasound', 'Nuclear Medicine', 'Fluoroscopy'];
        let targetModality = '';

        for (const mod of modalities) {
            if (query.includes(mod.toLowerCase())) {
                targetModality = mod;
                break;
            }
        }

        if (!targetModality) {
            return `<p><strong>Available imaging modalities:</strong></p>
                    <ul>
                        <li><strong>CT:</strong> Fast, good for bone/trauma, uses X-rays</li>
                        <li><strong>MRI:</strong> Excellent soft tissue detail, no radiation</li>
                        <li><strong>Ultrasound:</strong> Real-time, safe, portable</li>
                        <li><strong>Nuclear Medicine:</strong> Functional imaging</li>
                        <li><strong>Fluoroscopy:</strong> Real-time X-ray imaging</li>
                    </ul>`;
        }

        const modalityOrders = this.orders.filter(order => 
            order.modality?.toLowerCase() === targetModality.toLowerCase()
        );

        return `<p><strong>${targetModality} Imaging:</strong></p>
                <p>We have ${modalityOrders.length} ${targetModality} orders in our database.</p>
                <p><strong>Common uses:</strong></p>
                ${this.getModalityUses(targetModality)}`;
    }

    getModalityUses(modality) {
        const uses = {
            'CT': '<ul><li>Trauma/fractures</li><li>Acute conditions</li><li>Lung nodules</li><li>Kidney stones</li></ul>',
            'MRI': '<ul><li>Brain/spine disorders</li><li>Soft tissue evaluation</li><li>Joint problems</li><li>Tumor detection</li></ul>',
            'Ultrasound': '<ul><li>Pregnancy</li><li>Abdominal organs</li><li>Vascular studies</li><li>Superficial masses</li></ul>',
            'Nuclear Medicine': '<ul><li>Bone scans</li><li>Cancer staging</li><li>Cardiac function</li><li>Thyroid studies</li></ul>',
            'Fluoroscopy': '<ul><li>Swallow studies</li><li>Joint injections</li><li>GI studies</li><li>Guided procedures</li></ul>'
        };
        return uses[modality] || '<p>Specialized imaging modality.</p>';
    }

    handleProtocolQuestion(query) {
        // Find relevant protocols
        const keywords = query.split(' ').filter(word => word.length > 2);
        const relevantProtocols = this.protocols.filter(protocol => 
            keywords.some(keyword => 
                protocol.study.toLowerCase().includes(keyword) ||
                (protocol.keywords && protocol.keywords.some(k => k.toLowerCase().includes(keyword)))
            )
        );

        if (relevantProtocols.length === 0) {
            return `<p>I can help with imaging protocols!</p>
                    <p><strong>Available protocol categories:</strong></p>
                    <ul>
                        <li>Brain MRI protocols</li>
                        <li>Spine imaging</li>
                        <li>MSK protocols</li>
                        <li>Body imaging</li>
                    </ul>
                    <p>Try asking: "Brain MRI protocol" or "Knee MRI sequences"</p>`;
        }

        let response = `<p><strong>Top ${Math.min(relevantProtocols.length, 3)} relevant protocol(s):</strong></p>`;
        
        relevantProtocols.slice(0, 3).forEach(protocol => {
            response += `
                <div class="acr-recommendation">
                    <strong>${protocol.study}</strong><br>
                    <small>Section: ${protocol.section} | ${protocol.usesContrast ? 'Uses Contrast' : 'No Contrast'}</small>
                </div>
            `;
        });

        return response;
    }

    handleGeneralQuestion(query) {
        // Try to find any relevant matches
        const allData = [...this.protocols, ...this.orders];
        const keywords = query.split(' ').filter(word => word.length > 2);
        
        const matches = allData.filter(item => 
            keywords.some(keyword => 
                item.study.toLowerCase().includes(keyword.toLowerCase()) ||
                item.indication?.toLowerCase().includes(keyword.toLowerCase()) ||
                (item.keywords && item.keywords.some(k => k.toLowerCase().includes(keyword.toLowerCase())))
            )
        );

        if (matches.length > 0) {
            // Sort matches by relevance
            const scoredMatches = matches.map(match => ({
                ...match,
                relevanceScore: this.calculateTextRelevance(query, match.study) + 
                               (match.indication ? this.calculateTextRelevance(query, match.indication) * 0.5 : 0)
            })).sort((a, b) => b.relevanceScore - a.relevanceScore);

            let response = `<p>Top ${Math.min(scoredMatches.length, 3)} related items:</p>`;
            scoredMatches.slice(0, 3).forEach(match => {
                response += `
                    <div class="acr-recommendation">
                        <strong>${match.study}</strong><br>
                        <small>Type: ${match.type} | Section: ${match.section}</small>
                        ${match.indication ? `<br><em>${match.indication.substring(0, 100)}...</em>` : ''}
                    </div>
                `;
            });
            return response;
        }

        return `<p>I can help you with imaging questions! Try asking about:</p>
                <ul>
                    <li><strong>Symptoms:</strong> "What imaging for headache?"</li>
                    <li><strong>ACR Guidelines:</strong> "ACR rating for brain tumor"</li>
                    <li><strong>Modalities:</strong> "When to use MRI vs CT?"</li>
                    <li><strong>Contrast:</strong> "When is contrast needed?"</li>
                    <li><strong>Protocols:</strong> "Brain MRI protocol"</li>
                </ul>`;
    }

    extractMedicalConditions(query) {
        const queryLower = query.toLowerCase().trim();
        
        // Enhanced medical condition patterns and their synonyms/variations
        const medicalPatterns = {
            'stroke': [
                'stroke', 'cva', 'cerebrovascular accident', 'brain attack',
                'concern for stroke', 'stroke like', 'stroke-like', 'strokelike',
                'possible stroke', 'suspected stroke', 'r/o stroke', 'rule out stroke',
                'stroke symptoms', 'stroke workup', 'acute stroke', 'tia'
            ],
            'headache': [
                'headache', 'head ache', 'cephalgia', 'head pain', 'migraines',
                'severe headache', 'chronic headache', 'migraine', 'cluster headache',
                'concern for headache', 'headache workup', 'head hurt', 'cranial pain'
            ],
            'seizure': [
                'seizure', 'seizures', 'convulsion', 'epilepsy', 'fits', 'spells',
                'seizure like', 'seizure-like', 'possible seizure', 'convulsions',
                'concern for seizure', 'r/o seizure', 'rule out seizure',
                'seizure activity', 'convulsive episode', 'epileptic'
            ],
            'trauma': [
                'trauma', 'injury', 'accident', 'fall', 'hit', 'struck', 'injured',
                'head trauma', 'brain trauma', 'traumatic injury', 'blunt trauma',
                'post trauma', 'after fall', 'motor vehicle accident', 'mva',
                'car accident', 'fell down', 'head injury'
            ],
            'tumor': [
                'tumor', 'tumour', 'mass', 'lesion', 'growth', 'neoplasm', 'cancer',
                'brain tumor', 'brain mass', 'intracranial mass', 'malignancy',
                'concern for tumor', 'possible tumor', 'r/o tumor', 'oncology',
                'rule out tumor', 'mass effect', 'suspicious lesion'
            ],
            'infection': [
                'infection', 'infectious', 'sepsis', 'abscess', 'cellulitis',
                'concern for infection', 'possible infection', 'fever',
                'r/o infection', 'rule out infection', 'inflammatory'
            ],
            'meningitis': [
                'meningitis', 'meningeal', 'neck stiffness', 'stiff neck',
                'concern for meningitis', 'possible meningitis',
                'r/o meningitis', 'rule out meningitis'
            ],
            'altered mental status': [
                'altered mental status', 'ams', 'confusion', 'confused',
                'mental status change', 'altered consciousness', 'disoriented',
                'cognitive change', 'behavioral change', 'acting strange'
            ],
            'back pain': [
                'back pain', 'lower back pain', 'lumbar pain', 'low back pain',
                'spine pain', 'spinal pain', 'dorsalgia', 'back ache',
                'back hurt', 'lumbar ache'
            ],
            'neck pain': [
                'neck pain', 'cervical pain', 'cervicalgia', 'neck ache',
                'neck hurt', 'cervical spine pain'
            ],
            'sciatica': [
                'sciatica', 'sciatic pain', 'radicular pain', 'shooting pain',
                'leg pain', 'shooting pain down leg', 'pain radiating'
            ],
            'radiculopathy': [
                'radiculopathy', 'nerve root', 'pinched nerve', 'trapped nerve',
                'compressed nerve', 'nerve compression', 'nerve pain'
            ],
            'chest pain': [
                'chest pain', 'chest discomfort', 'thoracic pain', 'chest hurt',
                'precordial pain', 'retrosternal pain', 'chest tightness'
            ],
            'shortness of breath': [
                'shortness of breath', 'dyspnea', 'sob', 'difficulty breathing',
                'breathing problems', 'breathlessness', 'cant breathe',
                'trouble breathing', 'winded'
            ],
            'pulmonary embolism': [
                'pulmonary embolism', 'pe', 'blood clot', 'clot', 'embolus',
                'concern for pe', 'possible pe', 'r/o pe', 'rule out pe',
                'lung clot'
            ],
            'kidney stones': [
                'kidney stones', 'renal stones', 'nephrolithiasis', 'stones',
                'kidney stone', 'renal calculi', 'ureteral stone', 'flank pain'
            ],
            'abdominal pain': [
                'abdominal pain', 'belly pain', 'stomach pain', 'tummy pain',
                'abd pain', 'epigastric pain', 'right upper quadrant pain',
                'left lower quadrant pain', 'rlq pain', 'llq pain', 'gut pain'
            ],
            'knee pain': [
                'knee pain', 'knee hurt', 'knee injury', 'knee problem',
                'patella pain', 'kneecap pain'
            ],
            'shoulder pain': [
                'shoulder pain', 'shoulder hurt', 'shoulder injury',
                'rotator cuff', 'shoulder problem'
            ],
            'ankle pain': [
                'ankle pain', 'ankle hurt', 'ankle injury', 'ankle sprain',
                'twisted ankle'
            ]
        };
        
        const extractedConditions = [];
        
        // Check each medical condition pattern
        for (const [condition, patterns] of Object.entries(medicalPatterns)) {
            for (const pattern of patterns) {
                if (queryLower.includes(pattern)) {
                    extractedConditions.push(condition);
                    break; // Don't add the same condition multiple times
                }
            }
        }
        
        return extractedConditions;
    }

    calculateRelevanceScore(searchCondition, acrCondition) {
        const searchLower = searchCondition.toLowerCase();
        const acrLower = acrCondition.toLowerCase();
        
        // Exact match gets highest score
        if (searchLower === acrLower) {
            return 100;
        }
        
        // One contains the other gets high score
        if (searchLower.includes(acrLower) || acrLower.includes(searchLower)) {
            return 80;
        }
        
        // Check for medical synonyms and related terms
        const synonymMap = {
            'stroke': ['cva', 'cerebrovascular accident', 'brain attack'],
            'headache': ['migraine', 'cephalgia', 'head pain'],
            'seizure': ['epilepsy', 'convulsion', 'fits'],
            'trauma': ['injury', 'accident', 'fracture'],
            'tumor': ['cancer', 'mass', 'lesion', 'neoplasm'],
            'infection': ['sepsis', 'abscess', 'inflammatory'],
            'back pain': ['lumbar pain', 'spine pain', 'dorsalgia'],
            'neck pain': ['cervical pain', 'cervicalgia'],
            'chest pain': ['thoracic pain', 'precordial pain'],
            'abdominal pain': ['belly pain', 'stomach pain', 'abd pain']
        };
        
        // Check if terms are synonyms
        for (const [primary, synonyms] of Object.entries(synonymMap)) {
            if ((searchLower.includes(primary) || synonyms.some(s => searchLower.includes(s))) &&
                (acrLower.includes(primary) || synonyms.some(s => acrLower.includes(s)))) {
                return 60;
            }
        }
        
        // Partial word matching
        const searchWords = searchLower.split(' ');
        const acrWords = acrLower.split(' ');
        const commonWords = searchWords.filter(word => 
            word.length > 2 && acrWords.some(acrWord => 
                acrWord.includes(word) || word.includes(acrWord)
            )
        );
        
        if (commonWords.length > 0) {
            return Math.min(40, commonWords.length * 15);
        }
        
        return 0;
    }

    findACRRecommendations(condition) {
        const recommendations = [];
        
        this.orders.forEach(order => {
            if (order.acrData?.appropriateness) {
                let bestMatch = null;
                let bestScore = 0;
                
                Object.entries(order.acrData.appropriateness).forEach(([cond, data]) => {
                    const relevanceScore = this.calculateRelevanceScore(condition, cond);
                    if (relevanceScore > 0 && relevanceScore > bestScore) {
                        bestMatch = {
                            study: order.study,
                            rating: data.rating,
                            level: data.level,
                            priority: order.acrData.priority,
                            notes: order.acrData.notes,
                            relevanceScore: relevanceScore,
                            matchedCondition: cond
                        };
                        bestScore = relevanceScore;
                    }
                });
                
                if (bestMatch) {
                    recommendations.push(bestMatch);
                }
            }
        });

        // Sort by relevance score first, then by ACR rating
        return recommendations
            .sort((a, b) => {
                if (a.relevanceScore !== b.relevanceScore) {
                    return b.relevanceScore - a.relevanceScore;
                }
                return b.rating - a.rating;
            })
            .slice(0, 3); // Limit to top 3 recommendations
    }

    findImagingRecommendations(condition) {
        const recommendations = [];
        
        // Check orders with ACR data first
        this.orders.forEach(order => {
            if (order.acrData?.appropriateness) {
                let bestMatch = null;
                let bestScore = 0;
                
                Object.entries(order.acrData.appropriateness).forEach(([cond, data]) => {
                    const relevanceScore = this.calculateRelevanceScore(condition, cond);
                    if (relevanceScore > 0 && relevanceScore > bestScore) {
                        bestMatch = {
                            ...order,
                            rating: data.rating,
                            level: data.level,
                            relevanceScore: relevanceScore,
                            matchedCondition: cond
                        };
                        bestScore = relevanceScore;
                    }
                });
                
                if (bestMatch) {
                    recommendations.push(bestMatch);
                }
            }
        });

        // Also check indication text with scoring
        this.orders.forEach(order => {
            if (order.indication && !recommendations.find(r => r.study === order.study)) {
                const indicationScore = this.calculateTextRelevance(condition, order.indication);
                if (indicationScore > 0) {
                    recommendations.push({
                        ...order,
                        relevanceScore: indicationScore * 0.5 // Lower weight than ACR matches
                    });
                }
            }
        });

        // Sort by relevance score first, then by ACR rating
        return recommendations
            .sort((a, b) => {
                if (a.relevanceScore !== b.relevanceScore) {
                    return b.relevanceScore - a.relevanceScore;
                }
                return (b.rating || 0) - (a.rating || 0);
            })
            .slice(0, 3); // Limit to top 3 recommendations
    }

    calculateTextRelevance(searchTerm, text) {
        const searchLower = searchTerm.toLowerCase();
        const textLower = text.toLowerCase();
        
        // Exact phrase match
        if (textLower.includes(searchLower)) {
            return 100;
        }
        
        // Word-by-word matching
        const searchWords = searchLower.split(' ').filter(w => w.length > 2);
        const textWords = textLower.split(/\s+/);
        
        let matches = 0;
        for (const searchWord of searchWords) {
            if (textWords.some(textWord => 
                textWord.includes(searchWord) || searchWord.includes(textWord)
            )) {
                matches++;
            }
        }
        
        return searchWords.length > 0 ? (matches / searchWords.length) * 80 : 0;
    }
}

// Initialize the AI assistant
const imagingAI = new ImagingAIAssistant();