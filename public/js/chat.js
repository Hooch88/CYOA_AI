class AIRPGChat {
    constructor() {
        this.chatLog = document.getElementById('chatLog');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        
        this.chatHistory = [
            {
                role: "system",
                content: window.systemPrompt || "You are a creative and engaging AI Game Master for a text-based RPG. Create immersive adventures, memorable characters, and respond to player actions with creativity and detail. Keep responses engaging but concise."
            }
        ];
        
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.messageInput.focus();
    }
    
    bindEvents() {
        this.sendButton.addEventListener('click', () => this.sendMessage());
        
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Auto-resize textarea
        this.messageInput.addEventListener('input', () => {
            this.messageInput.style.height = 'auto';
            this.messageInput.style.height = this.messageInput.scrollHeight + 'px';
        });
    }
    
    addMessage(sender, content, isError = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender === 'user' ? 'user-message' : 'ai-message'}${isError ? ' error' : ''}`;
        
        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = sender === 'user' ? '👤 You' : '🤖 AI Game Master';
        
        const contentDiv = document.createElement('div');
        contentDiv.textContent = content;
        
        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        this.chatLog.appendChild(messageDiv);
        
        this.scrollToBottom();
    }
    
    showLoading() {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'message ai-message loading';
        loadingDiv.id = 'loading-message';
        
        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '🤖 AI Game Master';
        
        const contentDiv = document.createElement('div');
        contentDiv.textContent = 'Thinking...';
        
        loadingDiv.appendChild(senderDiv);
        loadingDiv.appendChild(contentDiv);
        this.chatLog.appendChild(loadingDiv);
        
        this.scrollToBottom();
    }
    
    hideLoading() {
        const loadingMessage = document.getElementById('loading-message');
        if (loadingMessage) {
            loadingMessage.remove();
        }
    }
    
    scrollToBottom() {
        this.chatLog.scrollTop = this.chatLog.scrollHeight;
    }
    
    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message) return;
        
        this.addMessage('user', message);
        this.chatHistory.push({ role: 'user', content: message });
        
        this.messageInput.value = '';
        this.sendButton.disabled = true;
        this.showLoading();
        
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: this.chatHistory
                })
            });
            
            const data = await response.json();
            this.hideLoading();
            
            if (data.error) {
                this.addMessage('system', `Error: ${data.error}`, true);
            } else {
                this.addMessage('ai', data.response);
                this.chatHistory.push({ role: 'assistant', content: data.response });
            }
        } catch (error) {
            this.hideLoading();
            this.addMessage('system', `Connection error: ${error.message}`, true);
        }
        
        this.sendButton.disabled = false;
        this.messageInput.focus();
    }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AIRPGChat();
});
