# CYOA AI RPG System Documentation

## Table of Contents
1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Dice System](#dice-system)
5. [Combat System](#combat-system)
6. [Success Rolls & Mechanics](#success-rolls--mechanics)
7. [Storage & Persistence](#storage--persistence)
8. [NPC Generation](#npc-generation)
9. [AI Integration](#ai-integration)
10. [Game Flow & Main Loop](#game-flow--main-loop)
11. [Additional Systems](#additional-systems)

---

## Project Overview

This is an AI-powered Choose Your Own Adventure (CYOA) RPG system that combines traditional tabletop RPG mechanics (D&D-style) with AI-driven narrative generation. The game dynamically generates regions, locations, NPCs, and events based on player actions while maintaining consistent game balance through deterministic mechanics.

---

## Technology Stack

**Backend:**
- **Runtime**: Node.js (JavaScript ES13)
- **Framework**: Express.js
- **WebSocket**: `ws` library for real-time updates
- **Templating**: Nunjucks (for AI prompts and HTML)
- **Configuration**: YAML (js-yaml)
- **HTTP Client**: Axios (with custom metrics)

**Frontend:**
- Vanilla JavaScript (no frameworks)
- Cytoscape.js for region map visualization
- Server-Sent Events (SSE) for streaming updates

**Storage:**
- File system-based JSON persistence
- No database required

---

## Project Structure

```
CYOA_AI/
├── server.js (563 KB)              # Express server, region/location generation orchestration
├── api.js (630 KB)                 # Core API endpoints, combat, NPC handling, event processing
├── Player.js (142 KB)              # Player/NPC class with stats, skills, inventory, party
├── Location.js (30 KB)             # Location entities with NPCs, items, exits
├── Region.js (22 KB)               # Region/map management
├── Thing.js (31 KB)                # Items and scenery objects
├── Events.js (179 KB)              # Event processing and game state changes
├── nunjucks_dice.js                # Dice rolling system
├── RealtimeHub.js                  # WebSocket event streaming
├── config.default.yaml             # Main configuration file
│
├── prompts/                        # Nunjucks templates for AI prompts
│   ├── base-context.xml.njk        # Main system prompt with world state
│   ├── player-action.xml.njk       # Player action processing
│   ├── region-generator*.xml.njk   # Region generation prompts
│   ├── location-generator*.xml.njk # Location generation prompts
│   ├── location-generator-npcs.xml.njk  # NPC generation
│   ├── npc_memory_gen.xml.njk      # NPC memory generation
│   └── ...                         # Image generation, event checking, etc.
│
├── defs/                           # YAML game balance definitions
│   ├── attributes.yaml             # Character attributes (Str, Dex, Con, etc.)
│   ├── rarities.yaml               # Item rarity multipliers
│   ├── experience_point_values.yaml # XP awards
│   ├── dispositions.yaml           # NPC relationship types
│   └── needs.yaml                  # Food, rest, mana system
│
├── saves/                          # Player save files (directory per save)
├── autosaves/                      # Automatic save files
├── logs/                           # AI prompt/response transcripts
├── public/                         # Browser UI assets
├── views/                          # Server-rendered Nunjucks views
└── slashcommands/                  # Administrative game commands
```

**Total**: 63 JavaScript files + YAML config + Nunjucks templates

---

## Dice System

### File Location
`/home/user/CYOA_AI/nunjucks_dice.js` (172 lines)

### Supported Notation

The dice system uses standard tabletop RPG notation with extensions:

```javascript
// Basic rolls
'3d6'           // Roll three 6-sided dice
'1d20'          // Roll one 20-sided die
'd6'            // Roll one 6-sided die (count defaults to 1)

// Keep/Drop mechanics
'4d6kh3'        // Roll 4d6, keep highest 3
'4d6kl2'        // Roll 4d6, keep lowest 2
'4d6dh1'        // Roll 4d6, drop highest 1
'4d6dl1'        // Roll 4d6, drop lowest 1 (standard D&D stat generation)

// Rerolls
'd6r1'          // Reroll on 1
'd6r<3'         // Reroll if less than 3
'd10r>8'        // Reroll if greater than 8

// Exploding dice (reroll and add on max)
'd6!'           // Explode on 6 (keep rolling on max)
'd10!>9'        // Explode on 9 or 10

// Advantage/Disadvantage (D&D 5e)
'd20adv'        // Roll 2d20, keep highest
'd20dis'        // Roll 2d20, keep lowest

// Modifiers
'3d6+5'         // Roll 3d6 and add 5
'd20-2'         // Roll 1d20 and subtract 2
```

### RNG System

- **Default**: Uses `Math.random()`
- **Seeded**: Optional deterministic RNG via Linear Congruential Generator
  ```javascript
  rollDice('3d6', { seed: 12345 }) // Reproducible rolls
  ```

### Implementation Details

**Roll Processing Flow:**
1. Parse notation into components (count, sides, modifiers, special rules)
2. Generate initial rolls
3. Apply reroll logic (if specified)
4. Handle explosions (roll again on max face, add to pool)
5. Apply keep/drop filters
6. Sum used dice and add modifiers
7. Return result object:
   ```javascript
   {
       total: 15,              // Final sum
       rolls: [3, 6, 4, 2],    // All dice rolled
       modifier: 0,            // Added/subtracted value
       sides: 6,               // Die size
       detail: "3, 6̶, 4, 2"  // Visual with strikethrough for dropped
   }
   ```

**Safety Features:**
- Maximum 1000 total draws (prevents infinite explosion loops)
- Tracks which dice are used vs. dropped
- Strikethrough formatting for dropped dice in detail string

### Integration

**Nunjucks Filter:**
```njk
{{ '3d6' | roll_detail("optional_seed") }}
```

**JavaScript Usage:**
```javascript
const diceModule = require('./nunjucks_dice.js');
const result = diceModule.rollDice('1d20');
const hitRoll = result.total;
```

**Combat Integration:**
- Used in `computeAttackOutcome()` for attack rolls: `diceModule.rollDice('1d20')`
- Hit determination: `dieRoll + attackBonus vs hitDifficulty`

---

## Combat System

### File Location
`/home/user/CYOA_AI/api.js` - `computeAttackOutcome()` function (lines 2977-3110+)

### Combat Architecture

D&D-style skill/attribute-based combat with AI-assisted resolution. Combat is resolved in two phases:
1. **AI Detection**: AI determines if an attack occurred and identifies participants
2. **Mechanical Resolution**: Server calculates hit/miss and damage using deterministic formulas

### Combat Resolution Flow

```
Player Action → AI Detects Attack → computeAttackOutcome() → Apply Damage → Update State
```

### Attack Resolution Formula

#### 1. Hit Roll (d20 + bonuses)
```javascript
const rollResult = diceModule.rollDice('1d20');
const dieRoll = rollResult.total;

const attackBonus =
    attackSkillValue +           // Skill in weapon type (e.g., "Melee" skill)
    attackAttributeModifier +    // Str for melee, Dex for ranged
    circumstanceModifier;        // Situational bonuses

const hitRollTotal = dieRoll + attackBonus;
```

#### 2. Hit Difficulty (target number)
```javascript
const hitDifficulty =
    10 +                         // Base difficulty
    defenderLevel +              // Target's level
    bestDefenseSkill;            // Highest of: Evade, Deflect, Defense skills
```

#### 3. Hit Degree (how much you succeed/fail by)
```javascript
const hitDegreeRaw = (hitRollTotal - hitDifficulty) / 5;

// Examples:
// Beat difficulty by 0-4: hitDegree = 0 (barely hit)
// Beat difficulty by 5-9: hitDegree = 1 (solid hit)
// Beat difficulty by 10-14: hitDegree = 2 (critical)
// Miss by 0-4: hitDegree = 0 (glancing blow, still does some damage)
// Miss by 5+: hitDegree = -1 (complete miss)
```

#### 4. Damage Calculation
```javascript
const baseDamage = weaponBaseDamage * rarityMultiplier;

const unmitigatedDamage =
    1 +                          // Minimum 1 damage on any hit
    baseDamage * (0.5 + hitDegreeRaw) + // Scales with hit quality
    damageAttributeModifier;     // Str for melee, varies for other attacks

const mitigatedDamage = unmitigatedDamage - toughnessAttributeModifier;

const finalDamage = Math.max(0, Math.floor(mitigatedDamage));
```

### Rarity Multipliers

From `/home/user/CYOA_AI/defs/rarities.yaml`:

| Rarity | Damage Multiplier | Example |
|--------|------------------|---------|
| Junk | 0.75x | Rusty sword does 75% damage |
| Common | 1.0x | Standard weapon |
| Uncommon | 1.25x | Quality weapon |
| Rare | 1.5x | Exceptional weapon |
| Epic | 2.0x | Legendary weapon |
| Legendary | 3.0x | Artifact-tier weapon |
| Artifact | 4.0x | Ultimate weapon |

### Defense System

**Defense Skills:**
- Player/NPC automatically uses their best defense skill
- Options: Evade, Deflect, Defense, or any custom defensive skill
- No roll required (passive defense adds to hit difficulty)

**Damage Mitigation:**
- Toughness attribute (usually Constitution) reduces incoming damage
- Cannot reduce damage below 0

### Combat State

**Combat Flags:**
```javascript
player.inCombat = true;          // Combat mode active
player.isDead = false;           // Player is alive
npc.isDead = true;               // NPC killed
npc.corpseCountdown = 3;         // Turns until corpse removed
```

**Health Management:**
```javascript
player.modifyHealth(-damage, 'attack damage');  // Take damage
player.modifyHealth(+healing, 'healing potion'); // Heal
```

### Example Combat Calculation

**Scenario:** Level 5 warrior with longsword attacks Level 4 goblin

```javascript
// Attacker stats
attackerLevel = 5
attackSkill = 3 (Melee skill)
attackAttribute = 2 (Strength modifier)
weaponBaseDamage = 8 (longsword)
weaponRarity = 'common' (1.0x multiplier)

// Defender stats
defenderLevel = 4
bestDefenseSkill = 1 (Evade)
toughness = 1 (Constitution modifier)

// Roll: d20 = 14
hitRollTotal = 14 + 3 + 2 = 19
hitDifficulty = 10 + 4 + 1 = 15
hitDegree = (19 - 15) / 5 = 0.8

// Damage
baseDamage = 8 * 1.0 = 8
unmitigatedDamage = 1 + 8 * (0.5 + 0.8) + 2 = 1 + 10.4 + 2 = 13.4
mitigatedDamage = 13.4 - 1 = 12.4
finalDamage = floor(12.4) = 12 HP
```

### Related Admin Commands

Located in `/home/user/CYOA_AI/slashcommands/`:

- **heal.js**: Restore NPC health to full
- **kill.js**: Instantly kill an NPC
- **incapacitate.js**: Apply status effects to NPCs

---

## Success Rolls & Mechanics

### Skill Checks

The game uses a skill-based success system similar to D&D:

```
d20 + Skill Value + Attribute Modifier + Situational Modifiers
```

### Attribute System

From `/home/user/CYOA_AI/defs/attributes.yaml`:

**Core Attributes:**
- **Strength**: Physical power, melee damage
- **Dexterity**: Agility, ranged attacks, evasion
- **Constitution**: Health, damage resistance (toughness)
- **Intelligence**: Knowledge, magic power
- **Wisdom**: Perception, willpower
- **Charisma**: Social influence, leadership

**Attribute Ratings to Modifiers:**

| Rating | Modifier | Description |
|--------|----------|-------------|
| Poor | -3 to -2 | Well below average |
| Below Average | -1 | Slightly deficient |
| Average | 0 | Typical for level |
| Above Average | +1 | Notably skilled |
| Excellent | +2 to +3 | Exceptional |
| Legendary | +4 to +5 | Superhuman |

### Skill System

**File:** `/home/user/CYOA_AI/Player.js`

Skills are separate from attributes and represent trained abilities:

```javascript
player.skills = [
    { name: 'Melee', value: 5 },
    { name: 'Ranged', value: 3 },
    { name: 'Evade', value: 4 },
    { name: 'Persuasion', value: 6 },
    // ... etc
];
```

**Skill Checks:**
- AI determines when a skill check is needed
- Server calculates: `d20 + skillValue + attributeModifier`
- Success threshold determined by difficulty (usually 10-30)

### Experience & Leveling

**File:** `/home/user/CYOA_AI/defs/experience_point_values.yaml`

**Level-Up Formula:**
```javascript
const xpNeeded = 100 * currentLevel;
const xpRollover = (excessXP * 2) / 3; // 66% of overflow carries over
```

**Example XP Values:**
- Defeat boss: 100 XP
- Complete major quest: 50 XP
- Solve puzzle: 10 XP
- Defeat standard enemy: 5 XP
- Explore new area: 3 XP
- Learn new fact: 1 XP

**Level Benefits:**
- +1 skill point per level
- Attribute increases every few levels
- Increased max health
- New abilities unlocked

### Needs System

**File:** `/home/user/CYOA_AI/defs/needs.yaml`

Players must manage survival needs:

**Need Bars:**
- **Food**: 0-100, decreases -1 per turn
- **Rest**: 0-100, decreases -1 per turn
- **Mana**: 0-100, increases +1 per turn (regenerates)

**Penalties:**
- **Starving** (Food = 0): -10% to all attributes
- **Exhausted** (Rest = 0): -10% to all attributes
- **Mana Depleted**: Cannot cast spells

**Management:**
```javascript
player.modifyNeed('food', +50, 'ate bread');
player.modifyNeed('rest', +80, 'slept in inn');
player.modifyNeed('mana', -20, 'cast fireball');
```

---

## Storage & Persistence

### Architecture

File system-based JSON storage. No database required.

### Save System Files

**File Location:** `/home/user/CYOA_AI/api.js` (lines 13742+)

### Save Directory Structure

```
saves/
├── MySaveGame_2025-01-15_14-30-22/
│   ├── metadata.json          # Save info (timestamp, player name, level)
│   ├── game-state.json        # Complete game state
│   ├── player.json            # Main player data
│   ├── regions.json           # All regions
│   ├── locations.json         # All locations with NPCs/items
│   ├── items.json             # All items/things in world
│   └── npcs.json              # All NPCs with stats/memories
│
└── AnotherSave_2025-01-16_09-15-44/
    └── ...

autosaves/
├── autosave_2025-01-15_14-35-10/
│   └── ... (same structure as saves)
├── autosave_2025-01-15_14-36-42/
└── ... (configurable retention count)
```

### Save API Endpoints

#### Create Save
```javascript
POST /api/save
Body: { saveName: "MySaveGame" }

// Creates timestamped directory: ./saves/MySaveGame_YYYY-MM-DD_HH-MM-SS/
// Saves all game state to JSON files
```

#### Load Save
```javascript
POST /api/load
Body: {
    saveName: "MySaveGame_2025-01-15_14-30-22",
    saveType: "saves"  // or "autosaves"
}

// Restores complete game state from save directory
// Re-initializes all indices and references
```

#### List Saves
```javascript
GET /api/saves?type=saves      // List manual saves
GET /api/saves?type=autosaves  // List autosaves

Response: [
    {
        name: "MySaveGame_2025-01-15_14-30-22",
        timestamp: "2025-01-15T14:30:22.000Z",
        metadata: {
            playerName: "Aragorn",
            level: 5,
            region: "Misty Mountains",
            location: "Goblin Cave"
        }
    },
    ...
]
```

### Autosave System

**Configuration** (`config.default.yaml`):
```yaml
autosaves_to_retain: 20    # Keep last 20 autosaves
```

**Behavior:**
- Runs automatically after every player action
- Creates timestamped save in `./autosaves/` directory
- Deletes oldest autosaves when count exceeds retention limit
- Completely transparent to player

**Trigger Points:**
- After every `/api/chat` request (player action)
- Before processing events (ensures no data loss)
- After NPC turns complete

### Serialization Details

**Custom toJSON() Methods:**
- `Player.toJSON()`: Serializes player/NPC with all nested data
- `Region.toJSON()`: Serializes region with location references
- `Location.toJSON()`: Serializes location with NPC/item IDs
- `Thing.toJSON()`: Serializes items with all properties

**Circular Reference Handling:**
- NPCs reference Locations
- Locations reference Regions
- Items reference Owners
- Uses ID-based references instead of direct object references in JSON

**Restoration:**
- Loads all JSON files
- Reconstructs object instances (`new Player(data)`, etc.)
- Rebuilds indices: `Player.#indexById`, `Player.#indexByName`
- Re-establishes object references

### Logging System

**Directory:** `/home/user/CYOA_AI/logs/`

**Log Rotation:**
- On server start, current logs moved to `/logs_prev/`
- New log files created in `/logs/`

**Log Contents:**
- All AI prompts sent
- All AI responses received
- Request duration and token counts
- Labeled by operation type (e.g., "region_generation", "event_checks")

**Example Log Entry:**
```
[2025-01-15 14:30:22] AI Request (player_action)
Prompt: <system>...</system><user>I attack the goblin</user>
---
[2025-01-15 14:30:25] AI Response (player_action) - 2.8s, 450 tokens
Response: You swing your sword at the goblin...
---
```

---

## NPC Generation

### Overview

NPCs are generated dynamically by AI using structured XML prompts. The system creates fully-featured characters with stats, personality, goals, and memories.

### Generation Pipeline

```
Location Created → AI Generates NPCs (XML) → Parse XML → Create NPC Instances → Generate Memories
```

### NPC Generation Template

**File:** `/home/user/CYOA_AI/prompts/location-generator-npcs.xml.njk`

The AI receives location context and generates NPCs in this XML format:

```xml
<npcs>
  <npc>
    <name>Thorin Ironforge</name>

    <description>
      Thorin is a grizzled dwarven blacksmith in his late 200s with a
      magnificent braided beard. He runs the only smithy in town and is
      known for his exceptional craftsmanship and gruff demeanor.
    </description>

    <shortDescription>Gruff dwarven blacksmith, master craftsman</shortDescription>

    <isHostile>false</isHostile>

    <class>Blacksmith</class>

    <race>Dwarf</race>

    <relativeLevel>1</relativeLevel>  <!-- -3 to +3 relative to location level -->

    <currency>250</currency>  <!-- Gold pieces based on setting norms -->

    <attributes>
      <attribute name="strength">excellent</attribute>
      <attribute name="dexterity">average</attribute>
      <attribute name="constitution">above average</attribute>
      <attribute name="intelligence">average</attribute>
      <attribute name="wisdom">above average</attribute>
      <attribute name="charisma">poor</attribute>
    </attributes>

    <personality>
      <type>ISTJ</type>  <!-- Myers-Briggs or D&D alignment -->

      <traits>None</traits>  <!-- ADHD, autism, anxiety, depression, etc. -->

      <characterArc>
        <shortTerm>Learning to trust outsiders after recent bandit attacks</shortTerm>
        <longTerm>Passing on smithing legacy to worthy apprentice</longTerm>
      </characterArc>

      <goals>
        <goal>Create a legendary weapon to restore family honor</goal>
        <goal>Find rare mithril ore in nearby mountains</goal>
        <goal>Repair the town's defensive walls before winter</goal>
        <goal>Convince son to continue smithing tradition</goal>
      </goals>

      <notes>Has rivalry with town's other craftsmen. Secretly soft-hearted
      despite gruff exterior. War veteran.</notes>
    </personality>

    <healthAttribute>constitution</healthAttribute>
  </npc>
</npcs>
```

### NPC Stat Generation

**Attribute Conversion:**
```javascript
// Text ratings from AI converted to numeric modifiers
const attributeRatings = {
    'poor': -2,
    'below average': -1,
    'average': 0,
    'above average': 1,
    'excellent': 2,
    'legendary': 3
};
```

**Level Calculation:**
```javascript
const npcLevel = locationLevel + relativeLevel;
// Example: Level 5 location, relativeLevel = -1 → NPC is level 4
```

**Health Calculation:**
```javascript
const baseHealth = 20;
const healthAttribute = npc.getAttribute('constitution'); // e.g., +1
const healthPerLevel = 5;
const maxHealth = baseHealth + (npcLevel * healthPerLevel) + (healthAttribute * npcLevel);

// Example: Level 4 NPC, Constitution +1
// maxHealth = 20 + (4 * 5) + (1 * 4) = 20 + 20 + 4 = 44 HP
```

**Skills Generation:**

Generated via separate AI prompt: `/home/user/CYOA_AI/prompts/npc-generate-skills.xml.njk`

AI determines appropriate skills based on class/race:
```xml
<skills>
  <skill name="Smithing" value="8"/>
  <skill name="Melee" value="5"/>
  <skill name="Defense" value="4"/>
  <skill name="Appraise" value="6"/>
</skills>
```

**Abilities Generation:**

Generated via: `/home/user/CYOA_AI/prompts/npc-generate-abilities.xml.njk`

Class/race-specific abilities:
```xml
<abilities>
  <ability>Darkvision</ability>
  <ability>Stone Cunning (bonus to find traps/secrets in stone)</ability>
  <ability>Masterwork Crafting (+2 to all crafted items)</ability>
</abilities>
```

### NPC Memory System

**File:** `/home/user/CYOA_AI/prompts/npc_memory_gen.xml.njk`

NPCs receive 3 initial memories about their role and location:

```xml
<memories>
  <npcMemories npc="Thorin Ironforge">
    <memory>Forged first blade at age 50, father declared me worthy of family anvil.</memory>
    <memory>Lost wife to orc raid ten years ago, still keeps her favorite hammer.</memory>
    <memory>Town mayor commissioned new gates last month, biggest project in years.</memory>
  </npcMemories>
</memories>
```

**Memory Update Triggers:**
- NPC changes locations
- Player has significant interaction with NPC
- Important event occurs in NPC's presence
- Configurable: AI extracts key events from recent gameplay

**Important Memory Tracking:**
```javascript
player.importantMemories = [
    { npc: "Thorin Ironforge", memory: "Player saved my life from bandits" },
    { npc: "Elara the Mage", memory: "Player helped me find stolen spellbook" }
];
```

### NPC Lifecycle Management

**Creation:**
```javascript
const npc = new Player({
    isNPC: true,
    name: 'Thorin Ironforge',
    level: 5,
    // ... all generated stats
});
location.addNPC(npc);
```

**Death:**
```javascript
npc.isDead = true;
npc.corpseCountdown = 3;  // Remove after 3 turns

// Each turn:
if (npc.isDead && npc.corpseCountdown > 0) {
    npc.corpseCountdown--;
    if (npc.corpseCountdown === 0) {
        location.removeNPC(npc);
    }
}
```

**Party Members:**
```javascript
player.partyMembers.push(npc);  // NPC joins party
npc.followsPlayer = true;
// NPC now moves with player to new locations
```

### NPC Autonomous Behavior

**Configuration** (`config.default.yaml`):
```yaml
npc_turns:
  enabled: true
  maxNpcsToAct: 1           # Max NPCs taking actions per turn
  npcTurnFrequency: 0.3     # 30% chance per NPC per turn

combat_npc_turns:
  enabled: true
  maxNpcsToAct: 2           # More NPCs act during combat
  npcTurnFrequency: 1.0     # 100% chance during combat
```

**NPC Turn Flow:**
1. Check if NPC should act (random chance based on frequency)
2. Generate AI prompt with NPC's perspective and goals
3. AI determines NPC action
4. Process NPC action same as player action (events, combat, etc.)
5. Stream NPC action to player's UI
6. Update NPC memory with action taken

**Example NPC Action:**
```
[Thorin Ironforge hammers a glowing piece of metal on his anvil, sparks
flying. He glances at you briefly, grunts, then returns to his work.]
```

---

## AI Integration

### Overview

The system uses OpenAI-compatible API endpoints to generate all narrative content, NPCs, locations, and interpret player actions.

### AI Configuration

**File:** `/home/user/CYOA_AI/config.default.yaml`

```yaml
ai:
  endpoint: "https://nano-gpt.com/api/v1"
  apiKey: "your-api-key-here"
  model: "zai-org/GLM-4.5-FP8"
  maxTokens: 6000
  temperature: 0.7
  baseTimeoutSeconds: 120
  debug: false  # If true, logs all AI interactions
```

### Supported AI Providers

All providers must use OpenAI-compatible `/v1/chat/completions` endpoint:

| Provider | Endpoint | Notes |
|----------|----------|-------|
| **OpenAI** | https://api.openai.com/v1 | GPT-4, GPT-3.5-turbo |
| **nano-gpt** | https://nano-gpt.com/api/v1 | Multiple models (GLM, Deepseek, etc.) |
| **LocalAI** | http://localhost:8080/v1 | Self-hosted, any GGUF model |
| **Ollama** | http://localhost:11434/v1 | Local models (Llama, Mistral, etc.) |
| **KoboldCPP** | http://localhost:5001/v1 | Local inference server |
| **LM Studio** | http://localhost:1234/v1 | Local model runner |

### Model Requirements

**Minimum Requirements:**
- Context length: 32k tokens (128k+ recommended)
- Reliable XML output generation
- Complex reasoning ability
- Instruction following

**Recommended Models:**
- GPT-4 Turbo (OpenAI)
- Claude 3.5 Sonnet (via compatible proxy)
- GLM 4.6 (nano-gpt)
- Deepseek 3.1 (nano-gpt)
- Qwen 2.5 72B (local)

**Why Long Context?**
Each AI request includes:
- System prompt with game rules (~3k tokens)
- World state (settings, attributes, rarities, needs) (~2k tokens)
- Current region/location/NPCs (~5k tokens)
- Recent game history (~10k tokens)
- Important memories (~2k tokens)
- Generation instructions (~1k tokens)

Total: ~23k tokens input, 6k tokens output = **29k tokens minimum**

### Prompt Template System

**Directory:** `/home/user/CYOA_AI/prompts/`

All prompts use Nunjucks templating with access to game state:

**Variables Available:**
```njk
{{ player.name }}
{{ player.level }}
{{ location.description }}
{{ region.name }}
{{ npc.personality.goals }}
{{ config.ai.model }}
{{ gameHistory | slice(-10) }}  {# Last 10 messages #}
```

### Key Prompt Templates

#### 1. Base Context (`base-context.xml.njk`)

The foundation prompt included in most AI requests:

```xml
<system>
You are the AI Game Master for an RPG. Your role is to:
1. Interpret player actions and determine outcomes
2. Generate narrative prose responses
3. Detect events that occurred (combat, item pickup, travel, etc.)
4. Maintain narrative consistency with game history

Current Game State:
- Setting: {{ setting }}
- Player: {{ player.name }}, Level {{ player.level }} {{ player.class }}
- Location: {{ location.name }} in {{ region.name }}
- NPCs Present: {% for npc in location.npcs %}{{ npc.name }}{% endfor %}
- Recent History: {{ gameHistory | slice(-5) }}

Game Mechanics Reference:
{{ attributes | yaml }}
{{ rarities | yaml }}
{{ needs | yaml }}
</system>
```

#### 2. Player Action (`player-action.xml.njk`)

Processes player's submitted action:

```xml
<user>
Player Action: "{{ playerMessage }}"

Based on this action:
1. Write a 2-3 paragraph narrative response describing what happens
2. Maintain consistency with character personalities and world state
3. Include sensory details (sights, sounds, smells)
4. Hint at potential consequences if action is risky

Respond in prose, not XML.
</user>
```

#### 3. Event Detection

After narrative generation, system checks for events:

```xml
<user>
Analyze the player action: "{{ playerMessage }}"
And the narrative response: "{{ aiResponse }}"

Did an attack occur? If yes, respond:
<attack_damage>
<attacker>Name of attacker</attacker>
<defender>Name of defender</defender>
<weaponName>Weapon used</weaponName>
<attackEntry>Brief description of attack</attackEntry>
</attack_damage>

Otherwise respond: <attack_damage>none</attack_damage>
</user>
```

**Events Checked** (10+ types):
- `attack_damage` - Combat occurred
- `item_appear` - New item created/found
- `pick_up_item` - Player took item
- `move_new_location` - Travel to new location
- `environmental_status_damage` - Environmental hazard
- `alter_npc` - NPC changed (leveled up, learned skill, etc.)
- `new_exit_discovered` - New path revealed
- `experience_check` - XP award
- `disposition_check` - NPC relationship change
- `death_check` - Character died
- `health_check` - Healing occurred
- `status_effect` - Status applied/removed

#### 4. Region Generation (`region-generator.xml.njk`)

Creates new regions when player explores:

```xml
<user>
Generate a new region connected to: {{ currentRegion.name }}

Requirements:
- Theme/biome different from current region
- {{ config.regions.minLocations }} to {{ config.regions.maxLocations }} locations
- Coherent theme (e.g., "Ancient Ruins", "Dark Forest", "Mountain Pass")
- Difficulty appropriate for level {{ player.level }} (±{{ config.locations.levelVariation }})

Respond with:
<region>
  <name>Region Name</name>
  <description>2-3 sentences describing the region</description>
  <locations>
    <location>
      <name>Location Name</name>
      <levelOffset>-2 to +2</levelOffset>
    </location>
    <!-- ... more locations ... -->
  </locations>
  <exits>
    <exit from="Location A" to="Location B" direction="north"/>
    <!-- ... -->
  </exits>
</region>
</user>
```

#### 5. Location Generation (`location-generator.full.xml.njk`)

Creates detailed locations:

```xml
<user>
Generate location: {{ locationName }} in {{ regionName }}
Base level: {{ baseLevel }}

Generate:
1. Detailed description (3-4 sentences, sensory details)
2. {{ config.locations.maxNpcs }} NPCs (see NPC template format)
3. {{ config.locations.maxItems }} items (weapons, armor, consumables)
4. {{ config.locations.maxScenery }} scenery objects
5. Exits to other locations

<location>
  <description>...</description>
  <npcs>...</npcs>
  <items>...</items>
  <scenery>...</scenery>
  <exits>...</exits>
</location>
</user>
```

#### 6. NPC Generation (`location-generator-npcs.xml.njk`)

See [NPC Generation](#npc-generation) section for full details.

#### 7. Image Generation (Optional)

**Character Portraits** (`player-portrait.xml.njk`):
```xml
Generate portrait of {{ player.name }}:
- Race: {{ player.race }}
- Class: {{ player.class }}
- Description: {{ player.description }}

Style: Fantasy RPG character portrait, detailed, high quality
```

**Item Images** (`item-image.xml.njk`):
```xml
Generate image of {{ item.name }}:
- Description: {{ item.description }}
- Rarity: {{ item.rarity }}

Style: RPG item icon, detailed, isolated on dark background
```

**Location Backgrounds** (`location-image.xml.njk`):
```xml
Generate background for {{ location.name }}:
- Description: {{ location.description }}
- Region: {{ region.name }}

Style: Fantasy landscape, atmospheric, wide angle
```

### AI Request Flow

**File:** `/home/user/CYOA_AI/server.js` (lines 14499+)

```javascript
async function callAI(systemPrompt, userPrompt, options = {}) {
    const requestData = {
        model: config.ai.model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        max_tokens: config.ai.maxTokens,
        temperature: config.ai.temperature
    };

    const response = await axios.post(
        `${config.ai.endpoint}/chat/completions`,
        requestData,
        {
            headers: {
                'Authorization': `Bearer ${config.ai.apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: config.ai.baseTimeoutSeconds * 1000,
            metadata: {
                aiMetricsLabel: options.label || 'generic'
            }
        }
    );

    const aiResponse = response.data.choices[0].message.content;

    // Log to file
    if (config.ai.debug) {
        fs.appendFileSync(
            './logs/ai_transcript.log',
            `[${new Date().toISOString()}] ${options.label}\n` +
            `Prompt: ${systemPrompt}\n${userPrompt}\n` +
            `Response: ${aiResponse}\n\n`
        );
    }

    return aiResponse;
}
```

### Response Parsing

**XML Parsing:**
```javascript
const DOMParser = require('xmldom').DOMParser;

function parseAIResponse(xmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');

    // Extract data
    const npcs = doc.getElementsByTagName('npc');
    const items = doc.getElementsByTagName('item');

    return { npcs, items };
}
```

**Error Handling:**
- Malformed XML: Log warning, retry with clarification prompt
- Missing required fields: Use sensible defaults
- AI refuses task: Log error, notify player

### AI Metrics & Monitoring

**Metrics Labels:**
- `player_action` - Main gameplay responses
- `region_generation` - New region creation
- `location_generation` - Location details
- `npc_generation` - NPC stats/personality
- `event_checks` - Event detection
- `image_generation` - Visual content

**Tracked Metrics:**
- Total tokens used (input + output)
- Response time (seconds)
- Success/failure rate
- Retry count

**Optimization:**
- Concurrent event checking (10 events in parallel)
- Cached context for repeated requests
- Streaming responses for real-time UI updates

---

## Game Flow & Main Loop

### Overview

The game operates as a turn-based loop where player actions trigger AI responses, event processing, and world state updates.

### Main Game Loop

**File:** `/home/user/CYOA_AI/api.js` - POST `/api/chat` endpoint (lines 5431+)

```
┌─────────────────────────────────────────┐
│ 1. INITIALIZATION PHASE                 │
├─────────────────────────────────────────┤
│ - Validate player exists                │
│ - Run autosave (if enabled)             │
│ - Process corpse cleanup                │
│ - Initialize turn state                 │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 2. PLAYER ACTION PHASE                  │
├─────────────────────────────────────────┤
│ - Receive player message                │
│ - Render "player-action.xml.njk"        │
│ - Send to AI for prose response         │
│ - Add response to game log               │
│ - Stream response to client (SSE)       │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 3. EVENT PROCESSING PHASE               │
├─────────────────────────────────────────┤
│ AI checks for events (concurrent):      │
│ ├─ attack_damage (combat)               │
│ ├─ item_appear / pick_up_item           │
│ ├─ move_new_location (travel)           │
│ ├─ environmental_status_damage          │
│ ├─ alter_npc (NPC changes)              │
│ ├─ new_exit_discovered                  │
│ ├─ experience_check (XP gain)           │
│ ├─ disposition_check (NPC attitude)     │
│ └─ ... (10+ event types)                │
│                                          │
│ Apply event effects:                    │
│ ├─ Damage: player.modifyHealth(-amt)    │
│ ├─ Healing: player.modifyHealth(+amt)   │
│ ├─ Items: manage inventory              │
│ ├─ Travel: player.setLocation()         │
│ ├─ XP: player.addExperience()           │
│ ├─ NPC changes: update NPC stats        │
│ └─ Dispositions: track relations        │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 4. LOCATION GENERATION                  │
│    (if new location entered)            │
├─────────────────────────────────────────┤
│ - Check if location is "stub"           │
│ - If stub: renderLocationPrompt()       │
│ - AI generates: description, NPCs,      │
│   items, exits                          │
│ - Parse XML response                    │
│ - Create Location instance              │
│ - Add to region                         │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 5. NPC MEMORY UPDATE                    │
│    (on location change)                 │
├─────────────────────────────────────────┤
│ - Generate memories for NPCs in         │
│   old location                          │
│ - Generate memories for NPCs in         │
│   new location                          │
│ - Update NPC memory stores              │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 6. NPC TURNS PHASE                      │
│    (if enabled)                         │
├─────────────────────────────────────────┤
│ For each NPC in location:               │
│ ├─ Check npcTurnFrequency (random)      │
│ ├─ Generate NPC action prompt           │
│ ├─ AI generates NPC action              │
│ ├─ Process NPC events (same as player)  │
│ ├─ Stream NPC action to client          │
│ └─ Repeat for maxNpcsToAct              │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 7. NEEDS SYSTEM PHASE                   │
├─────────────────────────────────────────┤
│ - Decrease food bar (-1 per turn)       │
│ - Decrease rest bar (-1 per turn)       │
│ - Increase mana bar (+1 per turn)       │
│ - Apply status effects:                 │
│   ├─ Starving (food = 0): -10% attrs   │
│   ├─ Exhausted (rest = 0): -10% attrs  │
│   └─ Mana penalties if depleted         │
│ - Track need bar history                │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 8. DISPOSITION UPDATES PHASE            │
├─────────────────────────────────────────┤
│ - Apply disposition changes from events │
│ - Track: friendship, romance, trust,    │
│   respect                               │
│ - Update disposition history per NPC    │
│ - Slowly drift back to neutral          │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 9. COMPLETION PHASE                     │
├─────────────────────────────────────────┤
│ - Mark player action as processed       │
│ - Stream "complete" event to client     │
│ - Run autosave (if enabled)             │
│ - Process NPC corpses (cleanup)         │
└─────────────────────────────────────────┘
              ↓
         [Wait for next player action]
```

### Turn-Based Mechanics

**Turn Definition:**
One turn = one player action and all resulting consequences

**Turn Costs:**
- Movement: 1 turn
- Combat action: 1 turn
- Conversation: 1 turn
- Resting: 1 turn (restores rest bar)
- Eating: 1 turn (restores food bar)

**Turn Effects:**
```javascript
// Each turn:
player.modifyNeed('food', -1, 'time passing');
player.modifyNeed('rest', -1, 'time passing');
player.modifyNeed('mana', +1, 'natural regeneration');

// Check thresholds:
if (player.getNeed('food') === 0) {
    player.addStatusEffect('Starving', { attributePenalty: 0.1 });
}
```

### Event Processing System

**File:** `/home/user/CYOA_AI/Events.js` (179 KB)

**Event Structure:**
```javascript
const eventHandlers = {
    'attack_damage': {
        // 1. Parse AI response
        parse: (aiResponse) => {
            // Extract: attacker, defender, weapon, description
            return { attacker, defender, weaponName, attackEntry };
        },

        // 2. Handle event
        handle: (eventData, gameState) => {
            const outcome = computeAttackOutcome(eventData);
            defender.modifyHealth(-outcome.damage);
            return outcome;
        },

        // 3. Post-process (optional)
        postProcess: (outcome, gameState) => {
            if (outcome.damage > 50) {
                return {
                    message: 'Massive damage!',
                    xpBonus: 10
                };
            }
        }
    },

    'experience_check': {
        parse: (aiResponse) => {
            // Extract: amount, reason
            return { xp: 10, reason: 'defeated goblin' };
        },

        handle: ({ xp, reason }, gameState) => {
            player.addExperience(xp, reason);
            return { gained: xp };
        }
    },

    // ... 10+ more event types
};
```

**Concurrent Event Checking:**

```javascript
// Config: events_to_check_concurrently = 10

const eventChecks = [
    checkEvent('attack_damage'),
    checkEvent('item_appear'),
    checkEvent('move_new_location'),
    // ... 7 more
];

const results = await Promise.all(eventChecks); // Run in parallel
```

### State Management

**Player State Updates:**
```javascript
// Centralized state modification
player.modifyHealth(amount, reason);
player.modifyNeed(needName, amount, reason);
player.addExperience(xp, reason);
player.setLocation(newLocation);
player.addItem(item);
player.removeItem(item);
player.equipItem(item, slot);
player.addStatusEffect(name, data);
player.removeStatusEffect(name);
```

**NPC State Updates:**
```javascript
npc.modifyHealth(-damage, 'player attack');
npc.setDisposition('friendship', +10, 'player helped');
npc.addMemory('Player saved me from bandits');
npc.learnSkill('Perception', 1);
```

**World State Updates:**
```javascript
location.addNPC(npc);
location.removeNPC(npc);
location.addItem(item);
location.addExit(direction, targetLocation);
region.addLocation(location);
```

### Real-Time Client Updates

**File:** `/home/user/CYOA_AI/RealtimeHub.js`

**WebSocket Events Emitted:**

```javascript
// Player action result
ws.send({
    type: 'chat-response',
    content: 'You swing your sword...',
    requestId: '12345'
});

// Combat result
ws.send({
    type: 'combat-outcome',
    attacker: 'You',
    defender: 'Goblin',
    damage: 12,
    hit: true
});

// NPC turn
ws.send({
    type: 'npc-turn',
    npc: 'Thorin Ironforge',
    action: 'Thorin hammers at his anvil...'
});

// Status update
ws.send({
    type: 'status-update',
    player: {
        health: 45,
        maxHealth: 60,
        level: 5,
        xp: 234,
        food: 67,
        rest: 42,
        mana: 88
    }
});

// Image generated
ws.send({
    type: 'image-complete',
    url: '/images/portrait_12345.png',
    imageType: 'portrait'
});

// Turn complete
ws.send({
    type: 'complete',
    requestId: '12345'
});
```

### Configuration Tuning

**File:** `/home/user/CYOA_AI/config.default.yaml`

**Region Generation:**
```yaml
regions:
  minLocations: 2        # Minimum locations per region
  maxLocations: 3        # Maximum locations per region
```

**Location Generation:**
```yaml
locations:
  maxNpcs: 4             # Max NPCs per location
  maxHostiles: 4         # Max hostile NPCs
  maxItems: 4            # Max items to generate
  maxScenery: 4          # Max scenery objects
  levelVariation: 3      # Location level can be ±3 from region
```

**NPC Behavior:**
```yaml
npc_turns:
  enabled: true
  maxNpcsToAct: 1        # Max NPCs acting per turn (non-combat)
  npcTurnFrequency: 0.3  # 30% chance each NPC acts

combat_npc_turns:
  enabled: true
  maxNpcsToAct: 2        # More NPCs act during combat
  npcTurnFrequency: 1.0  # 100% chance during combat
```

**Performance:**
```yaml
events_to_check_concurrently: 10  # Parallel event checking

check_move_plausibility: unexplored_locations  # Options:
  # - always: Check all moves
  # - unexplored_locations: Only check new locations
  # - never: Trust AI completely
```

**Autosave:**
```yaml
autosaves_to_retain: 20   # Keep last 20 autosaves
```

---

## Additional Systems

### Skills System

**File:** `/home/user/CYOA_AI/Player.js`

**Skill Structure:**
```javascript
player.skills = [
    { name: 'Melee', value: 5, attribute: 'strength' },
    { name: 'Ranged', value: 3, attribute: 'dexterity' },
    { name: 'Evade', value: 4, attribute: 'dexterity' },
    { name: 'Deflect', value: 2, attribute: 'dexterity' },
    { name: 'Defense', value: 3, attribute: 'constitution' },
    { name: 'Persuasion', value: 6, attribute: 'charisma' },
    { name: 'Intimidation', value: 2, attribute: 'strength' },
    { name: 'Stealth', value: 5, attribute: 'dexterity' },
    { name: 'Perception', value: 4, attribute: 'wisdom' },
    { name: 'Magic', value: 7, attribute: 'intelligence' }
];
```

**Skill Checks:**
```javascript
function skillCheck(player, skillName, difficulty) {
    const skill = player.getSkill(skillName);
    const attribute = player.getAttribute(skill.attribute);
    const roll = rollDice('1d20');

    const total = roll.total + skill.value + attribute.modifier;
    const success = total >= difficulty;

    return { success, total, difficulty };
}
```

**Skill Improvement:**
- +1 skill point per level
- Player chooses which skills to improve
- AI can grant skill increases for exceptional use

### Abilities System

**Ability Structure:**
```javascript
player.abilities = [
    { name: 'Second Wind', description: 'Heal 1d10 + level once per rest' },
    { name: 'Action Surge', description: 'Take extra action in combat' },
    { name: 'Darkvision', description: 'See in darkness' }
];
```

**Ability Sources:**
- Class: Fighter, Wizard, Rogue, etc.
- Race: Elf, Dwarf, Human, etc.
- Items: Magical equipment
- Achievements: Quest rewards

### Inventory System

**File:** `/home/user/CYOA_AI/Player.js`

**Inventory Structure:**
```javascript
player.inventory = [
    {
        name: 'Longsword',
        type: 'weapon',
        rarity: 'uncommon',
        baseDamage: 8,
        damageAttribute: 'strength',
        attackSkill: 'melee',
        weight: 3,
        value: 150
    },
    {
        name: 'Health Potion',
        type: 'consumable',
        effect: 'heal',
        amount: '2d4+2',
        weight: 0.5,
        value: 50
    }
];

player.gear = {
    weapon: { name: 'Longsword', ... },
    armor: { name: 'Chainmail', ... },
    shield: null,
    helmet: null,
    gloves: null,
    boots: null,
    ring1: null,
    ring2: null,
    amulet: null
};
```

**Item Management:**
```javascript
player.addItem(item);                // Add to inventory
player.removeItem(itemName);         // Remove from inventory
player.equipItem(item, 'weapon');    // Equip to slot
player.unequipItem('weapon');        // Unequip slot
player.useItem(itemName);            // Use consumable
```

**Weight/Encumbrance:**
```javascript
const totalWeight = player.inventory.reduce((sum, item) => sum + item.weight, 0);
const maxWeight = player.getAttribute('strength').modifier * 15;

if (totalWeight > maxWeight) {
    player.addStatusEffect('Encumbered', { movementPenalty: 0.5 });
}
```

### Disposition System

**File:** `/home/user/CYOA_AI/defs/dispositions.yaml`

**Disposition Types:**
```yaml
dispositions:
  - name: romantic_interest
    description: "Romantic attraction to player"
    range: [-100, 100]

  - name: platonic_friendship
    description: "Platonic friendship level"
    range: [-100, 100]

  - name: trust
    description: "How much NPC trusts player"
    range: [-100, 100]

  - name: respect
    description: "How much NPC respects player"
    range: [-100, 100]

  - name: loyalty
    description: "Willingness to follow/help player"
    range: [-100, 100]
```

**Tracking:**
```javascript
npc.dispositions = {
    'romantic_interest': 25,
    'platonic_friendship': 60,
    'trust': 40,
    'respect': 75,
    'loyalty': 50
};

// Modify disposition
npc.setDisposition('friendship', +10, 'player helped in combat');

// Check disposition
if (npc.getDisposition('loyalty') > 50) {
    // NPC will join party
}
```

**Disposition Changes:**
- AI detects disposition-affecting actions
- Slow drift back to neutral over time
- History tracked for narrative callbacks

### Status Effects

**Status Structure:**
```javascript
player.statusEffects = [
    {
        name: 'Poisoned',
        duration: 5,               // Turns remaining
        damagePerTurn: '1d4',
        attributePenalty: 0.1,     // -10% to all attributes
        removable: true
    },
    {
        name: 'Blessed',
        duration: 10,
        attackBonus: 2,
        defenseBonus: 2,
        removable: true
    },
    {
        name: 'Starving',
        duration: -1,              // Permanent until condition met
        attributePenalty: 0.1,
        removable: false           // Must eat to remove
    }
];
```

**Effect Processing:**
```javascript
// Each turn:
for (const effect of player.statusEffects) {
    // Apply effect
    if (effect.damagePerTurn) {
        const damage = rollDice(effect.damagePerTurn).total;
        player.modifyHealth(-damage, effect.name);
    }

    // Decrement duration
    if (effect.duration > 0) {
        effect.duration--;
        if (effect.duration === 0) {
            player.removeStatusEffect(effect.name);
        }
    }
}
```

**Common Effects:**
- Poisoned: Damage over time
- Bleeding: Damage over time, stacks
- Stunned: Cannot act
- Blind: Attack penalty
- Charmed: AI controls character
- Blessed: Combat bonuses
- Cursed: Combat penalties
- Starving: Attribute penalties (food = 0)
- Exhausted: Attribute penalties (rest = 0)

### Party System

**Party Structure:**
```javascript
player.partyMembers = [
    { npc: <NPC instance>, joinedAt: <timestamp> },
    { npc: <NPC instance>, joinedAt: <timestamp> }
];
```

**Party Management:**
```javascript
// NPC joins party
player.addPartyMember(npc);
npc.followsPlayer = true;

// NPC leaves party
player.removePartyMember(npc);
npc.followsPlayer = false;

// Party moves together
player.setLocation(newLocation);
for (const member of player.partyMembers) {
    member.npc.setLocation(newLocation);
}
```

**Party Benefits:**
- NPCs assist in combat
- NPCs can carry items
- NPCs provide skills player lacks
- NPCs enable new dialogue options

### Admin Commands

**Directory:** `/home/user/CYOA_AI/slashcommands/`

Available commands:

| Command | Description |
|---------|-------------|
| `/heal [npc]` | Restore NPC to full health |
| `/kill [npc]` | Instantly kill an NPC |
| `/incapacitate [npc]` | Apply status effect to NPC |
| `/teleport [location]` | Move player to location |
| `/spawn [item]` | Create item in location |
| `/level [amount]` | Add levels to player |
| `/xp [amount]` | Add XP to player |
| `/skill [name] [value]` | Set skill value |
| `/attribute [name] [value]` | Set attribute value |

**Usage:**
```javascript
// In game, type:
/heal Thorin Ironforge
/spawn Legendary Sword
/xp 1000
```

---

## Summary

This CYOA AI RPG system is a sophisticated blend of:

1. **AI-Driven Narrative**: All content generated dynamically via AI prompts
2. **Deterministic Mechanics**: Combat, skills, dice use consistent formulas
3. **Persistent State**: File-based saves with full game state
4. **Real-Time Updates**: WebSocket streaming for responsive UI
5. **Flexible Configuration**: YAML-based tuning for balance and behavior

**Key Strengths:**
- No pre-written content required
- Infinite procedural generation
- Consistent game balance despite AI randomness
- Works with any OpenAI-compatible AI provider
- Fully transparent AI prompts (all in `/prompts/`)

**Recommended Workflow:**
1. Configure AI endpoint in `config.default.yaml`
2. Adjust game balance in `defs/*.yaml`
3. Modify prompts in `prompts/*.njk` for tone/style
4. Tune NPC behavior and generation frequency
5. Test with different AI models for quality
6. Use admin commands to debug/test scenarios

**Next Steps:**
- Review prompt templates to understand AI instructions
- Check `defs/` directory for game balance tuning
- Examine `Events.js` to see all possible game events
- Read `Player.js` to understand character state
- Test save/load system with different scenarios
