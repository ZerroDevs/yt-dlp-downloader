// Shared Modal System
// Provides a unified way to create and manage modals across the application

class Modal {
    constructor(options = {}) {
        this.id = options.id || 'modal-' + Date.now();
        this.title = options.title || '';
        this.content = options.content || '';
        this.onConfirm = options.onConfirm || null;
        this.onCancel = options.onCancel || null;
        this.confirmText = options.confirmText || 'Confirm';
        this.cancelText = options.cancelText || 'Cancel';
        this.showConfirm = options.showConfirm !== false;
        this.showCancel = options.showCancel !== false;
        this.danger = options.danger || false;
        this.size = options.size || 'medium'; // small, medium, large
        this.element = null;
    }

    create() {
        // Remove existing modal with same ID
        const existing = document.getElementById(this.id);
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = this.id;
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content modal-${this.size}">
                <div class="modal-header">
                    <h3>${this.title}</h3>
                    <button class="modal-close" data-action="close">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="modal-body">
                    ${this.content}
                </div>
                ${this.showConfirm || this.showCancel ? `
                <div class="modal-footer">
                    ${this.showCancel ? `<button class="btn-secondary" data-action="cancel">${this.cancelText}</button>` : ''}
                    ${this.showConfirm ? `<button class="btn-${this.danger ? 'danger' : 'primary'}" data-action="confirm">${this.confirmText}</button>` : ''}
                </div>
                ` : ''}
            </div>
        `;

        document.body.appendChild(modal);
        this.element = modal;

        // Add event listeners
        this.attachListeners();

        return this;
    }

    attachListeners() {
        const overlay = this.element.querySelector('.modal-overlay');
        const closeBtn = this.element.querySelector('.modal-close');
        const confirmBtn = this.element.querySelector('[data-action="confirm"]');
        const cancelBtn = this.element.querySelector('[data-action="cancel"]');

        // Close on overlay click
        overlay.addEventListener('click', () => this.close());

        // Close on X button
        closeBtn.addEventListener('click', () => this.close());

        // Confirm button
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                if (this.onConfirm) {
                    this.onConfirm();
                }
                this.close();
            });
        }

        // Cancel button
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                if (this.onCancel) {
                    this.onCancel();
                }
                this.close();
            });
        }

        // Close on Escape key
        this.escapeHandler = (e) => {
            if (e.key === 'Escape') {
                this.close();
            }
        };
        document.addEventListener('keydown', this.escapeHandler);
    }

    show() {
        if (!this.element) {
            this.create();
        }
        this.element.classList.remove('hidden');
        return this;
    }

    close() {
        if (this.element) {
            this.element.classList.add('hidden');
        }
        document.removeEventListener('keydown', this.escapeHandler);
        if (this.onCancel) {
            this.onCancel();
        }
        return this;
    }

    setContent(content) {
        this.content = content;
        const body = this.element.querySelector('.modal-body');
        if (body) {
            body.innerHTML = content;
        }
        return this;
    }

    destroy() {
        if (this.element) {
            this.element.remove();
        }
        document.removeEventListener('keydown', this.escapeHandler);
        return this;
    }
}

// Convenience functions for common modal types

// Alert modal (single button)
function alertModal(title, content, buttonText = 'OK') {
    const modal = new Modal({
        title,
        content,
        confirmText: buttonText,
        showCancel: false
    });
    modal.create().show();
    return modal;
}

// Confirm modal (yes/no)
function confirmModal(title, content, onConfirm, onCancel = null) {
    const modal = new Modal({
        title,
        content,
        onConfirm,
        onCancel,
        confirmText: 'Confirm',
        cancelText: 'Cancel'
    });
    modal.create().show();
    return modal;
}

// Danger confirm modal (red confirm button)
function dangerModal(title, content, onConfirm, onCancel = null) {
    const modal = new Modal({
        title,
        content,
        onConfirm,
        onCancel,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true
    });
    modal.create().show();
    return modal;
}

// Input modal (with input field)
function inputModal(title, placeholder, onConfirm, defaultValue = '', inputType = 'text') {
    const content = `
        <input type="${inputType}" id="modalInput" class="url-input" style="width: 100%;" placeholder="${placeholder}" value="${defaultValue}">
    `;
    
    const modal = new Modal({
        title,
        content,
        onConfirm: () => {
            const input = document.getElementById('modalInput');
            if (input && onConfirm) {
                onConfirm(input.value);
            }
        },
        onCancel: () => {
            if (onCancel) onCancel();
        }
    });
    modal.create().show();
    
    // Focus input
    setTimeout(() => {
        const input = document.getElementById('modalInput');
        if (input) input.focus();
    }, 100);
    
    return modal;
}

// Custom modal with full control
function customModal(options) {
    const modal = new Modal(options);
    modal.create().show();
    return modal;
}

// Initialize existing static modals to use the overlay click behavior
function initializeExistingModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        const overlay = modal.querySelector('.modal-overlay');
        const closeBtn = modal.querySelector('.modal-close');
        
        if (overlay) {
            overlay.addEventListener('click', () => {
                modal.classList.add('hidden');
            });
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.classList.add('hidden');
            });
        }
    });
}

// Auto-initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExistingModals);
} else {
    initializeExistingModals();
}
