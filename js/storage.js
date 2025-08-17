// js/storage.js - Cross-browser storage compatibility layer

/**
 * Cross-browser storage utility that handles localStorage limitations
 * in Firefox private mode, Safari private mode, and other restrictive environments
 */

class StorageManager {
  constructor() {
    this.storage = null;
    this.fallbackStorage = new Map();
    this.isLocalStorageAvailable = false;
    this.isSessionStorageAvailable = false;
    this.init();
  }

  init() {
    // Test localStorage availability
    this.isLocalStorageAvailable = this.testStorage('localStorage');
    this.isSessionStorageAvailable = this.testStorage('sessionStorage');
    
    // Choose best available storage
    if (this.isLocalStorageAvailable) {
      this.storage = window.localStorage;
      console.log('Storage: Using localStorage');
    } else if (this.isSessionStorageAvailable) {
      this.storage = window.sessionStorage;
      console.log('Storage: Using sessionStorage (data will not persist between sessions)');
    } else {
      this.storage = null;
      console.warn('Storage: Using in-memory fallback (data will not persist)');
    }
  }

  testStorage(storageType) {
    try {
      const storage = window[storageType];
      const testKey = '__storage_test__';
      storage.setItem(testKey, 'test');
      storage.removeItem(testKey);
      return true;
    } catch (e) {
      // Firefox private mode, Safari private mode, or storage quota exceeded
      console.warn(`${storageType} is not available:`, e.message);
      return false;
    }
  }

  // Set item with fallback
  setItem(key, value) {
    try {
      if (this.storage) {
        this.storage.setItem(key, value);
        return true;
      } else {
        // Fallback to in-memory storage
        this.fallbackStorage.set(key, value);
        return false; // Indicate that persistence is not available
      }
    } catch (e) {
      console.warn(`Failed to set ${key}:`, e.message);
      // Fallback to in-memory storage
      this.fallbackStorage.set(key, value);
      return false;
    }
  }

  // Get item with fallback
  getItem(key) {
    try {
      if (this.storage) {
        return this.storage.getItem(key);
      } else {
        return this.fallbackStorage.get(key) || null;
      }
    } catch (e) {
      console.warn(`Failed to get ${key}:`, e.message);
      return this.fallbackStorage.get(key) || null;
    }
  }

  // Remove item with fallback
  removeItem(key) {
    try {
      if (this.storage) {
        this.storage.removeItem(key);
      } else {
        this.fallbackStorage.delete(key);
      }
    } catch (e) {
      console.warn(`Failed to remove ${key}:`, e.message);
      this.fallbackStorage.delete(key);
    }
  }

  // Clear all items
  clear() {
    try {
      if (this.storage) {
        // Only clear our app's keys, not all localStorage
        const keysToRemove = [];
        for (let i = 0; i < this.storage.length; i++) {
          const key = this.storage.key(i);
          if (key && key.startsWith('mri-protocol-')) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(key => this.storage.removeItem(key));
      } else {
        this.fallbackStorage.clear();
      }
    } catch (e) {
      console.warn('Failed to clear storage:', e.message);
      this.fallbackStorage.clear();
    }
  }

  // Get storage info for user feedback
  getStorageInfo() {
    return {
      type: this.isLocalStorageAvailable ? 'localStorage' : 
            this.isSessionStorageAvailable ? 'sessionStorage' : 'memory',
      persistent: this.isLocalStorageAvailable,
      available: this.isLocalStorageAvailable || this.isSessionStorageAvailable
    };
  }

  // Show storage limitation warning to user
  showStorageWarning() {
    const info = this.getStorageInfo();
    
    if (!info.persistent) {
      const message = info.type === 'sessionStorage' ? 
        'Note: Your favorites and recent protocols will only be saved for this session due to browser privacy settings.' :
        'Note: Your favorites and recent protocols cannot be saved due to browser privacy settings.';
      
      this.showUserNotification(message, 'warning');
    }
  }

  // Show user notification
  showUserNotification(message, type = 'info') {
    // Remove any existing storage notifications
    const existing = document.querySelector('.storage-notification');
    if (existing) existing.remove();
    
    const notification = document.createElement('div');
    notification.className = 'storage-notification';
    notification.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="material-symbols-outlined">${type === 'warning' ? 'warning' : 'info'}</span>
        <span>${message}</span>
        <button onclick="this.parentElement.parentElement.remove()" style="margin-left: auto; background: none; border: none; color: inherit; cursor: pointer; padding: 4px;">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    `;
    
    notification.style.cssText = `
      position: fixed;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: ${type === 'warning' ? 'rgba(255, 193, 7, 0.9)' : 'rgba(64, 180, 166, 0.9)'};
      color: ${type === 'warning' ? '#856404' : '#ffffff'};
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 0.9em;
      font-weight: 500;
      z-index: 2000;
      max-width: 90%;
      width: auto;
      min-width: 300px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-family: 'Jost', sans-serif;
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 8 seconds for warnings, 5 seconds for info
    setTimeout(() => {
      if (notification.parentNode) {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(-50%) translateY(-10px)';
        setTimeout(() => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
        }, 300);
      }
    }, type === 'warning' ? 8000 : 5000);
  }
}

// Create global storage manager instance
const storageManager = new StorageManager();

// Enhanced storage functions with better error handling
export const storage = {
  // Set item with user feedback on failure
  set(key, value) {
    const success = storageManager.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    if (!success && !storageManager._warningShown) {
      storageManager.showStorageWarning();
      storageManager._warningShown = true;
    }
    return success;
  },

  // Get item with JSON parsing
  get(key, defaultValue = null) {
    try {
      const value = storageManager.getItem(key);
      if (value === null) return defaultValue;
      
      // Try to parse as JSON, fallback to string
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (e) {
      console.warn(`Failed to get ${key}:`, e.message);
      return defaultValue;
    }
  },

  // Remove item
  remove(key) {
    storageManager.removeItem(key);
  },

  // Clear all app data
  clear() {
    storageManager.clear();
  },

  // Get storage information
  getInfo() {
    return storageManager.getStorageInfo();
  },

  // Check if storage is available
  isAvailable() {
    return storageManager.getStorageInfo().available;
  },

  // Check if storage is persistent
  isPersistent() {
    return storageManager.getStorageInfo().persistent;
  }
};

// Browser detection utilities
export const browser = {
  // Detect Firefox
  isFirefox() {
    return navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
  },

  // Detect Safari
  isSafari() {
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  },

  // Detect Chrome
  isChrome() {
    return /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
  },

  // Detect Edge
  isEdge() {
    return /Edge/.test(navigator.userAgent);
  },

  // Detect Internet Explorer
  isIE() {
    return /MSIE|Trident/.test(navigator.userAgent);
  },

  // Detect if in private/incognito mode
  isPrivateMode() {
    return !storageManager.isLocalStorageAvailable && 
           storageManager.isSessionStorageAvailable;
  },

  // Get browser name
  getName() {
    if (this.isFirefox()) return 'Firefox';
    if (this.isSafari()) return 'Safari';
    if (this.isChrome()) return 'Chrome';
    if (this.isEdge()) return 'Edge';
    if (this.isIE()) return 'Internet Explorer';
    return 'Unknown';
  }
};

// Initialize storage and show warnings if needed
document.addEventListener('DOMContentLoaded', () => {
  // Show storage info in console
  const info = storage.getInfo();
  console.log('Browser storage info:', {
    browser: browser.getName(),
    storageType: info.type,
    persistent: info.persistent,
    privateMode: browser.isPrivateMode()
  });
  
  // Show warning for limited storage after a delay
  setTimeout(() => {
    if (!info.persistent) {
      storageManager.showStorageWarning();
    }
  }, 2000);
});