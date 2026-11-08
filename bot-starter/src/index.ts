// ScrabbleBot bot starter.
//
// First run, with a token from the website:
//   On your team's page, click "Generate token", then run
//   `BOT_NAME=<name> BOT_TOKEN=<token> npm start`.
//
// Or with a nonce from the CLI:
//   1. `spacetime call scrabblebot mint_credential_nonce`
//      `spacetime sql 'SELECT code FROM my_nonces ORDER BY expires_at DESC'`
//   2. `BOT_NAME=<name> BOT_NONCE=<code> npm start`
//      The bot connects fresh and redeems the nonce.
//
// Either way the bot saves its token to .token-<BOT_NAME>, so later runs
// need only `BOT_NAME=<name> npm start`.
//
// Entering a tournament: `BOT_NAME=<name> TOURNAMENT_ID=<id> npm start`
// registers the bot for that tournament when it connects. Only the bot
// itself can register, so this has to come from the bot's process.
//
// Edit ./src/strategy.ts to customise how your bot bids and plays words.

import {
  DbConnection,
  tables,
  type EventContext,
  type ErrorContext,
  type SubscriptionHandle,
} from "./module_bindings/index.js";
import { Identity } from "spacetimedb";
import * as fs from "node:fs";
import * as path from "node:path";
import { chooseWord, decideBid } from "./strategy.js";
import { buildIndex, DEFAULT_BAG } from "./dictionary.js";

const HOST = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const DB_NAME = process.env.STDB_DB ?? "scrabblebot";
const BOT_NAME = process.env.BOT_NAME ?? "bot";
const BOT_TOKEN = process.env.BOT_TOKEN; // from the website, first run only
const BOT_NONCE = process.env.BOT_NONCE; // from the CLI, first run only
const TOURNAMENT_ID = process.env.TOURNAMENT_ID;
const TOKEN_PATH = path.join(process.cwd(), `.token-${BOT_NAME}`);

function loadToken(): string | undefined {
  try {
    return fs.readFileSync(TOKEN_PATH, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}
function saveToken(tok: string) {
  fs.writeFileSync(TOKEN_PATH, tok);
}

// Load the shared wordlist so the bot can pick playable words locally.
const dictionaryPath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "spacetimedb",
  "wordlist.txt",
);
const DICTIONARY: string[] = fs.existsSync(dictionaryPath)
  ? fs
      .readFileSync(dictionaryPath, "utf8")
      .split("\n")
      .map((l) => l.trim().toUpperCase())
      .filter((l) => l.length >= 2)
  : [];
DICTIONARY.sort((a, b) => b.length - a.length); // longest first for greedy pick
buildIndex(DICTIONARY);
console.log(`[${BOT_NAME}] indexed ${DICTIONARY.length} words`);

// Public auction results let us track the remaining bag composition per
// match (starting racks are hidden, so this is an estimate) and the going
// rate for letters.
const seenLettersByMatch = new Map<string, Map<string, number>>();
const tilesWonByMatch = new Map<string, number>();

// Live market learner: rolling clearing prices per letter class and match
// phase, from every auction_result we receive (all matches in our range
// subscription, not just ours). The bot bids from the medians once a cell
// has MARKET_MIN_SAMPLES; the static table in strategy.ts is the fallback.
const MARKET_WINDOW = 60;
const MARKET_MIN_SAMPLES = 8;
const marketSamples: Record<"p4" | "p58" | "pZQ", number[][]> = {
  p4: [[], [], [], [], []],
  p58: [[], [], [], [], []],
  pZQ: [[], [], [], [], []],
};
const auctionsSeenByMatch = new Map<string, number>();
const FACE: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};
function noteMarket(matchId: bigint, letter: string, paid: number) {
  const k = String(matchId);
  const idx = auctionsSeenByMatch.get(k) ?? 0;
  auctionsSeenByMatch.set(k, idx + 1);
  const face = FACE[letter] ?? 0;
  if (face < 4 || paid <= 0) return;
  const cls = face >= 10 ? "pZQ" : face >= 5 ? "p58" : "p4";
  const ph = idx < 16 ? 0 : idx < 31 ? 1 : idx < 46 ? 2 : idx < 60 ? 3 : 4;
  const arr = marketSamples[cls][ph]!;
  arr.push(paid);
  if (arr.length > MARKET_WINDOW) arr.shift();
}
function liveMarketTable() {
  const med = (a: number[]) => {
    if (a.length < MARKET_MIN_SAMPLES) return null;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)]!;
  };
  return {
    p4: marketSamples.p4.map(med),
    p58: marketSamples.p58.map(med),
    pZQ: marketSamples.pZQ.map(med),
  };
}
const recentPaidByMatch = new Map<string, number[]>();

function noteAuctionResult(matchId: bigint, letter: string, paid: number) {
  const key = String(matchId);
  const seen = seenLettersByMatch.get(key) ?? new Map<string, number>();
  seen.set(letter, (seen.get(letter) ?? 0) + 1);
  seenLettersByMatch.set(key, seen);
  const paids = recentPaidByMatch.get(key) ?? [];
  paids.push(paid);
  if (paids.length > 12) paids.shift();
  recentPaidByMatch.set(key, paids);
}

function estimatedBag(matchId: bigint, myRack: Map<string, number>) {
  const seen = seenLettersByMatch.get(String(matchId));
  const bag: Record<string, number> = { ...DEFAULT_BAG };
  for (const [l, n] of seen ?? []) bag[l] = Math.max(0, (bag[l] ?? 0) - n);
  for (const [l, n] of myRack) bag[l] = Math.max(0, (bag[l] ?? 0) - n);
  return bag;
}

function bagRemaining(conn: DbConnection, matchId: bigint): number {
  return conn.db.matchState.id.find(matchId)?.bagTotal ?? 60;
}

let myIdentity: Identity | null = null;
let myBotId: bigint | null = null;
const bidsByAuction = new Set<string>();
const lastWordAttemptByMatch = new Map<string, number>();
const WORD_RETRY_MS = 500;

function resolveMyBotId(conn: DbConnection): bigint | null {
  if (!myIdentity) return null;
  const cred = conn.db.botCredential.identity.find(myIdentity);
  return cred ? cred.botId : null;
}

function rackForMatch(
  conn: DbConnection,
  matchId: bigint,
): Map<string, number> {
  const rack = new Map<string, number>();
  for (const h of conn.db.myRack.iter()) {
    if (h.matchId !== matchId) continue;
    rack.set(h.letter, (rack.get(h.letter) ?? 0) + h.count);
  }
  return rack;
}

function participantForMatch(
  conn: DbConnection,
  matchId: bigint,
): { balance: number; score: number } | null {
  if (myBotId === null) return null;
  for (const p of conn.db.matchParticipant.iter()) {
    if (p.matchId !== matchId) continue;
    if (p.botId !== myBotId) continue;
    return { balance: Number(p.balance), score: Number(p.score) };
  }
  return null;
}

// A reducer call fails when the module refuses it, often for an expected
// reason: a word played just after its match ended, a bid that missed the
// auction's window. Log it and keep playing; an uncaught failure would stop
// the bot.
function logFailure(what: string) {
  return (err: unknown) =>
    console.warn(
      `[${BOT_NAME}] ${what} failed: ${err instanceof Error ? err.message : err}`,
    );
}

function tryBid(
  conn: DbConnection,
  auctionId: bigint,
  matchId: bigint,
  letter: string,
) {
  if (myBotId === null) return;
  const key = `${matchId}:${auctionId}`;
  if (bidsByAuction.has(key)) return;
  const participant = participantForMatch(conn, matchId);
  if (!participant) return;
  const rack = rackForMatch(conn, matchId);
  const rivalBalances: number[] = [];
  for (const p of conn.db.matchParticipant.iter()) {
    if (p.matchId === matchId && p.botId !== myBotId) {
      rivalBalances.push(Number(p.balance));
    }
  }
  const amount = decideBid({
    letter,
    myBalance: participant.balance,
    myRack: rack,
    bagRemaining: bagRemaining(conn, matchId),
    bagCounts: estimatedBag(matchId, rack),
    recentPaid: recentPaidByMatch.get(String(matchId)),
    rivalBalances,
    tilesWon: tilesWonByMatch.get(String(matchId)) ?? 0,
    marketTable: liveMarketTable(),
  });
  if (amount <= 0) return;
  conn.reducers
    .submitBid({ auctionId, amount: BigInt(amount) })
    .catch(logFailure(`bid on auction ${auctionId}`));
  bidsByAuction.add(key);
  console.log(
    `[${BOT_NAME}] bid ${amount} on '${letter}' (match ${matchId}, auction ${auctionId})`,
  );
}

function tryPlayWord(conn: DbConnection) {
  if (myBotId === null) return;
  // Only matches still being played. The bot keeps its letters from
  // matches that have ended, but can't play them.
  const matches = new Set<bigint>();
  for (const p of conn.db.matchParticipant.iter()) {
    if (p.botId !== myBotId) continue;
    const m = conn.db.matchState.id.find(p.matchId);
    if (m?.status.tag === "Running") matches.add(p.matchId);
  }
  const now = Date.now();
  for (const matchId of matches) {
    const key = String(matchId);
    if (now - (lastWordAttemptByMatch.get(key) ?? 0) < WORD_RETRY_MS) continue;
    lastWordAttemptByMatch.set(key, now);
    const word = chooseWord({
      myRack: rackForMatch(conn, matchId),
      dictionary: DICTIONARY,
      bagRemaining: bagRemaining(conn, matchId),
      myBalance: participantForMatch(conn, matchId)?.balance,
    });
    if (!word) continue;
    console.log(`[${BOT_NAME}] match ${matchId}: playing '${word}'`);
    conn.reducers
      .submitWord({ matchId, word })
      .catch(logFailure(`playing '${word}'`));
  }
}

// Subscriptions. The public tables hold every auction ever run (1.7M rows
// and counting), so subscribing to everything runs the process out of
// memory, and subscribing per match costs a server round trip at the
// moment the match starts, during which the first dozen auctions close
// unseen. Instead we keep one rolling *range* subscription: every
// match_state / auction / auction_result / match_participant row with a
// match id above the last match we finished. The next match's rows are
// already streaming when it begins. We re-arm with a higher threshold
// after each of our matches ends and drop the old range.
let rangeSubs: SubscriptionHandle[] = [];
let rangeThreshold = -1n;
const ourMatches = new Set<string>();

function armRange(conn: DbConnection, threshold: bigint) {
  if (threshold <= rangeThreshold) return;
  rangeThreshold = threshold;
  const old = rangeSubs;
  let applied = 0;
  const queries = [
    tables.matchState.where((r) => r.id.gt(threshold)),
    tables.matchParticipant.where((r) => r.matchId.gt(threshold)),
    tables.auction.where((r) => r.matchId.gt(threshold)),
    tables.auctionResult.where((r) => r.matchId.gt(threshold)),
  ];
  rangeSubs = queries.map((q) =>
    conn
      .subscriptionBuilder()
      .onApplied(() => {
        applied++;
        if (applied === queries.length) {
          console.log(`[${BOT_NAME}] watching matches > ${threshold}`);
          // Drop the previous range only once the new one is live.
          for (const h of old) {
            try {
              h.unsubscribe();
            } catch {
              // already gone
            }
          }
          refreshOurMatches(conn);
          bootstrapActivity(conn);
        }
      })
      .subscribe(q),
  );
}

function refreshOurMatches(conn: DbConnection) {
  if (myBotId === null) return;
  for (const p of conn.db.matchParticipant.iter()) {
    if (p.botId === myBotId) ourMatches.add(String(p.matchId));
  }
}

function subscribeToMyMatches(conn: DbConnection) {
  if (myBotId === null) return;
  const me = myBotId;
  // One-off: find our most recent match id so the range starts just
  // below it (covers a match we're mid-way through after a restart).
  conn
    .subscriptionBuilder()
    .onApplied(() => {
      let latest = -1n;
      for (const p of conn.db.matchParticipant.iter()) {
        if (p.botId === me && p.matchId > latest) latest = p.matchId;
      }
      armRange(conn, latest > 0n ? latest - 1n : 0n);
    })
    .subscribe(tables.matchParticipant.where((r) => r.botId.eq(me)));
}

function onConnect(conn: DbConnection, identity: Identity, token: string) {
  myIdentity = identity;
  saveToken(token);
  console.log(`[${BOT_NAME}] connected as ${identity.toHexString()}`);

  conn
    .subscriptionBuilder()
    .onApplied(() => {
      console.log(`[${BOT_NAME}] global subscription applied`);

      // Resolve our bot id, possibly after claiming a nonce.
      myBotId = resolveMyBotId(conn);
      if (myBotId === null) {
        if (BOT_NONCE) {
          console.log(`[${BOT_NAME}] claiming credential with nonce…`);
          conn.reducers
            .claimCredential({ code: BOT_NONCE })
            .catch(logFailure("claiming the credential"));
          setTimeout(() => {
            myBotId = resolveMyBotId(conn);
            if (myBotId === null) {
              console.error(
                `[${BOT_NAME}] couldn't claim credential. Bad / expired nonce?`,
              );
              process.exit(1);
            }
            const bot = conn.db.bot.id.find(myBotId);
            console.log(
              `[${BOT_NAME}] claimed credential for bot '${bot?.name ?? "?"}' (id ${myBotId})`,
            );
            subscribeToMyMatches(conn);
          }, 1000);
          return;
        } else {
          console.error(
            `[${BOT_NAME}] no BotCredential for this token. Set BOT_TOKEN or BOT_NONCE and re-run.`,
          );
          process.exit(1);
        }
      }

      const bot = conn.db.bot.id.find(myBotId);
      console.log(
        `[${BOT_NAME}] acting as bot '${bot?.name ?? "?"}' (id ${myBotId})`,
      );
      subscribeToMyMatches(conn);
    })
    .subscribe([
      tables.bot,
      tables.botCredential,
      tables.openLobbies,
      tables.openLobbyMembers,
      tables.myRack,
    ]);

  // A new participant row for us means a new match has started.
  conn.db.matchParticipant.onInsert((_ctx, p) => {
    if (myBotId !== null && p.botId === myBotId) {
      ourMatches.add(String(p.matchId));
      console.log(`[${BOT_NAME}] in match ${p.matchId}`);
      for (const a of conn.db.auction.iter()) {
        if (a.matchId === p.matchId && a.status.tag === "Open") {
          tryBid(conn, a.id, a.matchId, a.letter);
        }
      }
    }
  });

  conn.db.auction.onInsert((_ctx: EventContext, a) => {
    if (a.status.tag === "Open") tryBid(conn, a.id, a.matchId, a.letter);
  });
  conn.db.myRack.onInsert(() => tryPlayWord(conn));
  conn.db.myRack.onUpdate(() => tryPlayWord(conn));
  conn.db.botCredential.onInsert(() => {
    if (myBotId === null) myBotId = resolveMyBotId(conn);
  });
  conn.db.auctionResult.onInsert((_ctx, r) => {
    noteAuctionResult(r.matchId, r.letter, Number(r.paid));
    noteMarket(r.matchId, r.letter, Number(r.paid));
    if (myBotId === null) return;
    if (r.winnerBotId !== undefined && r.winnerBotId !== null && r.winnerBotId === myBotId) {
      const k = String(r.matchId);
      tilesWonByMatch.set(k, (tilesWonByMatch.get(k) ?? 0) + 1);
    }
    const winner =
      r.winnerBotId !== undefined && r.winnerBotId !== null
        ? String(r.winnerBotId)
        : "no-bid";
    const mine = winner === String(myBotId) ? " (us)" : "";
    if (!ourMatches.has(String(r.matchId))) return;
    console.log(
      `[${BOT_NAME}] match ${r.matchId} '${r.letter}' → bot ${winner}${mine} paid ${r.paid}`,
    );
  });

  // Re-evaluate word play after each auction closes; when a match we were
  // in ends, report, drop its subscriptions and hop back into the lobby.
  conn.db.matchState.onUpdate((_ctx, old, neu) => {
    if (myBotId === null) return;
    if (neu.status.tag === "Running" && old.bagTotal !== neu.bagTotal) {
      tryPlayWord(conn);
    }
    if (old.status.tag !== "Ended" && neu.status.tag === "Ended") {
      const parts = Array.from(conn.db.matchParticipant.iter()).filter(
        (p) => p.matchId === neu.id,
      );
      const mine = parts.find((p) => p.botId === myBotId);
      if (mine) {
        console.log(
          `[${BOT_NAME}] match ${neu.id} ended: score ${mine.score}, balance left ${mine.balance}`,
        );
        const t = liveMarketTable();
        console.log(
          `[${BOT_NAME}] market: p4 ${t.p4.join("/")}  p58 ${t.p58.join("/")}  pZQ ${t.pZQ.join("/")}`,
        );
        seenLettersByMatch.delete(String(neu.id));
        recentPaidByMatch.delete(String(neu.id));
        tilesWonByMatch.delete(String(neu.id));
        auctionsSeenByMatch.delete(String(neu.id));
        // Move the range up past this match; the next one is already
        // covered by the current range until the new one applies.
        armRange(conn, neu.id);
        joinLobby(conn);
      }
    }
  });
}

function joinLobby(conn: DbConnection) {
  if (myBotId === null) return;
  const inRunning = Array.from(conn.db.matchParticipant.iter()).some((p) => {
    if (p.botId !== myBotId) return false;
    const m = conn.db.matchState.id.find(p.matchId);
    return m?.status.tag === "Running";
  });
  if (inRunning) return;
  const openLobby = Array.from(conn.db.openLobbies.iter())[0];
  const alreadyIn =
    openLobby !== undefined &&
    Array.from(conn.db.openLobbyMembers.iter()).some(
      (lm) => lm.lobbyId === openLobby.id && lm.botId === myBotId,
    );
  if (alreadyIn) return;
  console.log(`[${BOT_NAME}] joining lobby`);
  conn.reducers.joinLobby({}).catch(logFailure("joining the lobby"));
}

function bootstrapActivity(conn: DbConnection) {
  if (TOURNAMENT_ID) {
    conn.reducers
      .registerForTournament({ tournamentId: BigInt(TOURNAMENT_ID) })
      .then(() =>
        console.log(`[${BOT_NAME}] registered for tournament ${TOURNAMENT_ID}`),
      )
      .catch(logFailure(`registering for tournament ${TOURNAMENT_ID}`));
  }
  joinLobby(conn);
  for (const a of conn.db.auction.iter()) {
    if (a.status.tag === "Open") tryBid(conn, a.id, a.matchId, a.letter);
  }
  tryPlayWord(conn);
}

// The lobby view updates whenever a lobby resolves; if we're idle, join.
setInterval(() => {
  if (currentConn && myBotId !== null) joinLobby(currentConn);
}, 15_000);
let currentConn: DbConnection | null = null;

function main() {
  console.log(`[${BOT_NAME}] connecting to ${DB_NAME} at ${HOST}`);
  DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB_NAME)
    .withToken(BOT_TOKEN ?? loadToken())
    .onConnect((conn, identity, token) => {
      currentConn = conn;
      onConnect(conn, identity, token);
    })
    .onConnectError((_ctx: ErrorContext, err: Error) => {
      console.error("connect error:", err.message, "- retrying in 3s");
      setTimeout(main, 3000);
    })
    .onDisconnect(() => {
      console.log("disconnected - reconnecting in 3s");
      currentConn = null;
      rangeSubs = [];
      rangeThreshold = -1n;
      setTimeout(main, 3000);
    })
    .build();
}

main();
