document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  const body = document.body;

  // Check system preference
  function getSystemTheme() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark';
  }

  // Function to apply theme with animation
  function applyTheme(theme) {
    // Add transition class for smooth theme change
    body.classList.add('theme-transition');
    
    if (theme === 'light') {
      body.classList.add('light-theme');
      body.classList.remove('dark-theme');
      themeIcon.textContent = 'dark_mode';
      themeToggle.title = 'Switch to dark mode';
    } else {
      body.classList.remove('light-theme');
      body.classList.add('dark-theme');
      themeIcon.textContent = 'light_mode';
      themeToggle.title = 'Switch to light mode';
    }
    
    // Remove transition class after animation
    setTimeout(() => {
      body.classList.remove('theme-transition');
    }, 300);
  }

  // Enhanced toggle with better feedback
  themeToggle.addEventListener('click', () => {
    if (!body) return;
    
    const isLight = body.classList.contains('light-theme');
    const newTheme = isLight ? 'dark' : 'light';
    
    // Add click animation
    themeToggle.style.transform = 'scale(0.95)';
    setTimeout(() => {
      themeToggle.style.transform = '';
    }, 150);
    
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    
    // Show theme change feedback
    showThemeChangeNotification(newTheme);
  });

  // Show theme change notification
  function showThemeChangeNotification(theme) {
    const notification = document.createElement('div');
    notification.textContent = `Switched to ${theme} mode`;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--interactive-accent);
      color: var(--interactive-accent-text);
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 0.9em;
      font-weight: 500;
      z-index: 2000;
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
    `;
    
    document.body.appendChild(notification);
    
    // Animate in
    requestAnimationFrame(() => {
      notification.style.opacity = '1';
    });
    
    // Remove after 2 seconds
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 2000);
  }

  // Listen for system theme changes
  if (window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    mediaQuery.addEventListener('change', (e) => {
      // Only auto-switch if user hasn't manually set a preference
      if (!localStorage.getItem('theme')) {
        const systemTheme = e.matches ? 'light' : 'dark';
        applyTheme(systemTheme);
      }
    });
  }

  // Keyboard shortcut for theme toggle (Ctrl+Shift+T)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      themeToggle.click();
    }
  });

  // Load saved theme or use system preference
  const savedTheme = localStorage.getItem('theme') || getSystemTheme();
  applyTheme(savedTheme);
});