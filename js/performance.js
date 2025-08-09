// js/performance.js - Performance monitoring utilities

export class PerformanceMonitor {
  static measurements = new Map();
  
  static start(label) {
    this.measurements.set(label, performance.now());
  }
  
  static end(label) {
    const startTime = this.measurements.get(label);
    if (startTime) {
      const duration = performance.now() - startTime;
      console.log(`${label}: ${duration.toFixed(2)}ms`);
      this.measurements.delete(label);
      return duration;
    }
    return 0;
  }
  
  static measure(label, fn) {
    this.start(label);
    const result = fn();
    this.end(label);
    return result;
  }
  
  static async measureAsync(label, fn) {
    this.start(label);
    const result = await fn();
    this.end(label);
    return result;
  }
  
  static logWebVitals() {
    // Log Core Web Vitals if available
    if ('web-vitals' in window) {
      import('https://unpkg.com/web-vitals@3/dist/web-vitals.js').then(({ onCLS, onFID, onFCP, onLCP, onTTFB }) => {
        onCLS(console.log);
        onFID(console.log);
        onFCP(console.log);
        onLCP(console.log);
        onTTFB(console.log);
      });
    }
  }
}
