/**
 * AI Assistant Module for Protocol.Help
 *
 * Integrates with Cloudflare Worker to provide Claude-powered
 * clinical imaging guidance.
 */

// Worker endpoint
const AI_ENDPOINT = 'https://protocol-help-ai.58hwdggkb7.workers.dev';

// State
let conversationHistory = [];
let isProcessing = false;

/**
 * Initialize AI assistant UI
 */
export function initAIAssistant() {
    createAssistantUI();
    attachEventListeners();
}

/**
 * Create the AI assistant UI elements
 */
function createAssistantUI() {
    // AI toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'ai-toggle';
    toggleBtn.className = 'ai-toggle-btn';
    toggleBtn.innerHTML = `
        <span class="material-symbols-outlined">smart_toy</span>
        <span class="ai-label">AI Assistant</span>
    `;
    toggleBtn.title = 'Open AI Clinical Assistant';

    // AI panel
    const panel = document.createElement('div');
    panel.id = 'ai-panel';
    panel.className = 'ai-panel';
    panel.innerHTML = `
        <div class="ai-panel-header">
            <h3>
                <span class="material-symbols-outlined">smart_toy</span>
                Clinical Imaging Assistant
            </h3>
            <button class="ai-close-btn" title="Close">
                <span class="material-symbols-outlined">close</span>
            </button>
        </div>
        <div class="ai-panel-body">
            <div class="ai-messages" id="aiMessages">
                <div class="ai-message assistant">
                    <div class="ai-message-content">
                        <p>Hello! I can help you find the right imaging study for your clinical scenario.</p>
                        <p>Try asking questions like:</p>
                        <ul>
                            <li>"What imaging for suspected stroke?"</li>
                            <li>"CT vs MRI for low back pain?"</li>
                            <li>"When is contrast indicated for brain MRI?"</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
        <div class="ai-panel-footer">
            <div class="ai-input-wrapper">
                <input
                    type="text"
                    id="aiInput"
                    class="ai-input"
                    placeholder="Ask about imaging..."
                    autocomplete="off"
                >
                <button id="aiSend" class="ai-send-btn" title="Send">
                    <span class="material-symbols-outlined">send</span>
                </button>
            </div>
            <p class="ai-disclaimer">AI responses are for reference only. Always verify with current guidelines.</p>
        </div>
    `;

    document.body.appendChild(toggleBtn);
    document.body.appendChild(panel);
}

/**
 * Attach event listeners
 */
function attachEventListeners() {
    const toggleBtn = document.getElementById('ai-toggle');
    const closeBtn = document.querySelector('.ai-close-btn');
    const input = document.getElementById('aiInput');
    const sendBtn = document.getElementById('aiSend');
    const panel = document.getElementById('ai-panel');

    toggleBtn?.addEventListener('click', () => {
        panel.classList.toggle('open');
        if (panel.classList.contains('open')) {
            input?.focus();
        }
    });

    closeBtn?.addEventListener('click', () => {
        panel.classList.remove('open');
    });

    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    sendBtn?.addEventListener('click', sendMessage);

    // Close on escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel.classList.contains('open')) {
            panel.classList.remove('open');
        }
    });
}

/**
 * Send message to AI
 */
async function sendMessage() {
    const input = document.getElementById('aiInput');
    const message = input?.value.trim();

    if (!message || isProcessing) return;

    isProcessing = true;
    input.value = '';

    // Add user message to UI
    addMessageToUI('user', message);

    // Add to conversation history
    conversationHistory.push({
        role: 'user',
        content: message
    });

    // Show loading
    const loadingId = addLoadingMessage();

    try {
        // Get current search context
        const context = getCurrentContext();

        const response = await fetch(AI_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: conversationHistory,
                context
            })
        });

        if (!response.ok) {
            throw new Error('AI service unavailable');
        }

        const data = await response.json();

        // Remove loading
        removeLoadingMessage(loadingId);

        // Add assistant response
        addMessageToUI('assistant', data.content);

        // Add to history
        conversationHistory.push({
            role: 'assistant',
            content: data.content
        });

        // Extract and suggest search terms
        suggestSearchTerms(data.content);

    } catch (error) {
        console.error('AI error:', error);
        removeLoadingMessage(loadingId);
        addMessageToUI('assistant', 'Sorry, I encountered an error. Please try again or use the search function directly.', true);
    }

    isProcessing = false;
}

/**
 * Add message to UI
 */
function addMessageToUI(role, content, isError = false) {
    const messagesContainer = document.getElementById('aiMessages');
    if (!messagesContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `ai-message ${role}${isError ? ' error' : ''}`;

    // Parse markdown-like content
    const formattedContent = formatMessage(content);

    messageDiv.innerHTML = `
        <div class="ai-message-content">${formattedContent}</div>
    `;

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Format message with basic markdown
 */
function formatMessage(content) {
    return content
        // Headers
        .replace(/^### (.*$)/gim, '<h4>$1</h4>')
        .replace(/^## (.*$)/gim, '<h3>$1</h3>')
        // Bold
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        // Lists
        .replace(/^\- (.*$)/gim, '<li>$1</li>')
        .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
        // Line breaks
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>')
        // Wrap in paragraph
        .replace(/^(.*)$/, '<p>$1</p>')
        // Clean up
        .replace(/<p><\/p>/g, '')
        .replace(/<p><ul>/g, '<ul>')
        .replace(/<\/ul><\/p>/g, '</ul>');
}

/**
 * Add loading message
 */
function addLoadingMessage() {
    const messagesContainer = document.getElementById('aiMessages');
    const id = 'loading-' + Date.now();

    const loadingDiv = document.createElement('div');
    loadingDiv.id = id;
    loadingDiv.className = 'ai-message assistant loading';
    loadingDiv.innerHTML = `
        <div class="ai-message-content">
            <div class="ai-typing">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;

    messagesContainer?.appendChild(loadingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    return id;
}

/**
 * Remove loading message
 */
function removeLoadingMessage(id) {
    document.getElementById(id)?.remove();
}

/**
 * Get current search context
 */
function getCurrentContext() {
    // Access app state if available
    const appState = window.protocolApp?.state;

    return {
        query: appState?.currentQuery || '',
        bodyRegion: appState?.filters?.bodyRegion || null,
        resultCount: appState?.currentResults?.totalCount || 0
    };
}

/**
 * Extract search suggestions from AI response
 */
function suggestSearchTerms(content) {
    // Look for quoted terms or specific patterns
    const searchTerms = [];

    // Find quoted phrases
    const quotes = content.match(/"([^"]+)"/g);
    if (quotes) {
        quotes.forEach(q => {
            const term = q.replace(/"/g, '');
            if (term.length > 2 && term.length < 50) {
                searchTerms.push(term);
            }
        });
    }

    // If we found terms, add suggestion chips
    if (searchTerms.length > 0) {
        addSearchSuggestions(searchTerms.slice(0, 3));
    }
}

/**
 * Add clickable search suggestions
 */
function addSearchSuggestions(terms) {
    const messagesContainer = document.getElementById('aiMessages');

    const suggestDiv = document.createElement('div');
    suggestDiv.className = 'ai-suggestions';
    suggestDiv.innerHTML = `
        <span class="suggest-label">Search suggestions:</span>
        ${terms.map(t => `<button class="suggest-chip" data-term="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}
    `;

    // Add click handlers
    suggestDiv.querySelectorAll('.suggest-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const term = chip.dataset.term;
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = term;
                searchInput.dispatchEvent(new Event('input'));
                document.getElementById('ai-panel')?.classList.remove('open');
            }
        });
    });

    messagesContainer?.appendChild(suggestDiv);
}

/**
 * Clear conversation
 */
export function clearConversation() {
    conversationHistory = [];
    const messagesContainer = document.getElementById('aiMessages');
    if (messagesContainer) {
        messagesContainer.innerHTML = `
            <div class="ai-message assistant">
                <div class="ai-message-content">
                    <p>Conversation cleared. How can I help you?</p>
                </div>
            </div>
        `;
    }
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
