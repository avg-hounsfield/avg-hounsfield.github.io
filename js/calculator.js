// Calculator functionality
class Calculator {
  constructor() {
    this.display = document.getElementById('calculator-screen');
    this.currentInput = '0';
    this.operator = null;
    this.previousInput = null;
    this.waitingForOperand = false;
    
    this.bindEvents();
  }
  
  bindEvents() {
    const calculatorToggle = document.getElementById('calculator-toggle');
    const calculatorSidebar = document.getElementById('calculator-sidebar');
    const calculatorButtons = document.querySelector('.calculator-buttons');
    
    // Toggle calculator sidebar
    calculatorToggle.addEventListener('click', () => {
      calculatorSidebar.classList.toggle('open');
    });
    
    // Close calculator when clicking outside
    document.addEventListener('click', (e) => {
      if (!calculatorSidebar.contains(e.target) && !calculatorToggle.contains(e.target)) {
        calculatorSidebar.classList.remove('open');
      }
    });
    
    // Handle calculator button clicks
    calculatorButtons.addEventListener('click', (e) => {
      if (e.target.classList.contains('calc-btn')) {
        this.handleButtonClick(e.target);
      }
    });
    
    // Handle keyboard input
    document.addEventListener('keydown', (e) => {
      if (calculatorSidebar.classList.contains('open')) {
        this.handleKeyboard(e);
      }
    });
  }
  
  handleButtonClick(button) {
    const { action, value } = button.dataset;
    
    if (value) {
      this.inputDigit(value);
    } else if (action) {
      this.performAction(action);
    }
    
    this.updateDisplay();
  }
  
  handleKeyboard(e) {
    const key = e.key;
    
    if (key >= '0' && key <= '9' || key === '.') {
      e.preventDefault();
      this.inputDigit(key);
    } else if (key === '+') {
      e.preventDefault();
      this.performAction('add');
    } else if (key === '-') {
      e.preventDefault();
      this.performAction('subtract');
    } else if (key === '*') {
      e.preventDefault();
      this.performAction('multiply');
    } else if (key === '/') {
      e.preventDefault();
      this.performAction('divide');
    } else if (key === 'Enter' || key === '=') {
      e.preventDefault();
      this.performAction('equals');
    } else if (key === 'Escape') {
      e.preventDefault();
      this.performAction('clear');
    } else if (key === 'Backspace') {
      e.preventDefault();
      this.performAction('backspace');
    }
    
    this.updateDisplay();
  }
  
  inputDigit(digit) {
    if (this.waitingForOperand) {
      this.currentInput = digit;
      this.waitingForOperand = false;
    } else {
      if (digit === '.' && this.currentInput.includes('.')) {
        return; // Don't allow multiple decimal points
      }
      this.currentInput = this.currentInput === '0' ? digit : this.currentInput + digit;
    }
  }
  
  performAction(action) {
    const inputValue = parseFloat(this.currentInput);
    
    switch (action) {
      case 'clear':
        this.currentInput = '0';
        this.operator = null;
        this.previousInput = null;
        this.waitingForOperand = false;
        break;
        
      case 'clearEntry':
        this.currentInput = '0';
        break;
        
      case 'backspace':
        if (this.currentInput.length > 1) {
          this.currentInput = this.currentInput.slice(0, -1);
        } else {
          this.currentInput = '0';
        }
        break;
        
      case 'equals':
        if (this.operator && this.previousInput !== null && !this.waitingForOperand) {
          this.currentInput = String(this.calculate(this.previousInput, inputValue, this.operator));
          this.operator = null;
          this.previousInput = null;
          this.waitingForOperand = true;
        }
        break;
        
      case 'add':
      case 'subtract':
      case 'multiply':
      case 'divide':
        if (this.previousInput === null) {
          this.previousInput = inputValue;
        } else if (this.operator && !this.waitingForOperand) {
          const result = this.calculate(this.previousInput, inputValue, this.operator);
          this.currentInput = String(result);
          this.previousInput = result;
        }
        
        this.waitingForOperand = true;
        this.operator = action;
        break;
    }
  }
  
  calculate(firstOperand, secondOperand, operator) {
    switch (operator) {
      case 'add':
        return firstOperand + secondOperand;
      case 'subtract':
        return firstOperand - secondOperand;
      case 'multiply':
        return firstOperand * secondOperand;
      case 'divide':
        return secondOperand !== 0 ? firstOperand / secondOperand : 0;
      default:
        return secondOperand;
    }
  }
  
  updateDisplay() {
    // Format the display value
    let displayValue = this.currentInput;
    
    // Handle very long numbers
    if (displayValue.length > 12) {
      const num = parseFloat(displayValue);
      if (Math.abs(num) >= 1e12 || (Math.abs(num) < 1e-6 && num !== 0)) {
        displayValue = num.toExponential(6);
      } else {
        displayValue = num.toPrecision(12).replace(/\.?0+$/, '');
      }
    }
    
    this.display.value = displayValue;
  }
}

// Initialize calculator when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new Calculator();
});