class AIRPGChat {
    constructor() {
        this.chatLog = document.getElementById('chatLog');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        this.skillPointsDisplay = document.getElementById('unspentSkillPointsDisplay');
        this.skillRankElements = this.collectSkillRankElements();

        // Start with system prompt for AI context
        this.chatHistory = [
            {
                role: "system",
                content: window.systemPrompt || "You are a creative and engaging AI Game Master for a text-based RPG. Create immersive adventures, memorable characters, and respond to player actions with creativity and detail. Keep responses engaging but concise."
            }
        ];

        // Load any existing chat history for AI context
        this.loadExistingHistory();

        this.init();
        this.initSkillIncreaseControls();

        this.locationRefreshTimers = [];
        this.locationRefreshPending = false;
    }

    async loadExistingHistory() {
        try {
            const response = await fetch('/api/chat/history');
            const data = await response.json();

            if (data.history && data.history.length > 0) {
                // Add existing messages to chat history for AI context
                // Convert server format to AI API format
                data.history.forEach(msg => {
                    this.chatHistory.push({
                        role: msg.role === 'assistant' ? 'assistant' : 'user',
                        content: msg.content
                    });
                });
            }
        } catch (error) {
            console.log('No existing history to load:', error.message);
        }
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

    addMessage(sender, content, isError = false, debugInfo = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender === 'user' ? 'user-message' : 'ai-message'}${isError ? ' error' : ''}`;

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = sender === 'user' ? '👤 You' : '🤖 AI Game Master';

        const contentDiv = document.createElement('div');
        contentDiv.textContent = content;

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);

        // Add debug information if available (for AI responses)
        if (debugInfo && sender === 'ai') {
            const debugDetails = document.createElement('details');
            debugDetails.className = 'debug-details';

            const debugSummary = document.createElement('summary');
            debugSummary.className = 'debug-summary';
            debugSummary.textContent = '🔍 Debug: View AI Prompt';

            const debugContent = document.createElement('div');
            debugContent.className = 'debug-content';

            if (debugInfo.usedPlayerTemplate) {
                debugContent.innerHTML = `
                    <div class="debug-section">
                        <strong>Player Context:</strong> ${debugInfo.playerName}<br>
                        <em>${debugInfo.playerDescription}</em>
                    </div>
                    <div class="debug-section">
                        <strong>System Prompt Sent to AI:</strong>
                        <pre class="debug-prompt">${this.escapeHtml(debugInfo.systemMessage)}</pre>
                    </div>
                    <div class="debug-section">
                        <strong>Full AI Prompt Sent:</strong>
                        <pre class="debug-prompt">${this.escapeHtml(debugInfo.generationPrompt)}</pre>
                    </div>
                `;
            } else {
                debugContent.innerHTML = `
                    <div class="debug-section">
                        <strong>No Player Template Used</strong><br>
                        Reason: ${debugInfo.reason || debugInfo.error || 'Unknown'}
                    </div>
                `;
            }

            debugDetails.appendChild(debugSummary);
            debugDetails.appendChild(debugContent);
            messageDiv.appendChild(debugDetails);
        }

        messageDiv.appendChild(timestampDiv);
        this.chatLog.appendChild(messageDiv);

        this.scrollToBottom();
    }

    addNpcMessage(npcName, content) {
        if (!content) {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message npc-message ai-message';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = `🤖 NPC · ${npcName || 'Unknown NPC'}`;

        const contentDiv = document.createElement('div');
        contentDiv.textContent = content;

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addEventMessage(contentHtml) {
        if (!contentHtml) {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message event-message';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '📊 Event Checks';

        const contentDiv = document.createElement('div');
        contentDiv.innerHTML = contentHtml;

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addEventSummary(icon, summaryText) {
        if (!summaryText) {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message event-summary';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = `${icon || '📣'} Event`;

        const contentDiv = document.createElement('div');
        contentDiv.textContent = summaryText;

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addEventSummaries(eventData) {
        if (!eventData) {
            return;
        }

        const parsed = eventData.parsed || eventData;
        if (!parsed || typeof parsed !== 'object') {
            return;
        }

        const safeName = (value) => {
            if (!value && value !== 0) return 'Someone';
            const text = String(value).trim();
            if (!text) {
                return 'Someone';
            }
            if (text.toLowerCase() === 'player') {
                return 'You';
            }
            return text;
        };

        const safeItem = (value, fallback = 'an item') => {
            if (!value && value !== 0) return fallback;
            const text = String(value).trim();
            return text || fallback;
        };

        const locationRefreshEventTypes = new Set([
            'item_appear',
            'drop_item',
            'pick_up_item',
            'transfer_item',
            'consume_item',
            'move_location',
            'npc_arrival_departure'
        ]);
        let shouldRefreshLocation = false;

        const handlers = {
            attack_damage: (entries) => {
                entries.forEach((entry) => {
                    const attacker = safeName(entry?.attacker);
                    const target = safeName(entry?.target || 'their target');
                    this.addEventSummary('⚔️', `${attacker} attacked ${target}.`);
                });
            },
            consume_item: (entries) => {
                entries.forEach((entry) => {
                    const user = safeName(entry?.user);
                    const item = safeItem(entry?.item);
                    this.addEventSummary('🧪', `${user} consumed ${item}.`);
                });
            },
            death_incapacitation: (entries) => {
                entries.forEach((name) => {
                    const target = safeName(name);
                    this.addEventSummary('☠️', `${target} was incapacitated.`);
                });
            },
            drop_item: (entries) => {
                entries.forEach((entry) => {
                    const character = safeName(entry?.character);
                    const item = safeItem(entry?.item);
                    this.addEventSummary('📦', `${character} dropped ${item}.`);
                });
            },
            heal_recover: (entries) => {
                entries.forEach((entry) => {
                    const healer = entry?.healer ? safeName(entry.healer) : null;
                    const recipient = safeName(entry?.recipient);
                    const effect = entry?.effect && String(entry.effect).trim();
                    const detail = effect ? ` (${effect})` : '';
                    if (healer) {
                        this.addEventSummary('💖', `${healer} healed ${recipient}${detail}.`);
                    } else {
                        this.addEventSummary('💖', `${recipient} recovered${detail}.`);
                    }
                });
            },
            item_appear: (entries) => {
                entries.forEach((item) => {
                    const itemName = safeItem(item);
                    this.addEventSummary('✨', `${itemName} appeared in the scene.`);
                });
            },
            move_location: (entries) => {
                entries.forEach((location) => {
                    const destination = safeItem(location, 'a new location');
                    this.addEventSummary('🚶', `Travelled to ${destination}.`);
                });
            },
            new_exit_discovered: (entries) => {
                entries.forEach((description) => {
                    const detail = safeItem(description, 'a new path');
                    this.addEventSummary('🚪', `New exit discovered: ${detail}.`);
                });
            },
            npc_arrival_departure: (entries) => {
                entries.forEach((entry) => {
                    const name = safeName(entry?.name);
                    const action = (entry?.action || '').trim().toLowerCase();
                    const destination = entry?.destination || entry?.location;
                    const destinationText = destination ? safeItem(destination, 'another location') : null;
                    if (action === 'arrived') {
                        this.addEventSummary('🙋', `${name} arrived at the location.`);
                    } else if (action === 'left') {
                        const detail = destinationText ? ` for ${destinationText}` : '';
                        this.addEventSummary('🏃', `${name} left the area${detail}.`);
                    } else {
                        this.addEventSummary('📍', `${name} ${entry?.action || 'moved'}.`);
                    }
                });
            },
            party_change: (entries) => {
                entries.forEach((entry) => {
                    const name = safeName(entry?.name);
                    const action = (entry?.action || '').trim().toLowerCase();
                    if (action === 'joined') {
                        this.addEventSummary('🤝', `${name} joined the party.`);
                    } else if (action === 'left') {
                        this.addEventSummary('👋', `${name} left the party.`);
                    } else {
                        this.addEventSummary('📣', `${name} ${entry?.action || 'changed party status'}.`);
                    }
                });
            },
            pick_up_item: (entries) => {
                entries.forEach((entry) => {
                    const actor = safeName(entry?.name);
                    const itemName = safeItem(entry?.item);
                    this.addEventSummary('🎒', `${actor} picked up ${itemName}.`);
                });
            },
            status_effect_change: (entries) => {
                entries.forEach((entry) => {
                    const entity = safeName(entry?.entity);
                    const description = entry?.description ? String(entry.description).trim() : 'a status effect';
                    const action = (entry?.action || '').trim().toLowerCase();
                    if (action === 'gained') {
                        this.addEventSummary('🌀', `${entity} gained ${description}.`);
                    } else if (action === 'lost') {
                        this.addEventSummary('🌀', `${entity} lost ${description}.`);
                    } else {
                        this.addEventSummary('🌀', `${entity} changed status: ${description}.`);
                    }
                });
            },
            transfer_item: (entries) => {
                entries.forEach((entry) => {
                    const giver = safeName(entry?.giver);
                    const item = safeItem(entry?.item);
                    const receiver = safeName(entry?.receiver);
                    this.addEventSummary('🔄', `${giver} gave ${item} to ${receiver}.`);
                });
            }
        };

        Object.entries(parsed).forEach(([eventType, entries]) => {
            if (!entries || (Array.isArray(entries) && entries.length === 0)) {
                return;
            }

            const handler = handlers[eventType];
            if (!handler) {
                return;
            }

            const normalized = Array.isArray(entries) ? entries : [entries];
            handler(normalized);

            if (!shouldRefreshLocation && locationRefreshEventTypes.has(eventType)) {
                shouldRefreshLocation = true;
            }
        });

        if (shouldRefreshLocation) {
            this.scheduleLocationRefresh();
        }
    }

    scheduleLocationRefresh(delays = [0, 400, 1200]) {
        if (!Array.isArray(this.locationRefreshTimers)) {
            this.locationRefreshTimers = [];
        }

        if (this.locationRefreshPending) {
            this.locationRefreshTimers.forEach(timerId => clearTimeout(timerId));
            this.locationRefreshTimers = [];
            this.locationRefreshPending = false;
        }

        const uniqueDelays = Array.from(new Set((Array.isArray(delays) ? delays : [delays])
            .map(value => Number(value))
            .filter(value => Number.isFinite(value) && value >= 0)));

        if (!uniqueDelays.length) {
            uniqueDelays.push(0);
        }

        this.locationRefreshPending = true;
        this.locationRefreshTimers = uniqueDelays.map(delay => {
            const timerId = setTimeout(() => {
                Promise.resolve(this.checkLocationUpdate())
                    .catch(() => { })
                    .finally(() => {
                        this.locationRefreshTimers = this.locationRefreshTimers.filter(id => id !== timerId);
                        if (this.locationRefreshTimers.length === 0) {
                            this.locationRefreshPending = false;
                        }
                    });
            }, delay);
            return timerId;
        });
    }

    addPlausibilityMessage(contentHtml) {
        if (!contentHtml) {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message plausibility-message';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '🧭 Plausibility Check';

        const contentDiv = document.createElement('div');
        contentDiv.innerHTML = contentHtml;

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addSkillCheckMessage(resolution) {
        if (!resolution || typeof resolution !== 'object') {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message skill-check-message';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '🎯 Skill Check';

        const contentDiv = document.createElement('div');

        const lines = [];
        const { roll = {}, difficulty = {}, skill, attribute, label, reason, margin, type } = resolution;

        const formatSigned = (value) => {
            if (typeof value !== 'number' || Number.isNaN(value)) {
                return null;
            }
            return value >= 0 ? `+${value}` : `${value}`;
        };

        if (skill || typeof roll.skillValue === 'number') {
            const parts = [];
            if (skill) {
                parts.push(this.escapeHtml(String(skill)));
            }
            if (typeof roll.skillValue === 'number') {
                const modifier = formatSigned(roll.skillValue);
                parts.push(modifier !== null ? `(${modifier})` : `(${roll.skillValue})`);
            }
            if (parts.length) {
                lines.push(`<li><strong>Skill:</strong> ${parts.join(' ')}</li>`);
            }
        }

        if (attribute || typeof roll.attributeBonus === 'number') {
            const parts = [];
            if (attribute) {
                parts.push(this.escapeHtml(String(attribute)));
            }
            if (typeof roll.attributeBonus === 'number') {
                const modifier = formatSigned(roll.attributeBonus);
                parts.push(modifier !== null ? `(${modifier})` : `(${roll.attributeBonus})`);
            }
            if (parts.length) {
                lines.push(`<li><strong>Attribute:</strong> ${parts.join(' ')}</li>`);
            }
        }

        if (difficulty && (difficulty.label || typeof difficulty.dc === 'number')) {
            const diffParts = [];
            if (difficulty.label) {
                diffParts.push(this.escapeHtml(String(difficulty.label)));
            }
            if (typeof difficulty.dc === 'number') {
                diffParts.push(`(DC ${difficulty.dc})`);
            }
            if (diffParts.length) {
                lines.push(`<li><strong>Difficulty:</strong> ${diffParts.join(' ')}</li>`);
            }
        }

        if (roll && (typeof roll.die === 'number' || typeof roll.total === 'number')) {
            const segments = [];
            if (typeof roll.die === 'number') {
                segments.push(`d20 ${roll.die}`);
            }
            if (typeof roll.skillValue === 'number') {
                const modifier = formatSigned(roll.skillValue);
                segments.push(`Skill ${modifier !== null ? modifier : roll.skillValue}`);
            }
            if (typeof roll.attributeBonus === 'number') {
                const modifier = formatSigned(roll.attributeBonus);
                segments.push(`Attribute ${modifier !== null ? modifier : roll.attributeBonus}`);
            }
            if (typeof roll.total === 'number') {
                segments.push(`Total ${roll.total}`);
            }

            let rollText = segments.join(' → ');
            if (roll.detail) {
                rollText += `<br><small>${this.escapeHtml(String(roll.detail))}</small>`;
            }

            lines.push(`<li><strong>Roll:</strong> ${rollText}</li>`);
        }

        const resultParts = [];
        if (label) {
            resultParts.push(this.escapeHtml(String(label)));
        }
        if (typeof margin === 'number') {
            resultParts.push(`(margin ${margin >= 0 ? '+' : ''}${margin})`);
        }
        if (type) {
            resultParts.push(`[${this.escapeHtml(String(type))}]`);
        }
        if (reason) {
            resultParts.push(`– ${this.escapeHtml(String(reason))}`);
        }
        if (resultParts.length) {
            lines.push(`<li><strong>Outcome:</strong> ${resultParts.join(' ')}</li>`);
        }

        if (!lines.length) {
            return;
        }

        contentDiv.innerHTML = `
            <div class="skill-check-details">
                <ul>
                    ${lines.join('\n')}
                </ul>
            </div>
        `;

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addAttackCheckMessage(summary) {
        if (!summary || typeof summary !== 'object') {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message attack-check-message';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '⚔️ Attack Check';

        const contentDiv = document.createElement('div');

        const lines = [];
        const formatSigned = (value) => {
            if (typeof value !== 'number' || Number.isNaN(value)) {
                return null;
            }
            return value >= 0 ? `+${value}` : `${value}`;
        };

        const resultParts = [];
        if (typeof summary.hit === 'boolean') {
            resultParts.push(summary.hit ? 'Hit' : 'Miss');
        }
        if (typeof summary.hitDegree === 'number' && !Number.isNaN(summary.hitDegree)) {
            resultParts.push(`(degree ${summary.hitDegree >= 0 ? '+' : ''}${summary.hitDegree})`);
        }
        if (resultParts.length) {
            lines.push(`<li><strong>Result:</strong> ${resultParts.join(' ')}</li>`);
        }

        const attacker = summary.attacker || {};
        const attackerParts = [];
        if (attacker.name) {
            attackerParts.push(this.escapeHtml(String(attacker.name)));
        }
        if (typeof attacker.level === 'number') {
            attackerParts.push(`Level ${attacker.level}`);
        }
        if (attacker.weapon) {
            attackerParts.push(`Weapon: ${this.escapeHtml(String(attacker.weapon))}`);
        }
        if (attacker.ability && attacker.ability !== 'N/A') {
            attackerParts.push(`Ability: ${this.escapeHtml(String(attacker.ability))}`);
        }
        if (attackerParts.length) {
            lines.push(`<li><strong>Attacker:</strong> ${attackerParts.join(' • ')}</li>`);
        }

        if (attacker.attackSkill && (attacker.attackSkill.name || typeof attacker.attackSkill.value === 'number')) {
            const parts = [];
            if (attacker.attackSkill.name) {
                parts.push(this.escapeHtml(String(attacker.attackSkill.name)));
            }
            if (typeof attacker.attackSkill.value === 'number') {
                const modifier = formatSigned(attacker.attackSkill.value);
                parts.push(modifier !== null ? modifier : String(attacker.attackSkill.value));
            }
            if (parts.length) {
                lines.push(`<li><strong>Attack Skill:</strong> ${parts.join(' ')}</li>`);
            }
        }

        if (attacker.attackAttribute && (attacker.attackAttribute.name || typeof attacker.attackAttribute.modifier === 'number')) {
            const parts = [];
            if (attacker.attackAttribute.name) {
                parts.push(this.escapeHtml(String(attacker.attackAttribute.name)));
            }
            if (typeof attacker.attackAttribute.modifier === 'number') {
                const modifier = formatSigned(attacker.attackAttribute.modifier);
                parts.push(modifier !== null ? modifier : String(attacker.attackAttribute.modifier));
            }
            if (parts.length) {
                lines.push(`<li><strong>Attack Attribute:</strong> ${parts.join(' ')}</li>`);
            }
        }

        const defender = summary.defender || {};
        const defenderParts = [];
        if (defender.name) {
            defenderParts.push(this.escapeHtml(String(defender.name)));
        }
        if (typeof defender.level === 'number') {
            defenderParts.push(`Level ${defender.level}`);
        }
        if (defender.defenseSkill) {
            const defenseSkill = defender.defenseSkill;
            const defenceSegments = [];
            if (defenseSkill.name) {
                defenceSegments.push(this.escapeHtml(String(defenseSkill.name)));
            }
            if (typeof defenseSkill.value === 'number') {
                const modifier = formatSigned(defenseSkill.value);
                defenceSegments.push(modifier !== null ? modifier : String(defenseSkill.value));
            }
            if (defenseSkill.source) {
                defenceSegments.push(`[${this.escapeHtml(String(defenseSkill.source))}]`);
            }
            if (defenceSegments.length) {
                defenderParts.push(`Defense: ${defenceSegments.join(' ')}`);
            }
        }
        if (defenderParts.length) {
            lines.push(`<li><strong>Defender:</strong> ${defenderParts.join(' • ')}</li>`);
        }

        const difficulty = summary.difficulty || {};
        if (difficulty.value || typeof difficulty.defenderLevel === 'number' || difficulty.defenseSkill) {
            const diffParts = [];
            if (typeof difficulty.value === 'number') {
                diffParts.push(`Hit DC ${difficulty.value}`);
            }
            if (typeof difficulty.defenderLevel === 'number') {
                diffParts.push(`Defender Level ${difficulty.defenderLevel}`);
            }
            if (difficulty.defenseSkill && difficulty.defenseSkill.name) {
                diffParts.push(`Best Defense: ${this.escapeHtml(String(difficulty.defenseSkill.name))}`);
            }
            if (diffParts.length) {
                lines.push(`<li><strong>Difficulty:</strong> ${diffParts.join(' • ')}</li>`);
            }
        }

        const roll = summary.roll || {};
        if (typeof roll.die === 'number' || typeof roll.total === 'number' || roll.attackSkill || roll.attackAttribute) {
            const rollSegments = [];
            if (typeof roll.die === 'number') {
                rollSegments.push(`d20 ${roll.die}`);
            }
            if (roll.attackSkill && typeof roll.attackSkill.value === 'number') {
                const skillName = roll.attackSkill.name ? `${this.escapeHtml(String(roll.attackSkill.name))} ` : '';
                const modifier = formatSigned(roll.attackSkill.value);
                rollSegments.push(`${skillName}${modifier !== null ? modifier : roll.attackSkill.value}`);
            }
            if (roll.attackAttribute && typeof roll.attackAttribute.modifier === 'number') {
                const attrName = roll.attackAttribute.name ? `${this.escapeHtml(String(roll.attackAttribute.name))} ` : '';
                const modifier = formatSigned(roll.attackAttribute.modifier);
                rollSegments.push(`${attrName}${modifier !== null ? modifier : roll.attackAttribute.modifier}`);
            }
            if (typeof roll.total === 'number') {
                rollSegments.push(`Total ${roll.total}`);
            }

            if (rollSegments.length) {
                let rollText = rollSegments.join(' → ');
                if (roll.detail) {
                    rollText += `<br><small>${this.escapeHtml(String(roll.detail))}</small>`;
                }
                lines.push(`<li><strong>Roll:</strong> ${rollText}</li>`);
            }
        }

        const damage = summary.damage || {};
        if (typeof damage.total === 'number' || typeof damage.raw === 'number' || damage.weaponName || (damage.damageAttribute && (damage.damageAttribute.name || typeof damage.damageAttribute.modifier === 'number'))) {
            const damageParts = [];
            if (typeof damage.total === 'number') {
                damageParts.push(`Total ${damage.total}`);
            }
            if (typeof damage.applied === 'number' && damage.applied !== damage.total) {
                damageParts.push(`Applied ${damage.applied}`);
            }
            if (typeof damage.raw === 'number' && damage.raw !== damage.total) {
                damageParts.push(`Raw ${damage.raw}`);
            }
            if (typeof damage.toughnessReduction === 'number' && damage.toughnessReduction) {
                damageParts.push(`Toughness -${Math.abs(damage.toughnessReduction)}`);
            }
            if (damageParts.length) {
                lines.push(`<li><strong>Damage:</strong> ${damageParts.join(' • ')}</li>`);
            }

            const weaponParts = [];
            if (damage.weaponName) {
                weaponParts.push(this.escapeHtml(String(damage.weaponName)));
            }
            if (typeof damage.weaponRating === 'number') {
                weaponParts.push(`Rating ${damage.weaponRating}`);
            }
            if (typeof damage.baseWeaponDamage === 'number') {
                weaponParts.push(`Base ${damage.baseWeaponDamage}`);
            }
            if (weaponParts.length) {
                lines.push(`<li><strong>Weapon:</strong> ${weaponParts.join(' • ')}</li>`);
            }

            if (damage.damageAttribute && (damage.damageAttribute.name || typeof damage.damageAttribute.modifier === 'number')) {
                const parts = [];
                if (damage.damageAttribute.name) {
                    parts.push(this.escapeHtml(String(damage.damageAttribute.name)));
                }
                if (typeof damage.damageAttribute.modifier === 'number') {
                    const modifier = formatSigned(damage.damageAttribute.modifier);
                    parts.push(modifier !== null ? modifier : String(damage.damageAttribute.modifier));
                }
                if (parts.length) {
                    lines.push(`<li><strong>Damage Attribute:</strong> ${parts.join(' ')}</li>`);
                }
            }
        }

        const target = summary.target || {};
        if (typeof target.startingHealth === 'number' || typeof target.remainingHealth === 'number') {
            const targetParts = [];
            if (typeof target.startingHealth === 'number') {
                targetParts.push(`Start ${target.startingHealth}`);
            }
            if (typeof target.remainingHealth === 'number') {
                targetParts.push(`End ${target.remainingHealth}`);
            }
            if (typeof target.healthLostPercent === 'number') {
                targetParts.push(`Lost ${target.healthLostPercent}%`);
            }
            if (typeof target.remainingHealthPercent === 'number') {
                targetParts.push(`Remaining ${target.remainingHealthPercent}%`);
            }
            if (typeof target.defeated === 'boolean') {
                targetParts.push(target.defeated ? 'Defeated' : 'Standing');
            }
            if (targetParts.length) {
                lines.push(`<li><strong>Target Health:</strong> ${targetParts.join(' • ')}</li>`);
            }
        }

        if (!lines.length) {
            return;
        }

        contentDiv.innerHTML = `
            <div class="skill-check-details attack-check-details">
                <ul>
                    ${lines.join('\n')}
                </ul>
            </div>
        `;

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    collectSkillRankElements() {
        const elements = new Map();
        const rankNodes = document.querySelectorAll('.skill-rank[data-skill-name]');
        rankNodes.forEach(node => {
            const name = node.dataset.skillName;
            if (name) {
                elements.set(name, node);
            }
        });
        return elements;
    }

    initSkillIncreaseControls() {
        const buttons = document.querySelectorAll('.skill-increase-btn[data-skill-name]');
        if (!buttons.length) {
            return;
        }

        buttons.forEach(button => {
            button.addEventListener('click', async () => {
                const skillName = button.dataset.skillName;
                if (!skillName) return;

                try {
                    const response = await fetch(`/api/player/skills/${encodeURIComponent(skillName)}/increase`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ amount: 1 })
                    });

                    const data = await response.json();

                    if (!response.ok || !data.success) {
                        throw new Error(data.error || `Server error (${response.status})`);
                    }

                    if (data.player) {
                        this.refreshSkillState(data.player);
                    }
                } catch (error) {
                    alert(`Failed to increase skill: ${error.message}`);
                }
            });
        });
    }

    updateSkillPointsDisplay(value) {
        if (this.skillPointsDisplay && value !== undefined && value !== null) {
            this.skillPointsDisplay.textContent = value;
        }
    }

    updateSkillRankDisplay(skillName, rank) {
        if (!skillName) return;
        const element = this.skillRankElements.get(skillName);
        if (element && rank !== undefined && rank !== null) {
            element.textContent = rank;
        }
    }

    refreshSkillState(player) {
        if (!player) return;
        if (player.unspentSkillPoints !== undefined) {
            this.updateSkillPointsDisplay(player.unspentSkillPoints);
        }
        if (player.skills) {
            for (const [skillName, rank] of Object.entries(player.skills)) {
                this.updateSkillRankDisplay(skillName, rank);
            }
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
        const rawInput = this.messageInput.value;
        const message = rawInput.trim();
        if (!message) return;

        this.addMessage('user', message);
        this.chatHistory.push({ role: 'user', content: rawInput });

        this.messageInput.value = '';
        this.sendButton.disabled = true;
        this.showLoading();

        let shouldRefreshLocation = false;

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
                this.addMessage('ai', data.response, false, data.debug);
                this.chatHistory.push({ role: 'assistant', content: data.response });
                shouldRefreshLocation = true;

                if (data.eventChecks) {
                    this.addEventMessage(data.eventChecks);
                }

                if (data.actionResolution?.roll !== null) {
                    console.log(data.actionResolution);
                    this.addSkillCheckMessage(data.actionResolution);
                }

                const resolvedAttackSummary = data.attackSummary || data.attackCheck?.summary || null;
                console.log("AI message");
                console.log(data.attackSummary);
                console.log(data.attackCheck);
                console.log(resolvedAttackSummary);
                if (resolvedAttackSummary) {
                    this.addAttackCheckMessage(resolvedAttackSummary);
                }

                if (data.events) {
                    this.addEventSummaries(data.events);
                    shouldRefreshLocation = true;
                }

                if (data.plausibility) {
                    this.addPlausibilityMessage(data.plausibility);
                }

                if (Array.isArray(data.npcTurns) && data.npcTurns.length) {
                    data.npcTurns.forEach(turn => {
                        if (!turn || !turn.response) {
                            return;
                        }
                        this.addNpcMessage(turn.name || 'NPC', turn.response);
                        this.chatHistory.push({ role: 'assistant', content: turn.response });

                        if (turn.eventChecks) {
                            this.addEventMessage(turn.eventChecks);
                        }

                        if (turn.events) {
                            this.addEventSummaries(turn.events);
                        }

                        if (turn.attackSummary) {
                            this.addAttackCheckMessage(turn.attackSummary);
                        }

                        if (turn.actionResolution && turn.actionResolution.roll) {
                            this.addSkillCheckMessage(turn.actionResolution);
                        }
                    });
                    shouldRefreshLocation = true;
                }
            }
        } catch (error) {
            this.hideLoading();
            this.addMessage('system', `Connection error: ${error.message}`, true);
        }

        if (shouldRefreshLocation) {
            try {
                await this.checkLocationUpdate();
            } catch (refreshError) {
                console.warn('Failed to refresh location after chat response:', refreshError);
            }
        }

        this.sendButton.disabled = false;
        this.messageInput.focus();
    }

    async checkLocationUpdate() {
        console.log('Checking for location update...');
        try {
            const response = await fetch('/api/player', { cache: 'no-store' });
            const result = await response.json();

            if (result.success && result.player) {
                if (window.updateInventoryDisplay) {
                    window.updateInventoryDisplay(result.player || {});
                }
                if (window.refreshParty) {
                    window.refreshParty();
                }

                this.refreshSkillState(result.player);

                if (result.player.currentLocation) {
                    // Fetch location details
                    const cacheBuster = Date.now();
                    const locationResponse = await fetch(`/api/locations/${result.player.currentLocation}?_=${cacheBuster}`, {
                        cache: 'no-store'
                    });
                    const locationResult = await locationResponse.json();
                    console.log('Location details fetched:', locationResult);

                    if (locationResult.success && locationResult.location) {
                        // Update location display if the updateLocationDisplay function exists
                        if (window.updateLocationDisplay) {
                            window.updateLocationDisplay(locationResult.location);
                        }
                    }
                }
            }
        } catch (error) {
            console.log('Could not check location update:', error);
        }
        console.log("Location update check complete.");
    }
}

console.log("chat.js loaded");

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AIRPGChat();
});
