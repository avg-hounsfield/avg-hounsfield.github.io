class BetaAcknowledgment {
    constructor() {
        this.modal = document.getElementById('beta-acknowledgment-modal');
        this.betaCheckbox = document.getElementById('beta-testing-ack');
        this.educationalCheckbox = document.getElementById('educational-use-ack');
        this.storageKey = 'beta-acknowledgment-accepted';
        
        this.init();
    }
    
    init() {
        if (!this.hasUserAccepted()) {
            this.showModal();
        }
        
        this.betaCheckbox.addEventListener('change', () => this.checkBothAcknowledgments());
        this.educationalCheckbox.addEventListener('change', () => this.checkBothAcknowledgments());
    }
    
    hasUserAccepted() {
        return localStorage.getItem(this.storageKey) === 'true';
    }
    
    showModal() {
        this.modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
    
    hideModal() {
        this.modal.style.display = 'none';
        document.body.style.overflow = '';
        localStorage.setItem(this.storageKey, 'true');
    }
    
    checkBothAcknowledgments() {
        if (this.betaCheckbox.checked && this.educationalCheckbox.checked) {
            setTimeout(() => {
                this.hideModal();
            }, 300);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new BetaAcknowledgment();
});