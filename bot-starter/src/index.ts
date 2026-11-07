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
  const amount = decideBid({
    letter,
    myBalance: participant.balance,
    myRack: rack,
    bagRemaining: bagRemaining(conn, matchId),
    bagCounts: estimatedBag(matchId, rack),
    recentPaid: recentPaidByMatch.get(String(matchId)),
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
// memory. We subscribe in two phases:
//   1. Small global tables + per-user views: bot, bot_credential, the
//      open-lobby views, and my_rack.
//   2. Once we know our bot id: our match_participant rows. For each match
//      we're in, the match_state row, its auctions and its results.
const matchSubs = new Map<string, SubscriptionHandle[]>();

function subscribeToMatch(conn: DbConnection, matchId: bigint) {
  const key = String(matchId);
  if (matchSubs.has(key)) return;
  const handles = [
    tables.matchState.where((r) => r.id.eq(matchId)),
    tables.auction.where((r) => r.matchId.eq(matchId)),
    tables.auctionResult.where((r) => r.matchId.eq(matchId)),
  ].map((q) =>
    conn
      .subscriptionBuilder()
      .onApplied(() => {
        // After a restart we see our old matches too; drop finished ones.
        const m = conn.db.matchState.id.find(matchId);
        if (m && m.status.tag === "Ended") {
          unsubscribeFromMatch(matchId);
          return;
        }
        // Catch an auction that opened before the subscription landed.
        for (const a of conn.db.auction.iter()) {
          if (a.matchId === matchId && a.status.tag === "Open") {
            tryBid(conn, a.id, a.matchId, a.letter);
          }
        }
        tryPlayWord(conn);
      })
      .subscribe(q),
  );
  matchSubs.set(key, handles);
  console.log(`[${BOT_NAME}] subscribed to match ${matchId}`);
}

function unsubscribeFromMatch(matchId: bigint) {
  const key = String(matchId);
  for (const h of matchSubs.get(key) ?? []) {
    try {
      h.unsubscribe();
    } catch {
      // already gone
    }
  }
  matchSubs.delete(key);
  seenLettersByMatch.delete(key);
  recentPaidByMatch.delete(key);
}

function subscribeToMyMatches(conn: DbConnection) {
  if (myBotId === null) return;
  const me = myBotId;
  conn
    .subscriptionBuilder()
    .onApplied(() => {
      for (const p of conn.db.matchParticipant.iter()) {
        if (p.botId === me) subscribeToMatch(conn, p.matchId);
      }
      bootstrapActivity(conn);
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

  // A new participant row for us means a new match: follow it.
  conn.db.matchParticipant.onInsert((_ctx, p) => {
    if (myBotId !== null && p.botId === myBotId) {
      subscribeToMatch(conn, p.matchId);
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
    if (myBotId === null) return;
    const winner =
      r.winnerBotId !== undefined && r.winnerBotId !== null
        ? String(r.winnerBotId)
        : "no-bid";
    const mine = winner === String(myBotId) ? " (us)" : "";
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
        // Keep the subscription briefly so late events settle, then drop.
        setTimeout(() => unsubscribeFromMatch(neu.id), 5000);
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
    .onConnectError((_ctx: ErrorContext, err: Error) =>
      console.error("connect error:", err.message),
    )
    .onDisconnect(() => console.log("disconnected"))
    .build();
}

main();
