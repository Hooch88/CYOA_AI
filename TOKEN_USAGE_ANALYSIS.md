# Token Usage Analysis - CYOA AI RPG

## Overview

This document analyzes how the CYOA AI RPG system sends prompts to the LLM and estimates token usage across multiple turns.

---

## Prompt Construction Architecture

### Every AI Request Includes Two Parts:

1. **System Prompt** (`<systemPrompt>`)
   - Game rules and AI instructions
   - ~500-1,000 tokens

2. **User Prompt** (`<generationPrompt>`)
   - Complete world state (base context)
   - Specific task instructions
   - Majority of the token usage

---

## Base Context Structure

**File:** `/home/user/CYOA_AI/prompts/base-context.xml.njk`

Every AI request (except simple operations) includes this full context:

### Static Context (~3,000-5,000 tokens):
- **Setting Information** (~500 tokens)
  - Name, description, theme, genre
  - Magic/tech level, tone, difficulty
  - Currency, writing style notes
  - Available races

- **Game Definitions** (~1,500 tokens)
  - Attribute definitions (Str, Dex, Con, Int, Wis, Cha)
  - Rarity levels (Junk → Artifact with descriptions)
  - Need bar definitions (Food, Rest, Mana with thresholds)
  - Experience point values (~30 examples)
  - Disposition types

- **World Outline** (~500 tokens)
  - All discovered regions and locations (names only)
  - Grows slowly over session

### Dynamic Context per Turn (~5,000-15,000 tokens):

- **Current Region** (~300 tokens)
  - Name, description
  - List of locations in region

- **Current Location** (~500 tokens)
  - Name, description
  - Status effects
  - Exits to other locations

- **Player State** (~1,000-2,000 tokens)
  - Name, description, class, race
  - Health, level, currency
  - Attributes and skills (only skills > 1 shown)
  - Abilities (name, description, type, level)
  - Inventory items (detailed: name, description, equipped slot, properties, weight, value)
  - Need bars (current thresholds and effects)
  - Status effects

- **NPCs in Location** (~2,000-8,000 tokens)
  - Per NPC (up to 4 NPCs by default):
    - Name, description, class, race
    - Personality (type, traits, goals, notes)
    - Health, dispositions towards player
    - **Important memories** (3-5 key memories)
    - Inventory (items and equipped slots)
    - Skills and abilities
    - Status effects
    - Need bars

- **Party Members** (~1,000-4,000 tokens)
  - Same detailed info as NPCs above
  - Separate from location NPCs

- **Items in Scene** (~500-2,000 tokens)
  - Per item (up to 4 items by default):
    - Name, description, rarity, value
    - Properties, weight
    - Status effects

- **Scenery** (~300-1,000 tokens)
  - Background objects (up to 4 by default)

- **Game History** (VARIABLE - see section below)

### Total Base Context: ~8,000-25,000 tokens (excluding history)

---

## Game History Token Scaling

**File:** `/home/user/CYOA_AI/server.js` (lines 2590-2736)

### Two-Tier History System

The system manages history using summarization to control token growth:

#### Configuration (128k Context - Default):
```yaml
summaries:
  enabled: true
  batch_size: 30                      # Summarize 30 entries at a time
  summary_word_length: 12             # Each summary max 12 words

  max_unsummarized_log_entries: 200   # Recent full-text entries
  max_summarized_log_entries: 2000    # Older compressed entries
```

#### Configuration (32k Context - Recommended):
```yaml
summaries:
  max_unsummarized_log_entries: 20
  max_summarized_log_entries: 200
```

### Token Calculations

**Unsummarized Entries (Full Text):**
- Average player action: ~50-200 tokens
- Average AI response: ~150-400 tokens
- Average NPC turn: ~100-300 tokens
- **Per entry average: ~200 tokens**

**Summarized Entries (12 words):**
- 12 words ≈ 15-20 tokens per summary

### History Token Usage by Configuration:

| Configuration | Unsummarized | Summarized | Total History Tokens |
|---------------|--------------|------------|---------------------|
| **128k Context** | 200 × 200 = 40,000 | 2000 × 18 = 36,000 | **~76,000 tokens** |
| **32k Context** | 20 × 200 = 4,000 | 200 × 18 = 3,600 | **~7,600 tokens** |

### Automatic Summarization Process

**File:** `/home/user/CYOA_AI/api.js` (lines 870-1070)

1. **When entries age out of unsummarized window:**
   - Entries batched (30 at a time)
   - Sent to AI with prompt: "Summarize each entry in 12 words or less"
   - Each batch is 1 additional AI call

2. **Summarization prompt structure:**
   ```
   Base Context (world state) + 30 entries → AI → 30 summaries (12 words each)
   ```

3. **Token cost of summarization:**
   - Input: ~25,000 (base context) + 6,000 (30 full entries) = 31,000 tokens
   - Output: ~500 tokens (30 × 12 words)
   - **Cost per batch: ~31,500 tokens**

4. **Frequency:**
   - Runs automatically when queue reaches 30 entries
   - For 200 unsummarized limit, summarization happens every ~30 turns
   - For 20 unsummarized limit, summarization happens every ~20 turns

---

## AI Calls Per Turn

### Main Turn Sequence:

#### 1. Player Action Response (1 call)
- **Purpose:** Generate narrative response to player action
- **Prompt:** Base context + player action
- **Tokens IN:** 8,000-25,000 (base) + 76,000 (history, 128k) + 50 (action) = **84,000-101,000 tokens**
- **Tokens OUT:** 150-400 (prose response)

#### 2. Event Checking (10+ concurrent calls)
Default config: `events_to_check_concurrently: 10`

Each event type gets its own AI call to check if it occurred:
- attack_damage
- item_appear / pick_up_item
- move_new_location
- environmental_status_damage
- alter_npc
- new_exit_discovered
- experience_check
- disposition_check
- death_check
- health_check
- status_effect
- (plus more)

**Per event check:**
- **Tokens IN:** 8,000-25,000 (base) + 76,000 (history) + 400 (previous AI response) + 100 (event question) = **84,500-101,500 tokens**
- **Tokens OUT:** 10-50 (event detection XML)

**All event checks (10 concurrent):**
- **Tokens IN:** 845,000-1,015,000 tokens
- **Tokens OUT:** 100-500 tokens

#### 3. NPC Turns (0-2 calls, depending on config)
- **Tokens IN per NPC:** Same as player action (~84,000-101,000)
- **Tokens OUT per NPC:** 150-400

#### 4. Location Generation (if new location entered)
- **Tokens IN:** 8,000-25,000 (base) + 76,000 (history) + 500 (generation instructions) = **84,500-101,500 tokens**
- **Tokens OUT:** 1,000-3,000 (full location with NPCs, items, exits)

#### 5. NPC Memory Generation (if location changed)
- **Tokens IN per NPC:** ~50,000-70,000
- **Tokens OUT per NPC:** 200-500 (3-5 memories)

### Total Per Turn (Typical):

| Operation | Calls | Tokens IN | Tokens OUT |
|-----------|-------|-----------|------------|
| Player Action | 1 | ~90,000 | ~300 |
| Event Checks | 10 | ~900,000 | ~300 |
| NPC Turns | 1 | ~90,000 | ~300 |
| **TOTAL** | **12** | **~1,080,000** | **~900** |

### Total Per Turn (With Travel):

| Operation | Calls | Tokens IN | Tokens OUT |
|-----------|-------|-----------|------------|
| Player Action | 1 | ~90,000 | ~300 |
| Event Checks | 10 | ~900,000 | ~300 |
| Location Gen | 1 | ~90,000 | ~2,000 |
| NPC Memory (4 NPCs) | 4 | ~240,000 | ~1,600 |
| **TOTAL** | **16** | **~1,320,000** | **~4,200** |

---

## Scaling Analysis: 20, 50, 100 Turns

### Context Growth Over Time

**Assumption:** Using 128k context config (200 unsummarized, 2000 summarized)

#### Turn 1-200 (Before first summarization):
- History: Growing from 0 → 40,000 tokens (200 entries)
- Base context: ~8,000-25,000 tokens
- **Total context per turn: ~8,000-65,000 tokens**

#### Turn 201-2200 (Unsummarized full, summarized growing):
- Unsummarized: 40,000 tokens (constant, 200 entries)
- Summarized: Growing from 0 → 36,000 tokens (2000 entries)
- Base context: ~8,000-25,000 tokens
- **Total context per turn: ~48,000-101,000 tokens**

#### Turn 2201+ (Both pools full):
- Unsummarized: 40,000 tokens (constant)
- Summarized: 36,000 tokens (constant)
- Base context: ~8,000-25,000 tokens
- **Total context per turn: ~84,000-101,000 tokens (STABILIZES)**

### Token Usage Estimates

#### 20 Turns Session:
- Turns: 20
- History entries: ~60 (player + AI + events)
- History tokens: ~12,000
- Average context per call: ~20,000-37,000 tokens
- AI calls: ~240 (20 turns × 12 calls)
- **Total tokens IN: ~4.8M - 8.9M**
- **Total tokens OUT: ~18k**
- **Grand Total: ~4.82M - 8.92M tokens**

#### 50 Turns Session:
- Turns: 50
- History entries: ~150
- History tokens: ~30,000
- Average context per call: ~38,000-55,000 tokens
- AI calls: ~600 (50 turns × 12 calls)
- **Total tokens IN: ~22.8M - 33M**
- **Total tokens OUT: ~45k**
- **Grand Total: ~22.85M - 33.05M tokens**

#### 100 Turns Session:
- Turns: 100
- History entries: 200 (capped, unsummarized full)
- Summarization triggered ~3 times (90 entries → 90 summaries)
- History tokens: ~41,620 (200 full + 90 summarized)
- Average context per call: ~49,620-66,620 tokens
- AI calls: ~1,200 (100 turns × 12 calls)
- Summarization calls: 3 (90 entries / 30 per batch)
- **Total tokens IN: ~59.6M - 80M + 94,500 (summarization)**
- **Total tokens OUT: ~90k + 1,500 (summarization)**
- **Grand Total: ~59.69M - 80.09M tokens**

### 32k Context Configuration

Using 20 unsummarized, 200 summarized:

#### 20 Turns:
- History: ~12,000 tokens (same as above)
- Average context: ~20,000-37,000 tokens
- AI calls: ~240
- **Total: ~4.8M - 8.9M tokens** (same)

#### 50 Turns:
- History: 4,000 (20 unsummarized) + 2,520 (140 summarized) = 6,520 tokens
- Summarization calls: 1 (30 entries)
- Average context: ~14,520-31,520 tokens
- AI calls: ~600 + summarization
- **Total tokens IN: ~8.7M - 18.9M + 31,500**
- **Total tokens OUT: ~45k + 500**
- **Grand Total: ~8.78M - 18.95M tokens**

#### 100 Turns:
- History: 4,000 (20 unsummarized) + 3,600 (200 summarized, capped) = 7,600 tokens
- Summarization calls: 2-3 batches
- Average context: ~15,600-32,600 tokens
- AI calls: ~1,200 + summarization
- **Total tokens IN: ~18.7M - 39.1M + 94,500**
- **Total tokens OUT: ~90k + 1,500**
- **Grand Total: ~18.79M - 39.19M tokens**

---

## Cost Implications

### Example Pricing (as of 2025):

| Model | Input ($/1M tokens) | Output ($/1M tokens) |
|-------|--------------------:|---------------------:|
| GPT-4 Turbo | $10 | $30 |
| GPT-4o Mini | $0.15 | $0.60 |
| Claude 3.5 Sonnet | $3 | $15 |
| Deepseek V3 | $0.27 | $1.10 |
| Local (self-hosted) | $0 | $0 |

### Cost Per Session (GPT-4o Mini):

| Session Length | Total Tokens IN | Total Tokens OUT | Cost |
|----------------|-----------------|------------------|------|
| **20 turns** | ~6.85M | ~18k | **$1.04** |
| **50 turns** | ~27.9M | ~45k | **$4.21** |
| **100 turns** | ~69.9M | ~91.5k | **$10.54** |

### Cost Per Session (GPT-4 Turbo):

| Session Length | Total Tokens IN | Total Tokens OUT | Cost |
|----------------|-----------------|------------------|------|
| **20 turns** | ~6.85M | ~18k | **$69.04** |
| **50 turns** | ~27.9M | ~45k | **$280.35** |
| **100 turns** | ~69.9M | ~91.5k | **$701.75** |

### Cost Per Session (Deepseek V3):

| Session Length | Total Tokens IN | Total Tokens OUT | Cost |
|----------------|-----------------|------------------|------|
| **20 turns** | ~6.85M | ~18k | **$1.87** |
| **50 turns** | ~27.9M | ~45k | **$7.58** |
| **100 turns** | ~69.9M | ~91.5k | **$18.97** |

---

## Optimization Strategies

### Current Optimizations:

1. **Automatic Summarization**
   - Reduces history from ~200 tokens/entry to ~18 tokens/entry
   - Prevents unbounded context growth
   - 90% token reduction for old history

2. **Concurrent Event Checking**
   - Processes 10 events in parallel
   - Faster than sequential (no change in total tokens)

3. **Skill Filtering**
   - Only shows skills with value > 1
   - Reduces player/NPC context by ~30%

4. **Memory Selection**
   - NPCs show only "important" memories (3-5 selected)
   - Not entire memory history

### Potential Further Optimizations:

#### 1. Reduce Event Checks
Current: 10+ event types checked per turn

**Option A:** Check fewer events
```yaml
events_to_check_concurrently: 5  # Only check most common events
```
- Reduces event check tokens by 50%
- **Savings: ~450k tokens per turn**

**Option B:** Smart event detection
- Only check combat events if combat is likely
- Only check travel if exits mentioned
- **Savings: ~300-600k tokens per turn**

#### 2. Smaller History Window (32k config)
```yaml
max_unsummarized_log_entries: 10   # Instead of 20
max_summarized_log_entries: 100    # Instead of 200
```
- Reduces history from 7,600 to ~3,800 tokens
- **Savings: ~3,800 tokens per turn**
- **Trade-off:** Less context for AI decisions

#### 3. Simplified NPC Context
Instead of full NPC details, send:
- Name, description, personality only
- Skip inventory, skills, need bars for non-party NPCs
- **Savings: ~1,000-3,000 tokens per NPC**

#### 4. Location Exit Pruning
Only show discovered/relevant exits
- **Savings: ~100-300 tokens per location**

#### 5. Batch Multiple Turns
Experimental: Process 2-3 player actions in one AI call
- Reduces base context duplication
- **Savings: ~50% for multi-action turns**
- **Trade-off:** Less precise event detection

#### 6. Use Smaller Models for Event Checks
- Main response: GPT-4 / Claude 3.5
- Event checking: GPT-4o-mini / Gemini Flash
- **Savings: 90% cost reduction on event checks**

---

## Summary

### Token Usage Reality:

**Per Turn:**
- **Typical:** ~1.08M tokens input, ~900 tokens output
- **With travel:** ~1.32M tokens input, ~4,200 tokens output

**Per Session:**
- **20 turns:** ~5-9M tokens total
- **50 turns:** ~23-33M tokens total
- **100 turns:** ~60-80M tokens total

### Key Insights:

1. **Event checking dominates token usage** (~85% of tokens)
   - 10 concurrent event checks per turn
   - Each check includes full base context + history

2. **History grows but stabilizes** via summarization
   - Reaches plateau at ~76k tokens (128k config)
   - Reaches plateau at ~7.6k tokens (32k config)

3. **Cost scales linearly** with turns (after stabilization)
   - No exponential growth due to summarization
   - Predictable costs: ~$0.10-0.15 per turn (GPT-4o Mini)

4. **Context is rich but expensive**
   - Full world state + all NPCs + history = large prompts
   - Trade-off: Better AI decisions vs. token cost

5. **Local models eliminate cost** but require hardware
   - 70B parameter models work well (Qwen 2.5, Llama 3.3)
   - Need ~48GB VRAM for good performance
   - Free after initial investment

### Recommendations:

**For Production Use:**
- Use 32k context config for cost savings
- Consider GPT-4o Mini or Deepseek V3 for balance
- Implement smart event detection (only check relevant events)
- Monitor actual usage via logs

**For Development/Testing:**
- Use local models (Ollama, LM Studio)
- Zero cost for unlimited experimentation
- Iterate on prompts freely

**For Premium Experience:**
- Use 128k context config
- GPT-4 Turbo or Claude 3.5 Sonnet
- Full event checking for maximum accuracy
- Budget ~$0.50-1.00 per turn
