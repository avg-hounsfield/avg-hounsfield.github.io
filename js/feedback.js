// js/feedback.js - Feedback widget functionality

let feedbackOpen = false;

// Initialize feedback widget
export function initFeedback() {
  setupFeedbackEvents();
}

// Setup feedback event listeners
function setupFeedbackEvents() {
  const trigger = document.getElementById('feedback-trigger');
  const close = document.getElementById('feedback-close');
  const form = document.getElementById('feedback-form');
  
  if (trigger) {
    trigger.addEventListener('click', toggleFeedbackWidget);
  }
  
  if (close) {
    close.addEventListener('click', closeFeedbackWidget);
  }
  
  if (form) {
    form.addEventListener('submit', handleFeedbackSubmit);
  }
  
  // Close feedback when clicking outside
  document.addEventListener('click', (e) => {
    const widget = document.getElementById('feedback-widget');
    if (feedbackOpen && widget && !widget.contains(e.target)) {
      closeFeedbackWidget();
    }
  });
  
  // Close feedback on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && feedbackOpen) {
      closeFeedbackWidget();
    }
  });
}

// Toggle feedback widget
function toggleFeedbackWidget() {
  if (feedbackOpen) {
    closeFeedbackWidget();
  } else {
    openFeedbackWidget();
  }
}

// Open feedback widget
function openFeedbackWidget() {
  const panel = document.getElementById('feedback-panel');
  const form = document.getElementById('feedback-form');
  const success = document.getElementById('feedback-success');
  
  if (panel) {
    panel.classList.add('open');
    feedbackOpen = true;
    
    // Reset form and show form (hide success)
    if (form) form.style.display = 'flex';
    if (success) success.style.display = 'none';
    
    // Focus on the feedback type select
    const typeSelect = document.getElementById('feedback-type');
    if (typeSelect) {
      setTimeout(() => typeSelect.focus(), 300);
    }
  }
}

// Close feedback widget
window.closeFeedbackWidget = function() {
  const panel = document.getElementById('feedback-panel');
  if (panel) {
    panel.classList.remove('open');
    feedbackOpen = false;
    
    // Reset form after closing
    setTimeout(resetFeedbackForm, 300);
  }
};

// Reset feedback form
function resetFeedbackForm() {
  const form = document.getElementById('feedback-form');
  const typeSelect = document.getElementById('feedback-type');
  const textarea = document.getElementById('feedback-text');
  
  if (typeSelect) typeSelect.value = '';
  if (textarea) textarea.value = '';
  if (form) form.style.display = 'flex';
  
  const success = document.getElementById('feedback-success');
  if (success) success.style.display = 'none';
}

// Handle feedback form submission
function handleFeedbackSubmit(e) {
  e.preventDefault();
  
  const typeSelect = document.getElementById('feedback-type');
  const textarea = document.getElementById('feedback-text');
  const submitBtn = document.querySelector('.feedback-submit');
  
  if (!typeSelect.value || !textarea.value.trim()) {
    showFeedbackError('Please fill in all required fields.');
    return;
  }
  
  // Disable submit button and show loading
  if (submitBtn) {
    submitBtn.textContent = 'Sending...';
    submitBtn.disabled = true;
  }
  
  // Simulate sending feedback (in real app, this would be an API call)
  const feedbackData = {
    type: typeSelect.value,
    message: textarea.value.trim(),
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    url: window.location.href
  };
  
  // Store feedback locally for demonstration
  storeFeedbackLocally(feedbackData);
  
  // Simulate network delay
  setTimeout(() => {
    showFeedbackSuccess();
    
    // Auto-close after success
    setTimeout(() => {
      closeFeedbackWidget();
    }, 3000);
  }, 1000);
}

// Store feedback with cross-browser compatibility
function storeFeedbackLocally(feedbackData) {
  try {
    // Import storage dynamically to avoid circular dependencies
    import('./storage.js').then(({ storage }) => {
      const existingFeedback = storage.get('mri-protocol-feedback', []);
      existingFeedback.push(feedbackData);
      
      // Keep only last 50 feedback items
      if (existingFeedback.length > 50) {
        existingFeedback.splice(0, existingFeedback.length - 50);
      }
      
      storage.set('mri-protocol-feedback', existingFeedback);
      console.log('Feedback stored:', feedbackData);
    });
  } catch (error) {
    console.error('Error storing feedback:', error);
  }
}

// Show feedback success state
function showFeedbackSuccess() {
  const form = document.getElementById('feedback-form');
  const success = document.getElementById('feedback-success');
  const submitBtn = document.querySelector('.feedback-submit');
  
  if (form) form.style.display = 'none';
  if (success) success.style.display = 'block';
  
  // Reset submit button
  if (submitBtn) {
    submitBtn.textContent = 'Send Feedback';
    submitBtn.disabled = false;
  }
}

// Show feedback error
function showFeedbackError(message) {
  // Create or update error message
  let errorDiv = document.querySelector('.feedback-error');
  
  if (!errorDiv) {
    errorDiv = document.createElement('div');
    errorDiv.className = 'feedback-error';
    errorDiv.style.cssText = `
      background: rgba(231, 76, 60, 0.1);
      color: #e74c3c;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 0.9em;
      margin-bottom: 12px;
      border: 1px solid rgba(231, 76, 60, 0.3);
    `;
    
    const form = document.getElementById('feedback-form');
    if (form) {
      form.insertBefore(errorDiv, form.firstChild);
    }
  }
  
  errorDiv.textContent = message;
  
  // Remove error after 5 seconds
  setTimeout(() => {
    if (errorDiv.parentNode) {
      errorDiv.parentNode.removeChild(errorDiv);
    }
  }, 5000);
}

// Get stored feedback (for debugging/admin purposes)
window.getFeedbackData = function() {
  try {
    import('./storage.js').then(({ storage }) => {
      const feedback = storage.get('mri-protocol-feedback', []);
      console.log('Stored feedback:', feedback);
      return feedback;
    });
  } catch (error) {
    console.error('Error retrieving feedback:', error);
    return [];
  }
};

// Clear stored feedback (for debugging/admin purposes)
window.clearFeedbackData = function() {
  try {
    import('./storage.js').then(({ storage }) => {
      storage.remove('mri-protocol-feedback');
      console.log('Feedback data cleared');
    });
  } catch (error) {
    console.error('Error clearing feedback:', error);
  }
};