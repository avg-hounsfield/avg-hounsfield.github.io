document.addEventListener('DOMContentLoaded', () => {
  // --- ELEMENTS ---
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  const body = document.body;
  const themeMeta = document.getElementById('theme-color-meta');

  // --- CONSTANTS ---
  // These colors match your Material 3 theme's background colors
  const lightThemeColor = '#FFFbff'; // --md-ref-palette-neutral99
  const darkThemeColor = '#1D1B20';  // --md-ref-palette-neutral10

  // --- CORE FUNCTIONS ---

  /**
   * Applies the selected theme to the document.
   * This is the central function for all theme changes.
   * @param {string} theme - The theme to apply ('light' or 'dark').
   */
  function applyTheme(theme) {
    // 1. Set the data-theme attribute on the body
    body.setAttribute('data-theme', theme);

    // 2. Update the theme toggle icon and title
    if (theme === 'dark') {
      themeIcon.textContent = 'light_mode';
      themeToggle.title = 'Switch to light mode';
    } else {
      themeIcon.textContent = 'dark_mode';
      themeToggle.title = 'Switch to dark mode';
    }
    
    // 3. Update the browser's UI color (for mobile address bars)
    themeMeta.setAttribute('content', theme === 'dark' ? darkThemeColor : lightThemeColor);

    // 4. Save the user's preference to local storage
    localStorage.setItem('theme', theme);
  }

  /**
   * Detects the user's OS-level theme preference.
   * @returns {string} 'light' or 'dark'
   */
  function getSystemTheme() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  // --- EVENT LISTENERS ---

  // 1. Listen for clicks on the theme toggle button
  themeToggle.addEventListener('click', () => {
    // Add a class for a brief transition animation
    document.documentElement.classList.add('theme-in-transition');
    
    const currentTheme = body.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    applyTheme(newTheme);
    showThemeChangeNotification(newTheme);

    // Remove the transition class after the animation completes
    window.setTimeout(() => {
      document.documentElement.classList.remove('theme-in-transition');
    }, 500);
  });

  // 2. Listen for changes in the user's system theme preference
  if (window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', (e) => {
      // Only auto-switch if the user hasn't already set a manual preference
      if (!localStorage.getItem('theme')) {
        const systemTheme = e.matches ? 'dark' : 'light';
        applyTheme(systemTheme);
      }
    });
  }

  // 3. Listen for a keyboard shortcut (Ctrl/Cmd + Shift + T)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      themeToggle.click();
    }
  });


  // --- INITIALIZATION ---
  // On page load, apply the saved theme or fall back to the system preference.
  const initialTheme = localStorage.getItem('theme') || getSystemTheme();
  applyTheme(initialTheme);
});


// --- UX ENHANCEMENT ---

/**
 * Shows a temporary notification when the theme is changed.
 * @param {string} theme - The new theme name ('light' or 'dark').
 */
function showThemeChangeNotification(theme) {
  const notification = document.createElement('div');
  notification.textContent = `Switched to ${theme} mode`;
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--md-sys-color-inverse-surface);
    color: var(--md-sys-color-inverse-on-surface);
    padding: 10px 20px;
    border-radius: 28px;
    font-size: 0.9em;
    font-weight: 500;
    z-index: 2000;
    opacity: 0;
    transition: opacity 0.3s ease, transform 0.3s ease;
    pointer-events: none;
    box-shadow: var(--shadow-floating);
  `;
  
  document.body.appendChild(notification);
  
  // Animate in
  requestAnimationFrame(() => {
    notification.style.opacity = '1';
    notification.style.transform = 'translateX(-50%) translateY(-10px)';
  });
  
  // Animate out and remove after 2 seconds
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(-50%)';
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 2000);
}