// Presence tracking — ported unchanged in behaviour from the original
// Lykodex Presence Bot (lykodex/discord-bot/index.js):
//
//   1. Writes each linked user's LIVE "currently playing" status to
//      current_activity (shown on the Lykodex site).
//   2. For Xbox/PlayStation only, times each session and adds it to
//      platform_playtime. Steam is skipped on purpose — Steam already
//      has its own official playtime from Steam's API, so counting it
//      here would double up.
//
// Honest limitation: console hours only start counting from when
// someone links Discord and shares a server with the bot. There's no
// historical console playtime anywhere to backfill from.
//
// New: optionally announces "started playing X" in the feed channel
// (per-server toggle, see /lykodex-setup).
import { supabase } from "./supabase.js";
import { lykodexUserIdFor } from "./links.js";
import { announceNowPlaying } from "./feed.js";

// Discord's console integrations show up as a normal "Playing"
// activity with a platform field. Discord's own docs say that field
// can be unreliable, so anything unexpected is "unknown", not a guess.
export function normalizePlatform(activity) {
  const raw = (activity?.platform || "").toLowerCase();
  if (raw === "xbox") return "xbox";
  if (raw === "playstation" || raw === "ps4" || raw === "ps5") return "playstation";
  if (raw === "desktop" || raw === "steam") return "steam";
  return "unknown";
}

// Type 0 = "Playing" — skips Spotify, custom status, watching, etc.
export function currentGameActivity(presence) {
  return presence?.activities?.find((a) => a.type === 0) || null;
}

// discordUserId -> { platform, gameName, startedAt }
const activeSessions = new Map();

async function updateCurrentActivity(userId, activity) {
  const { error } = await supabase.from("current_activity").upsert(
    {
      user_id: userId,
      platform: activity ? normalizePlatform(activity) : null,
      game_name: activity?.name || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) console.error("current_activity upsert failed:", error.message);
}

async function accumulatePlaytime(userId, platform, gameName, startedAt) {
  if (platform !== "xbox" && platform !== "playstation") return;
  const minutes = Math.round((Date.now() - startedAt) / 60000);
  if (minutes <= 0) return;

  const { data: existing } = await supabase
    .from("platform_playtime")
    .select("total_minutes")
    .eq("user_id", userId)
    .eq("platform", platform)
    .eq("game_name", gameName)
    .maybeSingle();

  const { error } = await supabase.from("platform_playtime").upsert(
    {
      user_id: userId,
      platform,
      game_name: gameName,
      total_minutes: (existing?.total_minutes || 0) + minutes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,platform,game_name" },
  );
  if (error) console.error("platform_playtime upsert failed:", error.message);
}

export function registerPresenceTracking(client) {
  client.on("presenceUpdate", async (_old, presence) => {
    try {
      const discordUserId = presence.userId;
      const userId = await lykodexUserIdFor(discordUserId);
      if (!userId) return;

      const activity = currentGameActivity(presence);
      const platform = activity ? normalizePlatform(activity) : null;
      const gameName = activity?.name || null;
      const prev = activeSessions.get(discordUserId);

      // The same person in several servers fires one update per
      // server — only act when the game actually changed.
      const changed = prev?.gameName !== gameName || prev?.platform !== platform;
      if (!changed) return;

      if (prev) await accumulatePlaytime(userId, prev.platform, prev.gameName, prev.startedAt);
      if (activity) {
        activeSessions.set(discordUserId, { platform, gameName, startedAt: Date.now() });
        announceNowPlaying(client, userId, gameName, platform).catch((err) =>
          console.error("now-playing announce failed:", err.message),
        );
      } else {
        activeSessions.delete(discordUserId);
      }
      await updateCurrentActivity(userId, activity);
    } catch (err) {
      console.error("presenceUpdate handler failed:", err.message);
    }
  });
}

// Close out open sessions on shutdown so accrued time isn't lost.
export async function flushSessions() {
  for (const [discordUserId, session] of activeSessions.entries()) {
    const userId = await lykodexUserIdFor(discordUserId);
    if (userId) await accumulatePlaytime(userId, session.platform, session.gameName, session.startedAt);
  }
  activeSessions.clear();
}
