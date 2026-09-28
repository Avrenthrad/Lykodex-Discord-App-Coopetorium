# Lykodex Discord Bot — Coopetorium test build

The Lykodex Discord add-on, tested on the Coopetorium server before it
becomes the main Lykodex bot. It **replaces** the old Lykodex Presence
Bot (`lykodex/discord-bot/`). Everything that bot did is included here,
unchanged, plus the new features.

It uses the **same Supabase database as the Lykodex app**, so it works
with the app out of the box. The only schema change is one new
settings table.

## What it does

| Feature | How |
|---|---|
| **Account linking** | `/link` shows your link status, or steps to link. Linking itself happens in the app (Account Linking → Discord OAuth), so Discord proves who you are. |
| **Slash commands** | `/profile`, `/mastery`, `/collection`, `/nowplaying`, `/leaderboard` |
| **Activity feed** | Posts Lykodex activity to a channel: achievements, 100% completions, finished games, wishlist adds, new TCG cards, Mastery level-ups, and (optionally) "started playing X". Bulk events are batched into one line per person. |
| **Leaderboards** | `/leaderboard board:` Overall Mastery · Gaming Mastery · Console Playtime · 100% Completions · Library Size |
| **Presence tracking** *(ported)* | Live "currently playing" → `current_activity`; Xbox/PS session time → `platform_playtime` |
| **Daily Mastery refresh** *(ported)* | Recomputes Gaming + Overall Mastery for every profile every 24h |

### Privacy rule (applies everywhere)

The bot uses the `service_role` key, so Supabase RLS doesn't protect
anyone. The bot enforces this one rule itself (`src/privacy.js`):

- You can always see **your own** stats.
- You can see **someone else's** stats, leaderboard spot and feed posts
  only if they've turned on **Share activity with guilds** in Lykodex.

That's the same opt-in Guild Pulse already uses. `/nowplaying` is the
one exception: it only shows what Discord already shows everyone in the
member list.

## Commands

| Command | Who | What |
|---|---|---|
| `/link` | anyone | Link status / how to link |
| `/profile [user]` | anyone | Profile card: mastery levels, now playing, gamertags |
| `/mastery [user]` | anyone | Overall + Gaming Mastery with XP bars and breakdown |
| `/collection [user]` | anyone | Counts across Gaming, TCG, Entertainment, Collectibles |
| `/nowplaying` | anyone | Who in the server is playing what right now |
| `/leaderboard [board]` | anyone | Server leaderboard |
| `/lykodex-setup feed channel:#x [now_playing]` | Manage Server | Turn on the activity feed in a channel |
| `/lykodex-setup feed-off` | Manage Server | Pause the feed |
| `/lykodex-setup status` | Manage Server | Show settings |

## Setup

### 1. Discord application

You can reuse the existing Lykodex Discord app (the one used for "Sign in
with Discord"), or create a separate test app.

1. [Developer Portal](https://discord.com/developers/applications) → your app → **Bot**
2. Copy the token → `DISCORD_BOT_TOKEN`
3. Under **Privileged Gateway Intents**, turn on **Presence Intent** AND
   **Server Members Intent**. If either is off, login fails with "Used
   disallowed intents".
4. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`;
   permissions **View Channels**, **Send Messages**, **Embed Links**.
   Open the URL and add the bot to Coopetorium.

### 2. Database

Run `sql/001_discord_guild_settings.sql` once in the Supabase SQL editor.
It's additive and safe: it adds one new table and one index.

### 3. Env

```
cp .env.example .env
```

Fill in `DISCORD_BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
and set `DISCORD_GUILD_ID` to the Coopetorium server ID. With that set,
commands show up instantly instead of taking up to an hour.

### 4. Run

```
npm install
npm start
```

Then in Discord: `/lykodex-setup feed channel:#lykodex-feed`.

### Deploy (Railway)

`railway.json` is included. New Project → Deploy from GitHub → this repo.
No Root Directory setting is needed because the bot lives at the repo
root. Add the env vars under **Variables**.

## Cutover from the old Presence Bot

**Never run both with presence tracking on.** They would both add
console playtime, so every session would count twice.

While testing side-by-side, set `ENABLE_PRESENCE_TRACKING=false` and
`ENABLE_MASTERY_REFRESH=false` here. The old bot keeps doing those two
jobs while you try out commands and the feed.

When ready to switch:

1. Stop the old Railway service (`lykodex/discord-bot`).
2. Remove those two `false` flags here (both default to on) and redeploy.
3. Once it's stable, delete `lykodex/discord-bot/`.

## Development

```
npm test          # unit tests (formatting, batching, privacy, level-ups, command JSON)
```

```
src/
  index.js            startup, wiring, schedules
  config.js           env parsing
  supabase.js         service_role client
  links.js            Discord ↔ Lykodex lookups (discord_links)
  privacy.js          the one visibility rule
  format.js           pure formatting / batching / ranking helpers
  settings.js         discord_guild_settings access
  feed.js             activity feed poller + now-playing / level-up posts
  presence.js         presence + playtime tracking (ported)
  mastery/            scoring math + daily refresh (ported) + level-up diff
  commands/           one file per slash command
sql/                  schema additions for the shared Lykodex database
```

`src/mastery/gameMastery.js` and `overallMastery.js` are hand-kept copies
of the app's `src/lib/` scoring math. If the formulas change there, update
them here too.
