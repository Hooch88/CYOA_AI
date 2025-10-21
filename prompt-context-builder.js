const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const Utils = require('./Utils.js');
const Globals = require('./Globals.js');
const Player = require('./Player.js');
const Location = require('./Location.js');
const Region = require('./Region.js');
const Thing = require('./Thing.js');

let config = Globals.config;
let getChatHistory = () => [];
let getCurrentPlayer = () => null;
let getGameLocations = () => new Map();
let getRegions = () => new Map();
let getThings = () => new Map();
let getPlayers = () => new Map();
let getSkills = () => new Map();
let getCurrentTurnToken = () => null;
let getCurrentSetting = () => null;

let baseContextMemoryCache = {
    turnKey: null,
    selections: new Map()
};

function getActiveSettingSnapshot() {
    const currentSetting = getCurrentSetting();
    if (currentSetting && typeof currentSetting.toJSON === 'function') {
        return currentSetting.toJSON();
    }
    return null;
}

function describeSettingForPrompt(settingSnapshot = null) {
    const fallbackSetting = config.gamemaster?.promptVariables?.setting;

    if (!settingSnapshot) {
        if (typeof fallbackSetting === 'string' && fallbackSetting.trim()) {
            return fallbackSetting.trim();
        }
        return 'A rich fantasy world filled with adventure.';
    }

    const sections = [];
    const titleParts = [];

    if (settingSnapshot.name) {
        titleParts.push(settingSnapshot.name);
    }

    const themeGenre = [settingSnapshot.theme, settingSnapshot.genre]
        .filter(part => typeof part === 'string' && part.trim())
        .map(part => part.trim())
        .join(' / ');

    if (themeGenre) {
        titleParts.push(themeGenre);
    }

    if (titleParts.length) {
        sections.push(titleParts.join(' - '));
    }

    if (settingSnapshot.description) {
        sections.push(settingSnapshot.description);
    }

    const traitParts = [];
    if (settingSnapshot.tone) traitParts.push(`tone ${settingSnapshot.tone}`);
    if (settingSnapshot.difficulty) traitParts.push(`difficulty ${settingSnapshot.difficulty}`);
    if (settingSnapshot.magicLevel) traitParts.push(`magic ${settingSnapshot.magicLevel}`);
    if (settingSnapshot.techLevel) traitParts.push(`technology ${settingSnapshot.techLevel}`);

    if (traitParts.length) {
        sections.push(`Key traits: ${traitParts.join(', ')}.`);
    }

    if (settingSnapshot.startingLocationType) {
        sections.push(`Common starting location: ${settingSnapshot.startingLocationType}.`);
    }

    const description = sections.join(' ').trim();
    if (description) {
        return description;
    }

    if (typeof fallbackSetting === 'string' && fallbackSetting.trim()) {
        return fallbackSetting.trim();
    }

    return 'A rich fantasy world filled with adventure.';
}

function normalizeSettingValue(value, fallback = '') {
    if (value === null || value === undefined) {
        return fallback;
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return fallback;
}

function normalizeSettingList(value) {
    const rawEntries = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(/\r?\n/) : []);

    const seen = new Set();
    const result = [];

    for (const entry of rawEntries) {
        if (typeof entry !== 'string') {
            continue;
        }
        const trimmed = entry.trim();
        if (!trimmed) {
            continue;
        }
        const lower = trimmed.toLowerCase();
        if (seen.has(lower)) {
            continue;
        }
        seen.add(lower);
        result.push(trimmed);
    }

    return result;
}

function buildSettingPromptContext(settingSnapshot = null, { descriptionFallback = null } = {}) {
    const fallbackDescription = typeof descriptionFallback === 'string' && descriptionFallback
        ? descriptionFallback
        : describeSettingForPrompt(settingSnapshot);

    const context = {
        name: normalizeSettingValue(settingSnapshot?.name, ''),
        description: normalizeSettingValue(settingSnapshot?.description, fallbackDescription || ''),
        theme: normalizeSettingValue(settingSnapshot?.theme, ''),
        genre: normalizeSettingValue(settingSnapshot?.genre, ''),
        startingLocationType: normalizeSettingValue(settingSnapshot?.startingLocationType, ''),
        magicLevel: normalizeSettingValue(settingSnapshot?.magicLevel, ''),
        techLevel: normalizeSettingValue(settingSnapshot?.techLevel, ''),
        tone: normalizeSettingValue(settingSnapshot?.tone, ''),
        difficulty: normalizeSettingValue(settingSnapshot?.difficulty, ''),
        currencyName: normalizeSettingValue(settingSnapshot?.currencyName, ''),
        currencyNamePlural: normalizeSettingValue(settingSnapshot?.currencyNamePlural, ''),
        currencyValueNotes: normalizeSettingValue(settingSnapshot?.currencyValueNotes, ''),
        writingStyleNotes: normalizeSettingValue(settingSnapshot?.writingStyleNotes, '')
    };

    if (!context.description && fallbackDescription) {
        context.description = fallbackDescription;
    }

    context.races = normalizeSettingList(settingSnapshot?.availableRaces);

    return context;
}

function findRegionByLocationId(locationId) {
    if (!locationId) {
        return null;
    }
    for (const region of getRegions().values()) {
        if (Array.isArray(region.locationIds) && region.locationIds.includes(locationId)) {
            return region;
        }
    }
    return null;
}

function getBaseContextTurnKey() {
    const currentPlayer = getCurrentPlayer();
    const chatHistory = getChatHistory();
    const playerId = currentPlayer?.id || 'no-player';
    const currentTurnToken = getCurrentTurnToken();
    if (currentTurnToken) {
        return `${playerId}:${currentTurnToken}`;
    }

    const lastEntry = Array.isArray(chatHistory) && chatHistory.length
        ? chatHistory[chatHistory.length - 1]
        : null;
    const marker = lastEntry?.turnId
        || lastEntry?.timestamp
        || lastEntry?.id
        || '';
    return `${playerId}:${chatHistory.length}:${marker}`;
}

function sanitizeImportantMemories(memories) {
    if (!Array.isArray(memories)) {
        return [];
    }
    return memories
        .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean);
}

function createSelectedEntries(indices, memories) {
    const uniqueIndices = [];
    for (const index of indices) {
        if (!Number.isInteger(index) || index < 0 || index >= memories.length) {
            continue;
        }
        if (!uniqueIndices.includes(index)) {
            uniqueIndices.push(index);
        }
    }
    return uniqueIndices.map(idx => ({
        index: idx,
        displayIndex: idx + 1,
        memory: memories[idx]
    }));
}

function cloneSelectedEntries(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }
    return entries.map(entry => ({
        index: entry.index,
        displayIndex: entry.displayIndex,
        memory: entry.memory
    }));
}

function populateNpcSelectedMemoriesSync(baseContext) {
    if (!baseContext || !config) {
        return;
    }

    const maxConfigured = Number(config.max_memories_to_recall);
    const maxMemories = Number.isInteger(maxConfigured) && maxConfigured > 0 ? maxConfigured : 10;

    const turnKey = getBaseContextTurnKey();
    if (baseContextMemoryCache.turnKey !== turnKey) {
        baseContextMemoryCache.turnKey = turnKey;
        baseContextMemoryCache.selections = new Map();
    }

    const actors = [];
    const registerActor = (actor, groupLabel) => {
        if (!actor || typeof actor !== 'object') {
            return;
        }
        const actorId = actor.id || `${groupLabel}:${actor.name || ''}`.trim();
        if (!actorId) {
            return;
        }
        const important = sanitizeImportantMemories(actor.importantMemories
            || actor.memories
            || []);
        actor.importantMemories = important;
        actor.selectedImportantMemories = Array.isArray(actor.selectedImportantMemories)
            ? actor.selectedImportantMemories
            : [];
        actors.push({ actor, actorId, important });
    };

    if (Array.isArray(baseContext.npcs)) {
        baseContext.npcs.forEach(npc => registerActor(npc, 'npc'));
    }
    if (Array.isArray(baseContext.party)) {
        baseContext.party.forEach(member => registerActor(member, 'party'));
    }

    for (const entry of actors) {
        const { actor, actorId, important } = entry;
        if (!important.length) {
            actor.selectedImportantMemories = [];
            continue;
        }

        const signature = `${actorId}::${important.join('||')}`;
        const cached = baseContextMemoryCache.selections.get(actorId);

        if (cached && cached.signature === signature && cached.fromFallback !== true) {
            actor.selectedImportantMemories = cloneSelectedEntries(cached.selected);
            continue;
        }

        if (cached && cached.signature === signature && cached.fromFallback === true) {
            actor.selectedImportantMemories = cloneSelectedEntries(cached.selected);
        }

        if (important.length <= maxMemories) {
            const selected = createSelectedEntries(important.map((_, index) => index), important);
            actor.selectedImportantMemories = selected;
            baseContextMemoryCache.selections.set(actorId, { signature, selected: cloneSelectedEntries(selected), fromFallback: false });
            continue;
        }

        const fallbackIndices = [];
        for (let i = 0; i < Math.min(maxMemories, important.length); i += 1) {
            fallbackIndices.push(i);
        }
        const fallbackSelected = createSelectedEntries(fallbackIndices, important);
        actor.selectedImportantMemories = fallbackSelected;
        baseContextMemoryCache.selections.set(actorId, { signature, selected: cloneSelectedEntries(fallbackSelected), fromFallback: true });
    }

    baseContext.maxMemoriesToRecall = maxMemories;
}

function getWorldOutline() {
    // We need to populate worldOutline with regions and their locations
    let worldOutline = {
        regions: {}
    };

    // Iterate all regions
    let regionMap = Region.getIndexByName();
    // Get name of each region
    for (const [regionName, regionObj] of regionMap) {
        worldOutline.regions[regionObj.name] = [];
        for (const locationObj of regionObj.locations) {
            worldOutline.regions[regionObj.name].push(locationObj.name);
        }
    }
    return worldOutline;
}

function getGearSlotTypes() {
    try {
        const definitions = Player.gearSlotDefinitions;
        if (!definitions || !(definitions.byType instanceof Map)) {
            return [];
        }
        const types = Array.from(definitions.byType.keys())
            .filter(type => typeof type === 'string' && type.trim())
            .map(type => type.trim());
        return types.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch (error) {
        console.warn('Failed to resolve gear slot types:', error.message);
        return [];
    }
}

function getGearSlotNames() {
    try {
        const definitions = Player.gearSlotDefinitions;
        if (!definitions) {
            return [];
        }
        const slotSet = new Set();

        if (definitions.byType instanceof Map) {
            for (const names of definitions.byType.values()) {
                if (Array.isArray(names)) {
                    names.forEach(name => {
                        if (typeof name === 'string' && name.trim()) {
                            slotSet.add(name.trim());
                        }
                    });
                }
            }
        }

        if (definitions.byName instanceof Map) {
            for (const name of definitions.byName.keys()) {
                if (typeof name === 'string' && name.trim()) {
                    slotSet.add(name.trim());
                }
            }
        }

        return Array.from(slotSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch (error) {
        console.warn('Failed to resolve gear slot names:', error.message);
        return [];
    }
}

let cachedExperiencePointValues = null;
function getExperiencePointValues() {
    if (cachedExperiencePointValues) {
        return cachedExperiencePointValues;
    }

    const xpPath = path.join(__dirname, 'defs', 'experience_point_values.yaml');
    try {
        if (!fs.existsSync(xpPath)) {
            cachedExperiencePointValues = [];
            return cachedExperiencePointValues;
        }
        const raw = fs.readFileSync(xpPath, 'utf8');
        const parsed = yaml.load(raw);
        const results = [];

        const addEntry = (action, value) => {
            const trimmedAction = typeof action === 'string' ? action.trim() : '';
            const stringValue = value === null || value === undefined ? '' : String(value).trim();
            if (!trimmedAction) {
                return;
            }
            results.push({
                action: trimmedAction,
                value: stringValue
            });
        };

        if (Array.isArray(parsed)) {
            for (const entry of parsed) {
                if (entry === null || entry === undefined) {
                    continue;
                }
                if (typeof entry === 'object' && !Array.isArray(entry)) {
                    for (const [key, value] of Object.entries(entry)) {
                        addEntry(key, value);
                    }
                    continue;
                }
                const text = String(entry).trim();
                if (!text) {
                    continue;
                }
                const separatorIndex = text.indexOf(':');
                if (separatorIndex >= 0) {
                    const action = text.slice(0, separatorIndex);
                    const value = text.slice(separatorIndex + 1);
                    addEntry(action, value);
                } else {
                    addEntry(text, '');
                }
            }
        } else if (parsed && typeof parsed === 'object') {
            for (const [key, value] of Object.entries(parsed)) {
                addEntry(key, value);
            }
        }

        cachedExperiencePointValues = results;
        return cachedExperiencePointValues;
    } catch (error) {
        console.warn('Failed to load experience point values:', error.message);
        cachedExperiencePointValues = [];
        return cachedExperiencePointValues;
    }
}

const attributeDefinitionsForPrompt = (() => {
    try {
        const template = new Player({ name: 'Attribute Template', description: 'Template loader' });
        const defs = template.attributeDefinitions || {};
        const context = {};
        for (const [attrName, def] of Object.entries(defs)) {
            context[attrName] = {
                description: def.description || def.label || attrName
            };
        }
        return context;
    } catch (error) {
        console.warn('Failed to load attribute definitions for NPC prompt:', error.message);
        return {};
    }
})();

function buildBasePromptContext({ locationOverride = null } = {}) {
    const currentPlayer = getCurrentPlayer();
    const chatHistory = getChatHistory();
    const gameLocations = getGameLocations();
    const regions = getRegions();
    const players = getPlayers();
    const things = getThings();
    const skills = getSkills();

    const activeSetting = getActiveSettingSnapshot();
    const settingDescription = describeSettingForPrompt(activeSetting);
    const settingContext = buildSettingPromptContext(activeSetting, { descriptionFallback: settingDescription });
    const generatedThingRarity = Thing.generateRandomRarityDefinition();

    const needBarDefinitions = Player.getNeedBarDefinitionsForContext();
    const attributeEntriesForPrompt = Object.keys(attributeDefinitionsForPrompt || {})
        .filter(name => typeof name === 'string' && name.trim())
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const equipmentSlotTypesForPrompt = getGearSlotTypes();
    const gearSlotNamesForPrompt = getGearSlotNames();

    let location = locationOverride;
    if (!location && currentPlayer && currentPlayer.currentLocation) {
        try {
            location = Location.get(currentPlayer.currentLocation);
        } catch (error) {
            console.warn('Failed to resolve current player location for prompt context:', error.message);
        }
    }

    let region = null;
    if (location) {
        try {
            region = findRegionByLocationId(location.id);
        } catch (error) {
            console.warn('Failed to resolve region by location id:', error.message);
        }

        if (!region && location.stubMetadata?.regionId && regions.has(location.stubMetadata.regionId)) {
            region = regions.get(location.stubMetadata.regionId);
        }
    }

    const locationDetails = location ? location.getDetails() : null;
    const playerStatus = currentPlayer && typeof currentPlayer.getStatus === 'function'
        ? currentPlayer.getStatus()
        : null;

    const normalizeStatusEffects = value => {
        let source = [];
        if (!value) {
            return [];
        }

        if (typeof value.getStatusEffects === 'function') {
            source = value.getStatusEffects();
        } else if (Array.isArray(value.statusEffects)) {
            source = value.statusEffects;
        } else if (Array.isArray(value)) {
            source = value;
        }

        const normalized = [];
        for (const entry of source) {
            if (!entry) continue;

            if (typeof entry === 'string') {
                const description = entry.trim();
                if (!description) continue;
                normalized.push({ description, duration: 1 });
                continue;
            }

            if (typeof entry === 'object') {
                const descriptionValue = typeof entry.description === 'string'
                    ? entry.description.trim()
                    : (typeof entry.text === 'string' ? entry.text.trim() : (typeof entry.name === 'string' ? entry.name.trim() : ''));
                if (!descriptionValue) {
                    continue;
                }

                const rawDuration = entry.duration;
                let duration = null;
                if (Number.isFinite(rawDuration)) {
                    duration = Math.floor(rawDuration);
                } else if (Number.isFinite(Number(rawDuration))) {
                    duration = Math.floor(Number(rawDuration));
                } else if (rawDuration === null) {
                    duration = null;
                } else {
                    duration = 1;
                }

                normalized.push({
                    description: descriptionValue,
                    duration: duration === null ? null : Math.max(0, duration)
                });
            }
        }

        return normalized;
    };

    const exitSummaries = [];
    if (locationDetails && typeof locationDetails.exits === 'object' && locationDetails.exits !== null) {
        for (const [directionKey, exitInfo] of Object.entries(locationDetails.exits)) {
            if (!exitInfo) {
                continue;
            }

            //console.log('Exit info:', directionKey, exitInfo);

            const label = exitInfo.name;
            exitSummaries.push({
                name: label,
                isVehicle: Boolean(exitInfo.isVehicle),
                vehicleType: typeof exitInfo.vehicleType === 'string' ? exitInfo.vehicleType : null
            });
        }
    }

    const currentLocationContext = {
        name: locationDetails?.name || location?.name || 'Unknown Location',
        description: locationDetails?.description || location?.description || 'No description available.',
        statusEffects: normalizeStatusEffects(location || locationDetails),
        exits: exitSummaries
    };

    const regionStatus = region && typeof region.toJSON === 'function' ? region.toJSON() : null;
    const regionLocations = [];

    /*  <worldOutline>
    {% for region in worldOutline.regions %}
    <region name="{{ region.name }}">
      <name>{{ region.name }}</name>
      <locations>
        {% for loc in region.locations %}<name>{{ loc.name }}</name>
        {% endfor %}
      </locations>
    </region>
    {% endfor %}
    </worldOutline> */

    let worldOutline = getWorldOutline();

    if (regionStatus && Array.isArray(regionStatus.locationIds)) {
        for (const locId of regionStatus.locationIds) {
            if (!locId) continue;
            const regionLocation = gameLocations.get(locId);
            const regionLocationDetails = regionLocation?.getDetails?.();
            const regionLocationName = regionLocationDetails?.name || regionLocation?.name || locId;
            const regionLocationDescription = regionLocationDetails?.description
                || regionLocation?.description
                || regionLocation?.stubMetadata?.blueprintDescription
                || '';

            regionLocations.push({
                id: locId,
                name: regionLocationName,
                description: regionLocationDescription
            });
        }
    }

    if (!regionLocations.length && regionStatus && Array.isArray(regionStatus.locationBlueprints)) {
        for (const blueprint of regionStatus.locationBlueprints) {
            if (!blueprint || !blueprint.name) continue;
            regionLocations.push({
                id: blueprint.name,
                name: blueprint.name,
                description: blueprint.description || ''
            });
        }
    }

    const currentRegionContext = {
        name: regionStatus?.name || location?.stubMetadata?.regionName || 'Unknown Region',
        description: regionStatus?.description || location?.stubMetadata?.regionDescription || 'No region description available.',
        statusEffects: normalizeStatusEffects(region || regionStatus),
        locations: regionLocations
    };

    const mapItemContext = (item, equippedSlot = null) => {
        if (!item) {
            return null;
        }

        const name = item.name || item.title || 'Unknown Item';
        const description = item.description || item.summary || '';
        const statusEffects = normalizeStatusEffects(item);
        const equipped = equippedSlot || null;
        const metadataIsScenery = typeof item?.metadata?.isScenery === 'boolean'
            ? item.metadata.isScenery
            : null;

        const resolveTypeValue = (value) => {
            if (typeof value !== 'string') {
                return null;
            }
            const trimmed = value.trim();
            return trimmed ? trimmed.toLowerCase() : null;
        };

        const normalizedThingType = resolveTypeValue(
            item?.thingType
            ?? item?.itemOrScenery
            ?? item?.type
            ?? item?.itemTypeDetail
        );

        let isScenery = null;
        if (typeof item?.isScenery === 'boolean') {
            isScenery = item.isScenery;
        } else if (metadataIsScenery !== null) {
            isScenery = metadataIsScenery;
        } else if (normalizedThingType) {
            isScenery = normalizedThingType === 'scenery';
        }

        if (isScenery === null) {
            isScenery = false;
        }

        return {
            name,
            description,
            statusEffects,
            equippedSlot: equipped,
            isScenery,
            thingType: normalizedThingType || (isScenery ? 'scenery' : null),
            rarity: item.rarity || null,
            attributeBonuses: Array.isArray(item.attributeBonuses) ? item.attributeBonuses : [],
            causeStatusEffect: item.causeStatusEffect || null,
            value: item.metadata.value,
            weight: item.metadata.weight,
            properties: item.metadata.properties
        };
    };

    const isInterestingSkill = (skillName, rank) => {
        if (!skillName) {
            return false;
        }
        const normalized = skillName.trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        const boringPrefixes = ['basic ', 'common ', 'general '];
        if (boringPrefixes.some(prefix => normalized.startsWith(prefix))) {
            return false;
        }

        if (normalized === 'common knowledge' || normalized === 'general knowledge') {
            return false;
        }

        const rankValue = Number.isFinite(rank) ? rank : 0;
        return rankValue >= 2 || normalized.length > 4;
    };

    const mapSkillContext = (skillsSource) => {
        if (!skillsSource) {
            return [];
        }

        const entries = [];
        const skillEntries = skillsSource instanceof Map
            ? Array.from(skillsSource.entries())
            : (typeof skillsSource === 'object' && skillsSource !== null
                ? Object.entries(skillsSource)
                : []);

        for (const [skillName, rank] of skillEntries) {
            if (!skillName) {
                continue;
            }

            const numericRank = Number.isFinite(rank) ? rank : Number(rank);
            if (!isInterestingSkill(skillName, numericRank)) {
                continue;
            }

            let skillDef = skills.get(skillName);
            if (!skillDef && typeof skillName === 'string') {
                const normalized = skillName.trim().toLowerCase();
                for (const [name, definition] of skills.entries()) {
                    if (typeof name === 'string' && name.trim().toLowerCase() === normalized) {
                        skillDef = definition;
                        break;
                    }
                }
            }
            const description = skillDef?.description || skillDef?.details || '';
            entries.push({
                name: skillName,
                value: Number.isFinite(numericRank) ? numericRank : null,
                description
            });
        }

        return entries.sort((a, b) => a.name.localeCompare(b.name));
    };

    const collectActorSkills = (status, actor) => {
        if (status?.skillInfo && Array.isArray(status.skillInfo)) {
            return status.skillInfo;
        }

        if (status?.skills) {
            return mapSkillContext(status.skills);
        }

        if (actor && typeof actor.getSkills === 'function') {
            const source = actor.getSkills();
            if (source) {
                return mapSkillContext(source);
            }
        }

        return [];
    };

    const currentPlayerInventory = Array.isArray(playerStatus?.inventory)
        ? playerStatus.inventory.map(item => mapItemContext(item, item?.equippedSlot || null)).filter(Boolean)
        : [];

    const currentPlayerSkills = collectActorSkills(playerStatus, currentPlayer);

    const collectNeedBarsForPrompt = (actor, status, options = {}) => {
        if (actor && typeof actor.getNeedBarPromptContext === 'function') {
            return actor.getNeedBarPromptContext(options);
        }

        if (Array.isArray(status?.needBars)) {
            return status.needBars.map(bar => ({
                ...bar
            }));
        }

        return [];
    };

    const currentPlayerNeedBars = collectNeedBarsForPrompt(currentPlayer, playerStatus, { includePlayerOnly: true });

    const gearSnapshot = playerStatus?.gear && typeof playerStatus.gear === 'object'
        ? Object.entries(playerStatus.gear).map(([slotName, slotData]) => ({
            slot: slotName,
            itemId: slotData?.itemId || null
        }))
        : [];

    const currentPlayerContext = {
        name: playerStatus?.name || currentPlayer?.name || 'Unknown Adventurer',
        description: playerStatus?.description || currentPlayer?.description || '',
        health: playerStatus?.health ?? 'Unknown',
        maxHealth: playerStatus?.maxHealth ?? 'Unknown',
        level: playerStatus?.level ?? currentPlayer?.level ?? 'Unknown',
        class: playerStatus?.class || currentPlayer?.class || 'Adventurer',
        race: playerStatus?.race || currentPlayer?.race || 'Unknown',
        statusEffects: normalizeStatusEffects(currentPlayer || playerStatus),
        inventory: currentPlayerInventory,
        skills: currentPlayerSkills,
        gear: gearSnapshot,
        personality: extractPersonality(playerStatus, currentPlayer),
        currency: playerStatus?.currency ?? currentPlayer?.currency ?? 0,
        needBars: currentPlayerNeedBars
    };

    function sanitizePersonalityValue(value) {
        const collectValues = (input) => {
            if (input === null || input === undefined) {
                return [];
            }

            if (typeof input === 'string') {
                const trimmed = input.trim();
                return trimmed ? [trimmed] : [];
            }

            if (typeof input === 'number' || typeof input === 'boolean') {
                return [String(input)];
            }

            if (Array.isArray(input)) {
                return input.flatMap(collectValues);
            }

            if (typeof input === 'object') {
                return Object.values(input).flatMap(collectValues);
            }

            return [];
        };

        const parts = collectValues(value);
        if (!parts.length) {
            return null;
        }

        return parts.join(', ');
    }

    function collectPersonalityGoals(value) {
        const goals = [];
        const visit = (entry) => {
            if (entry === null || entry === undefined) {
                return;
            }
            if (typeof entry === 'string') {
                const trimmed = entry.trim();
                if (trimmed && !goals.includes(trimmed)) {
                    goals.push(trimmed);
                }
                return;
            }
            if (Array.isArray(entry)) {
                entry.forEach(visit);
                return;
            }
            if (typeof entry === 'object') {
                for (const value of Object.values(entry)) {
                    visit(value);
                }
            }
        };
        visit(value);
        return goals;
    }

    function extractPersonality(primary = null, fallback = null) {
        const primaryObj = primary && typeof primary === 'object' ? primary : null;
        const fallbackObj = fallback && typeof fallback === 'object' ? fallback : null;
        const personalitySource = primaryObj?.personality && typeof primaryObj.personality === 'object'
            ? primaryObj.personality
            : null;

        const type = sanitizePersonalityValue(
            personalitySource?.type
            ?? primaryObj?.personalityType
            ?? fallbackObj?.personalityType
        );
        const traits = sanitizePersonalityValue(
            personalitySource?.traits
            ?? primaryObj?.personalityTraits
            ?? fallbackObj?.personalityTraits
        );
        const notes = sanitizePersonalityValue(
            personalitySource?.notes
            ?? primaryObj?.personalityNotes
            ?? fallbackObj?.personalityNotes
        );

        const goals = collectPersonalityGoals(
            personalitySource?.goals
            ?? primaryObj?.goals
            ?? primaryObj?.personalityGoals
            ?? fallbackObj?.personality?.goals
            ?? fallbackObj?.goals
        );

        return { type, traits, notes, goals };
    }

    function computeDispositionsTowardsPlayer(actor) {
        if (!actor || !currentPlayer || typeof currentPlayer.id !== 'string' || !currentPlayer.id || !dispositionTypes.length) {
            return [];
        }

        const dispositions = [];
        for (const dispositionType of dispositionTypes) {
            if (!dispositionType || !dispositionType.key) {
                continue;
            }
            const typeKey = dispositionType.key;
            const typeLabel = dispositionType.label || typeKey;
            let value = 0;
            if (typeof actor.getDispositionTowardsCurrentPlayer === 'function') {
                value = actor.getDispositionTowardsCurrentPlayer(typeKey) ?? 0;
            } else if (typeof actor.getDisposition === 'function') {
                value = actor.getDisposition(currentPlayer.id, typeKey) ?? 0;
            }
            const intensityName = Player.resolveDispositionIntensity(typeKey, value);
            dispositions.push({
                type: typeLabel,
                value,
                intensityName
            });
        }
        return dispositions;
    }

    const npcs = [];
    const dispositionDefinitions = Player.getDispositionDefinitions();
    const dispositionTypes = Object.values(dispositionDefinitions?.types || {});
    const dispositionTypesForPrompt = dispositionTypes.map((type) => ({
        key: type.key,
        name: type.label || type.key,
        description: type.description || '',
        move_up: Array.isArray(type.moveUp) ? type.moveUp : [],
        move_down: Array.isArray(type.moveDown) ? type.moveDown : [],
        move_way_down: Array.isArray(type.moveWayDown) ? type.moveWayDown : []
    }));
    if (location) {
        const npcIds = Array.isArray(location.npcIds)
            ? location.npcIds
            : (Array.isArray(locationDetails?.npcIds) ? locationDetails.npcIds : []);
        for (const npcId of npcIds) {
            const npc = players.get(npcId);
            if (!npc) {
                continue;
            }
            const npcStatus = typeof npc.getStatus === 'function' ? npc.getStatus() : null;
            const npcInventory = Array.isArray(npcStatus?.inventory)
                ? npcStatus.inventory.map(item => mapItemContext(item, item?.equippedSlot || null)).filter(Boolean)
                : [];

            const dispositionsTowardsPlayer = computeDispositionsTowardsPlayer(npc);
            const skills = collectActorSkills(npcStatus, npc);
            const personality = extractPersonality(npcStatus, npc);
            const needBars = collectNeedBarsForPrompt(npc, npcStatus, { includePlayerOnly: false });
            const importantMemories = sanitizeImportantMemories(
                npcStatus?.importantMemories
                || npc?.importantMemories
                || []
            );

            npcs.push({
                id: npc.id,
                name: npcStatus?.name || npc.name || 'Unknown NPC',
                description: npcStatus?.description || npc.description || '',
                class: npcStatus?.class || npc.class || null,
                race: npcStatus?.race || npc.race || null,
                level: npcStatus?.level || npc.level || null,
                health: npcStatus?.health ?? npc.health ?? null,
                maxHealth: npcStatus?.maxHealth ?? npc.maxHealth ?? null,
                statusEffects: normalizeStatusEffects(npc || npcStatus),
                inventory: npcInventory,
                dispositionsTowardsPlayer,
                skills,
                personality,
                needBars,
                importantMemories,
                selectedImportantMemories: []
            });
        }
    }

    const party = [];
    if (currentPlayer && typeof currentPlayer.getPartyMembers === 'function') {
        const memberIds = currentPlayer.getPartyMembers();
        for (const memberId of memberIds) {
            const member = players.get(memberId);
            if (!member) {
                continue;
            }
            const memberStatus = typeof member.getStatus === 'function' ? member.getStatus() : null;
            const memberInventory = Array.isArray(memberStatus?.inventory)
                ? memberStatus.inventory.map(item => mapItemContext(item, item?.equippedSlot || null)).filter(Boolean)
                : [];
            const personality = extractPersonality(memberStatus, member);
            const dispositionsTowardsPlayer = computeDispositionsTowardsPlayer(member);
            const skills = collectActorSkills(memberStatus, member);
            const needBars = collectNeedBarsForPrompt(member, memberStatus, { includePlayerOnly: !member.isNPC });
            const importantMemories = sanitizeImportantMemories(
                memberStatus?.importantMemories
                || member?.importantMemories
                || []
            );

            party.push({
                id: member.id,
                name: memberStatus?.name || member.name || 'Unknown Ally',
                description: memberStatus?.description || member.description || '',
                class: memberStatus?.class || member.class || null,
                race: memberStatus?.race || member.race || null,
                level: memberStatus?.level || member.level || null,
                health: memberStatus?.health ?? member.health ?? null,
                maxHealth: memberStatus?.maxHealth ?? member.maxHealth ?? null,
                statusEffects: normalizeStatusEffects(member || memberStatus),
                inventory: memberInventory,
                personality,
                skills,
                dispositionsTowardsPlayer,
                needBars,
                importantMemories,
                selectedImportantMemories: []
            });
        }
    }

    if (!npcs.length && party.length) {
        npcs.push(...party.map(member => ({ ...member })));
    }

    const itemsInScene = [];
    if (location) {
        for (const thing of things.values()) {
            const metadata = thing.metadata || {};
            if (metadata.locationId === location.id && !metadata.ownerId) {
                const mappedThing = mapItemContext(thing);
                if (mappedThing) {
                    itemsInScene.push(mappedThing);
                }
            }
        }
    }

    const historyEntries = Array.isArray(chatHistory) ? chatHistory : [];
    const summaryConfig = config?.summaries || {};
    const rawMaxUnsummarized = Number(summaryConfig.max_unsummarized_log_entries);
    const maxUnsummarizedEntries = Number.isInteger(rawMaxUnsummarized) && rawMaxUnsummarized > 0
        ? rawMaxUnsummarized
        : 0;
    const rawMaxSummarized = Number(summaryConfig.max_summarized_log_entries);
    const maxSummarizedEntries = Number.isInteger(rawMaxSummarized) && rawMaxSummarized > 0
        ? rawMaxSummarized
        : 0;

    const formatSeenBySuffix = (entry) => {
        if (!entry || entry.travel) {
            return '';
        }
        const metadata = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : null;
        const seen = Array.isArray(metadata?.npcNames) ? metadata.npcNames : null;
        if (!seen || !seen.length) {
            return '';
        }
        return ` [Seen by ${seen.join(', ')}]`;
    };

    const formatLocationSuffix = (entry) => {
        if (!entry) {
            return '';
        }

        const isPlayerAction = entry.type === 'player-action';
        const isRandomAction = entry.type === 'random-event' || entry.randomEvent === true;
        const isNpcAction = entry.isNpcTurn === true;
        if (!isPlayerAction && !isRandomAction && !isNpcAction) {
            return '';
        }

        const rawLocationId = typeof entry.locationId === 'string' && entry.locationId.trim()
            ? entry.locationId.trim()
            : (typeof entry.metadata?.locationId === 'string' && entry.metadata.locationId.trim()
                ? entry.metadata.locationId.trim()
                : '');
        if (!rawLocationId) {
            return '';
        }

        let locationRecord = gameLocations.get(rawLocationId);
        if (!locationRecord && typeof Location?.get === 'function') {
            try {
                locationRecord = Location.get(rawLocationId) || null;
            } catch (_) {
                locationRecord = null;
            }
        }

        const locationDetails = typeof locationRecord?.getDetails === 'function'
            ? locationRecord.getDetails()
            : null;
        const locationName = locationDetails?.name || locationRecord?.name || '';
        if (!locationName) {
            return '';
        }

        return ` [location: ${locationName}]`;
    };

    const relevantHistory = historyEntries.filter(entry => entry && (entry.content || entry.summary));

    const totalHistoryLimit = maxUnsummarizedEntries + maxSummarizedEntries;
    const limitedHistory = totalHistoryLimit > 0
        ? relevantHistory.slice(-totalHistoryLimit)
        : [];

    const tailCount = maxUnsummarizedEntries > 0
        ? Math.min(maxUnsummarizedEntries, limitedHistory.length)
        : 0;
    const tailEntries = tailCount > 0
        ? limitedHistory.slice(-tailCount)
        : [];
    const summaryCandidates = tailCount > 0
        ? limitedHistory.slice(0, -tailCount)
        : limitedHistory;

    const summaryLines = [];
    for (const entry of summaryCandidates) {
        if (!entry) {
            continue;
        }
        const summaryText = typeof entry.summary === 'string' ? entry.summary.trim() : '';
        if (!summaryText) {
            continue;
        }
        const suffix = formatSeenBySuffix(entry);
        const locationSuffix = formatLocationSuffix(entry);
        summaryLines.push(`${summaryText}${locationSuffix}${suffix}`);
    }

    const tailLines = [];
    for (const entry of tailEntries) {
        if (!entry) {
            continue;
        }
        const contentText = typeof entry.content === 'string' ? entry.content.trim() : '';
        if (!contentText) {
            continue;
        }
        const role = typeof entry.role === 'string' && entry.role.trim()
            ? entry.role.trim()
            : 'system';
        const suffix = formatSeenBySuffix(entry);
        const locationSuffix = formatLocationSuffix(entry);
        tailLines.push(`[${role}] ${contentText}${locationSuffix}${suffix}`);
    }

    const combinedHistoryLines = summaryLines.concat(tailLines);
    const gameHistory = combinedHistoryLines.length
        ? combinedHistoryLines.join('\n')
        : 'No significant prior events.';

    const experiencePointValues = getExperiencePointValues();

    const context = {
        setting: settingContext,
        config: config,
        gameHistory,
        currentRegion: currentRegionContext,
        currentLocation: currentLocationContext,
        currentPlayer: currentPlayerContext,
        npcs,
        party,
        itemsInScene,
        dispositionTypes: dispositionTypesForPrompt,
        dispositionRange: dispositionDefinitions?.range || {},
        needBarDefinitions,
        gearSlots: gearSlotNamesForPrompt,
        equipmentSlots: equipmentSlotTypesForPrompt,
        attributes: attributeEntriesForPrompt,
        attributeDefinitions: attributeDefinitionsForPrompt,
        rarityDefinitions: Thing.getAllRarityDefinitions(),
        experiencePointValues,
        generatedThingRarity,
        worldOutline
    };

    populateNpcSelectedMemoriesSync(context);

    return context;
}

module.exports = {
    initialize: (dependencies) => {
        config = dependencies.config;
        getChatHistory = dependencies.chatHistory;
        getCurrentPlayer = dependencies.currentPlayer;
        getGameLocations = dependencies.gameLocations;
        getRegions = dependencies.regions;
        getThings = dependencies.things;
        getPlayers = dependencies.players;
        getSkills = dependencies.skills;
        getCurrentTurnToken = dependencies.currentTurnToken;
        getCurrentSetting = dependencies.currentSetting;
        Player.setCurrentPlayerResolver(getCurrentPlayer);
    },
    buildBasePromptContext,
    buildSlimmedPlayerActionContext,
};

function buildSlimmedPlayerActionContext({ locationOverride = null } = {}) {
    const currentPlayer = getCurrentPlayer();
    const chatHistory = getChatHistory();
    const gameLocations = getGameLocations();
    const players = getPlayers();

    const activeSetting = getActiveSettingSnapshot();
    const settingDescription = describeSettingForPrompt(activeSetting);
    const settingContext = buildSettingPromptContext(activeSetting, { descriptionFallback: settingDescription });

    let location = locationOverride;
    if (!location && currentPlayer && currentPlayer.currentLocation) {
        try {
            location = Location.get(currentPlayer.currentLocation);
        } catch (error) {
            console.warn('Failed to resolve current player location for slim context:', error.message);
        }
    }

    const locationDetails = location ? location.getDetails() : null;
    const playerStatus = currentPlayer && typeof currentPlayer.getStatus === 'function'
        ? currentPlayer.getStatus()
        : null;

    const normalizeStatusEffects = value => {
        let source = [];
        if (!value) return [];

        if (typeof value.getStatusEffects === 'function') source = value.getStatusEffects();
        else if (Array.isArray(value.statusEffects)) source = value.statusEffects;
        else if (Array.isArray(value)) source = value;

        return source.map(entry => {
            if (typeof entry === 'string' && entry.trim()) return { description: entry.trim(), duration: 1 };
            if (typeof entry === 'object' && entry) {
                const description = (entry.description || entry.text || entry.name || '').trim();
                if (!description) return null;
                const duration = Number.isFinite(entry.duration) ? Math.floor(entry.duration) : 1;
                return { description, duration: Math.max(0, duration) };
            }
            return null;
        }).filter(Boolean);
    };

    const exitSummaries = [];
    if (locationDetails && locationDetails.exits) {
        for (const [, exitInfo] of Object.entries(locationDetails.exits)) {
            if (exitInfo) exitSummaries.push({ name: exitInfo.name });
        }
    }

    const currentLocationContext = {
        name: locationDetails?.name || location?.name || 'Unknown Location',
        description: locationDetails?.description || location?.description || 'No description available.',
        exits: exitSummaries
    };

    const mapItemContext = (item) => {
        if (!item) return null;
        return {
            name: item.name || 'Unknown Item',
            description: item.description || '',
        };
    };

    const mapSkillContext = (skillsSource) => {
        if (!skillsSource) return [];
        const entries = skillsSource instanceof Map ? Array.from(skillsSource.entries()) : Object.entries(skillsSource);
        return entries.map(([name, rank]) => ({ name, value: Number.isFinite(rank) ? rank : null }));
    };

    const currentPlayerInventory = playerStatus?.inventory?.map(item => mapItemContext(item)).filter(Boolean) || [];
    const currentPlayerSkills = mapSkillContext(playerStatus?.skills || (currentPlayer ? currentPlayer.getSkills() : null));

    const currentPlayerContext = {
        name: playerStatus?.name || currentPlayer?.name || 'Adventurer',
        description: playerStatus?.description || currentPlayer?.description || '',
        health: playerStatus?.health ?? 'Unknown',
        maxHealth: playerStatus?.maxHealth ?? 'Unknown',
        level: playerStatus?.level ?? currentPlayer?.level ?? 'Unknown',
        class: playerStatus?.class || currentPlayer?.class || 'Adventurer',
        race: playerStatus?.race || currentPlayer?.race || 'Unknown',
        inventory: currentPlayerInventory,
        skills: currentPlayerSkills,
    };

    const npcs = [];
    if (location) {
        const npcIds = location.npcIds || locationDetails?.npcIds || [];
        for (const npcId of npcIds) {
            const npc = players.get(npcId);
            if (!npc) continue;
            const npcStatus = npc.getStatus?.() || {};
            npcs.push({
                name: npcStatus.name || npc.name,
                description: npcStatus.description || npc.description,
            });
        }
    }

    const summaryConfig = config?.summaries || {};
    const maxUnsummarized = summaryConfig.max_unsummarized_log_entries || 10;
    const maxSummarized = summaryConfig.max_summarized_log_entries || 5;

    const gameHistory = chatHistory
        .slice(-(maxUnsummarized + maxSummarized))
        .map(entry => {
            if (!entry) return '';
            const content = entry.summary || entry.content || '';
            return `[${entry.role || 'system'}] ${content.trim()}`;
        })
        .filter(Boolean)
        .join('\n') || 'No significant prior events.';

    return {
        setting: {
            name: settingContext.name,
            description: settingContext.description,
        },
        gameHistory,
        currentLocation: currentLocationContext,
        currentPlayer: currentPlayerContext,
        npcs,
        config: {
            ai: {
                model: config.ai.model,
            }
        }
    };
}
