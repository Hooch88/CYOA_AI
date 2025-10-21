# Database Storage Analysis - Supabase for CYOA AI RPG

## Current Storage System

**Architecture:** File-based JSON storage

```
saves/
├── MySave_2025-01-15_14-30-22/
│   ├── metadata.json          # Save metadata
│   ├── game-state.json        # Complete game state
│   ├── player.json            # Player data
│   ├── regions.json           # All regions
│   ├── locations.json         # All locations
│   ├── items.json             # All items
│   └── npcs.json              # All NPCs

autosaves/
├── autosave_2025-01-15_14-35-10/
└── ... (20 retained by default)
```

**How it works:**
- Manual saves: `POST /api/save`
- Auto saves: After every player action
- Load: `POST /api/load`
- List: `GET /api/saves`

**File:** `/home/user/CYOA_AI/api.js` lines 13740+

---

## Supabase Alternative

### What is Supabase?

- **PostgreSQL database** hosted in the cloud
- **REST API** auto-generated from schema
- **Real-time subscriptions** for live updates
- **Authentication** built-in
- **Storage** for files/images
- **Free tier:** 500MB database, 2GB bandwidth/month

### Proposed Schema

```sql
-- Players table
CREATE TABLE players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users,  -- Optional: for multi-user
    name TEXT NOT NULL,
    level INTEGER,
    health INTEGER,
    max_health INTEGER,
    class TEXT,
    race TEXT,
    description TEXT,
    attributes JSONB,
    skills JSONB,
    abilities JSONB,
    inventory JSONB,
    need_bars JSONB,
    current_location_id UUID REFERENCES locations,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Regions table
CREATE TABLE regions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_session_id UUID REFERENCES game_sessions,
    name TEXT NOT NULL,
    description TEXT,
    level INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Locations table
CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    region_id UUID REFERENCES regions,
    name TEXT NOT NULL,
    description TEXT,
    level INTEGER,
    exits JSONB,
    items JSONB,
    status_effects JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- NPCs table
CREATE TABLE npcs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location_id UUID REFERENCES locations,
    name TEXT NOT NULL,
    description TEXT,
    class TEXT,
    race TEXT,
    personality JSONB,
    health INTEGER,
    max_health INTEGER,
    attributes JSONB,
    skills JSONB,
    inventory JSONB,
    important_memories JSONB,
    dispositions JSONB,
    is_dead BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Game Sessions (Saves)
CREATE TABLE game_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users,
    save_name TEXT NOT NULL,
    is_autosave BOOLEAN DEFAULT FALSE,
    player_id UUID REFERENCES players,
    current_setting JSONB,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Chat History
CREATE TABLE chat_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_session_id UUID REFERENCES game_sessions,
    role TEXT,  -- 'user', 'assistant', 'system'
    content TEXT,
    summary TEXT,  -- For summarized entries
    metadata JSONB,
    turn_number INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Images (if using Supabase Storage)
CREATE TABLE images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type TEXT,  -- 'player', 'npc', 'item', 'location'
    entity_id UUID,
    storage_path TEXT,  -- Path in Supabase Storage
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Comparison: File-based vs Supabase

| Feature | File-based (Current) | Supabase Database |
|---------|---------------------|-------------------|
| **Setup Complexity** | ✅ None (built-in) | ⚠️ Medium (account, schema, client) |
| **Internet Required** | ✅ No | ❌ Yes |
| **Speed (Local)** | ✅ Very fast | ⚠️ Slower (network latency ~50-200ms) |
| **Speed (Remote)** | ❌ N/A | ✅ Fast from anywhere |
| **Multi-user Support** | ❌ No | ✅ Yes (built-in auth) |
| **Concurrent Access** | ❌ No | ✅ Yes |
| **Backup** | ⚠️ Manual | ✅ Automatic |
| **Query Flexibility** | ❌ Limited | ✅ SQL queries, filtering |
| **Cost (Single user)** | ✅ Free | ✅ Free (up to limits) |
| **Cost (Heavy use)** | ✅ Always free | ⚠️ $25+/month if exceeding limits |
| **Reliability** | ✅ 100% (local files) | ⚠️ 99.9% (depends on Supabase uptime) |
| **Version Control** | ✅ Easy (git commit saves/) | ⚠️ Harder (need db exports) |
| **Portability** | ✅ Easy (copy directory) | ⚠️ Harder (need db export/import) |
| **Privacy** | ✅ Fully local | ⚠️ Data in cloud |

---

## Use Cases Analysis

### When File-based is BETTER (Current System):

✅ **Single-player game**
- You're the only user
- No need for cloud access
- Privacy preferred

✅ **Local-only deployment**
- Running on localhost
- No internet dependency desired
- Maximum speed required

✅ **Development/Testing**
- Easy to inspect save files
- Can manually edit JSON for debugging
- Version control friendly

✅ **Simple architecture**
- Works out of the box
- No external dependencies
- Zero configuration

✅ **Cost-sensitive**
- Completely free forever
- No usage limits
- No bandwidth concerns

### When Supabase is BETTER:

✅ **Multi-user/Multi-player**
- Multiple people playing
- Shared world state
- Real-time collaboration

✅ **Cross-device play**
- Play on desktop, continue on laptop
- Mobile + desktop
- Automatic cloud sync

✅ **Hosted/SaaS offering**
- Providing game to others
- Need user accounts
- Centralized management

✅ **Complex queries needed**
- "Show me all NPCs level 5+"
- "Find all items of rarity 'legendary'"
- "List saves from last week"

✅ **Automatic backup critical**
- Don't trust local backups
- Want cloud redundancy
- Disaster recovery important

✅ **Real-time features**
- Live updates across clients
- Collaborative editing
- Multiplayer turn-taking

---

## Impact on Token Usage

### Direct Impact: ❌ NONE

Supabase doesn't reduce AI API calls or token usage:
- Still need same prompts to AI
- Still send same context
- Storage location doesn't affect AI costs

### Indirect Impact: ⚠️ MINIMAL

**Potential small benefits:**

1. **Selective Loading** (Minor)
   - Could load only needed data instead of entire save
   - Example: Load only current location's NPCs
   - **Savings:** ~2-5k tokens max (irrelevant vs 1M+ per turn)

2. **Better History Management** (Minor)
   - Could query for specific time ranges
   - Load summarized vs full entries more efficiently
   - **Savings:** Already handled by current summarization system

3. **Faster Save/Load** (Negligible)
   - Autosaves slightly faster (async to cloud)
   - Doesn't affect turn processing time
   - **Savings:** None for token costs

**Conclusion:** Database choice has **<1% impact on token costs**

---

## Implementation Complexity

### Code Changes Required: ⚠️ MODERATE to HIGH

#### 1. Install Supabase Client
```bash
npm install @supabase/supabase-js
```

#### 2. Initialize Client
```javascript
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);
```

#### 3. Replace All Save Operations

**Current (File-based):**
```javascript
// api.js line 13742
const result = performGameSave();
// Writes to ./saves/[saveName]/
```

**New (Supabase):**
```javascript
const result = await saveToSupabase({
    player: currentPlayer.toJSON(),
    regions: Region.getAll().map(r => r.toJSON()),
    locations: Location.getAll().map(l => l.toJSON()),
    npcs: Player.getAll().filter(p => p.isNPC).map(n => n.toJSON()),
    chatHistory: chatHistory,
    setting: currentSetting
});

async function saveToSupabase(gameState) {
    // 1. Create game_sessions record
    const { data: session, error: sessionError } = await supabase
        .from('game_sessions')
        .insert({
            save_name: buildSaveName(),
            player_id: gameState.player.id,
            current_setting: gameState.setting,
            metadata: { /* ... */ }
        })
        .select()
        .single();

    // 2. Upsert player
    await supabase.from('players').upsert(gameState.player);

    // 3. Upsert regions
    await supabase.from('regions').upsert(gameState.regions);

    // 4. Upsert locations
    await supabase.from('locations').upsert(gameState.locations);

    // 5. Upsert NPCs
    await supabase.from('npcs').upsert(gameState.npcs);

    // 6. Insert chat history
    await supabase.from('chat_history').insert(
        gameState.chatHistory.map(entry => ({
            game_session_id: session.id,
            ...entry
        }))
    );

    return session;
}
```

#### 4. Replace All Load Operations

**Current:**
```javascript
// Reads from ./saves/[saveName]/
const result = await performGameLoad(saveName);
```

**New:**
```javascript
const result = await loadFromSupabase(sessionId);

async function loadFromSupabase(sessionId) {
    // 1. Load session
    const { data: session } = await supabase
        .from('game_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

    // 2. Load player
    const { data: player } = await supabase
        .from('players')
        .select('*')
        .eq('id', session.player_id)
        .single();

    // 3. Load regions
    const { data: regions } = await supabase
        .from('regions')
        .select('*')
        .eq('game_session_id', sessionId);

    // 4. Load locations
    const { data: locations } = await supabase
        .from('locations')
        .select('*, region:regions(*)')
        .in('region_id', regions.map(r => r.id));

    // 5. Load NPCs
    const { data: npcs } = await supabase
        .from('npcs')
        .select('*')
        .in('location_id', locations.map(l => l.id));

    // 6. Load chat history
    const { data: chatHistory } = await supabase
        .from('chat_history')
        .select('*')
        .eq('game_session_id', sessionId)
        .order('turn_number', { ascending: true });

    // 7. Reconstruct game state
    return reconstructGameState({ session, player, regions, locations, npcs, chatHistory });
}
```

#### 5. Update Autosave Logic
```javascript
// Need to handle retention differently
// Instead of deleting directories, delete old sessions
const { data: oldSessions } = await supabase
    .from('game_sessions')
    .select('id')
    .eq('is_autosave', true)
    .order('created_at', { ascending: true })
    .limit(Math.max(0, currentCount - retention));

// Delete old autosaves (cascades to related tables)
await supabase
    .from('game_sessions')
    .delete()
    .in('id', oldSessions.map(s => s.id));
```

**Estimated Work:**
- Schema design: 4-6 hours
- Replace save operations: 8-12 hours
- Replace load operations: 8-12 hours
- Update autosave logic: 4-6 hours
- Testing: 8-16 hours
- Migration script for existing saves: 4-8 hours

**Total: 36-60 hours of development**

---

## Cost Analysis

### Supabase Pricing

**Free Tier:**
- 500 MB database storage
- 1 GB file storage
- 2 GB bandwidth per month
- 50,000 monthly active users
- Unlimited API requests

**Pro Tier ($25/month):**
- 8 GB database storage
- 100 GB file storage
- 250 GB bandwidth
- 100,000 monthly active users

### Storage Requirements

**Per save (estimated):**
- Player: ~10-20 KB
- NPCs (4 average): ~40-80 KB
- Locations (10-20): ~100-200 KB
- Regions (5): ~10-20 KB
- Chat history (100 turns): ~500-1000 KB
- **Total per save: ~660-1320 KB (~1 MB)**

**With 20 autosaves + 10 manual saves:**
- Total: ~30 MB
- Free tier: ✅ Plenty of room (500 MB limit)

**Heavy usage (100 saves):**
- Total: ~100 MB
- Free tier: ✅ Still within limits

**Bandwidth (per load/save):**
- Load: ~1 MB download
- Save: ~1 MB upload
- 100 loads + 100 saves per month = 200 MB
- Free tier: ✅ Within 2 GB limit

**Conclusion:** Free tier sufficient for single-player use

---

## Migration Path

If you decide to switch:

### Phase 1: Add Supabase (Parallel)
1. Set up Supabase account
2. Create schema
3. Add Supabase client to codebase
4. Keep file-based system working

### Phase 2: Implement Save to Both
1. Save to files AND Supabase
2. Load from files (primary)
3. Test Supabase saves thoroughly

### Phase 3: Switch Primary
1. Load from Supabase (primary)
2. Fallback to files if Supabase fails
3. Still save to both

### Phase 4: Full Migration
1. Remove file-based code
2. Supabase only
3. Migrate existing saves with script

**Timeline:** 2-3 weeks part-time

---

## Recommendations

### ❌ DO NOT MIGRATE if:

- You're playing **single-player only**
- You prefer **local/offline** play
- You want **zero external dependencies**
- You value **simplicity** over features
- You're **privacy-conscious** (local data only)
- You want to avoid **any costs** (even potential future costs)
- Current system **works fine** for your needs

### ✅ CONSIDER MIGRATION if:

- You want **multi-user/multiplayer**
- You need **cross-device sync**
- You're building a **hosted service**
- You want **automatic cloud backup**
- You need **complex querying** of saves
- You plan to add **user accounts**
- You want **real-time collaboration**

### 🤔 HYBRID APPROACH:

**Keep file-based for local play, add Supabase as optional:**

```yaml
# config.yaml
storage:
  type: "file"  # or "supabase"

  file:
    saves_dir: "./saves"
    autosaves_dir: "./autosaves"

  supabase:
    url: "https://your-project.supabase.co"
    anon_key: "your-key"
    enabled: false  # Toggle on when needed
```

**Benefits:**
- ✅ Best of both worlds
- ✅ Use files for local dev/testing
- ✅ Use Supabase for production/hosting
- ⚠️ More code to maintain

---

## My Recommendation

### For Your Current Use Case: ✅ **KEEP FILE-BASED**

**Reasons:**
1. **Works perfectly** for single-player
2. **Zero complexity** - already implemented
3. **No dependencies** - fully offline
4. **Free forever** - no usage limits
5. **Fast** - no network latency
6. **Private** - data stays local
7. **Easy debugging** - can inspect JSON files

**Migration effort (36-60 hours) provides:**
- ❌ No token cost savings
- ❌ No speed improvement (actually slower)
- ❌ No quality improvement
- ✅ Cloud backup (can achieve with simple file sync)
- ✅ Multi-user support (not needed yet)

### When to Reconsider:

✅ **Build a hosted version for others**
- Multiple users need accounts
- Need centralized management

✅ **Add multiplayer/collaborative features**
- Shared world state
- Real-time updates

✅ **Cross-device becomes critical**
- Playing on multiple machines frequently
- Mobile app in the works

### Better Uses of 40+ Hours:

Instead of migrating storage, these would provide more value:

1. **Implement caching** (Anthropic Claude) - 65% cost savings
2. **Optimize event checking** - 50% cost savings
3. **Add new game features** - Better gameplay
4. **Improve UI/UX** - Better player experience
5. **Set up local model** (Qwen 2.5 72B) - Zero cost forever

---

## Summary

**Question:** Should I use Supabase for persistent storage?

**Short Answer:** No, not for your current single-player local setup.

**Long Answer:**
- File-based system is perfect for single-player
- Supabase adds complexity with no token cost benefits
- 40+ hours of work for features you don't need yet
- Better to spend time on optimizations that reduce costs
- Reconsider only if going multi-user or hosted

**Better priority:** Focus on token cost optimizations (caching, local models) which provide 25-65% savings with less work.
