import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalDigest, canonicalJson } from "../contracts.ts";
import type { CanonicalValue } from "../contracts.ts";
import type { AuthorityRecords, AuthorityTables } from "../auth/authority.ts";
import { DurableReceipt, Stage, TurnImage } from "./contracts.ts";
import type { Access } from "./contracts.ts";

export const branchKey = (scope: Access) => canonicalJson([scope.owner_id, scope.session_id, scope.branch_id]);
const dispositions = ["active", "cancelled", "expired"] as const;
const requestRow = z.object({
  envelope: z.string(), proposal: z.string().nullable(), stage: z.string().nullable(),
  claim: z.string().nullable(), committed_candidate: z.string().nullable(), committed_digest: z.string().nullable(), receipt: z.string().nullable(), cancelled: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});
const parseJson = (text: string): unknown => JSON.parse(text) as unknown;

export class SQLiteTurns {
  private readonly db: DatabaseSync;
  private readonly token = randomUUID();

  constructor(path: string) {
    this.db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      this.db.exec("PRAGMA busy_timeout=1000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL");
      const settings = [
        ["journal_mode", "delete"], ["synchronous", 2], ["foreign_keys", 1], ["busy_timeout", 1000],
      ] as const;
      for (const [name, expected] of settings) {
        if (this.db.prepare("PRAGMA " + name).get()?.[name === "busy_timeout" ? "timeout" : name] !== expected) throw new Error("Unsupported SQLite setting: " + name);
      }
      this.atomic(() => {
        const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
        if (version !== 0 && version !== 1 && version !== 2) throw new Error("Unsupported turn database version.");
        this.db.exec("CREATE TABLE IF NOT EXISTS coordinator (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL) STRICT");
        this.db.exec("CREATE TABLE IF NOT EXISTS authority (area TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(area,key)) STRICT");
        this.db.exec("CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, digest TEXT NOT NULL, body TEXT NOT NULL, published INTEGER NOT NULL, claim TEXT) STRICT");
        this.db.exec("CREATE TABLE IF NOT EXISTS heads (branch TEXT PRIMARY KEY, checkpoint TEXT NOT NULL REFERENCES checkpoints(id)) STRICT");
        this.db.exec("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, envelope TEXT NOT NULL, proposal TEXT, stage TEXT, claim TEXT, receipt TEXT, cancelled INTEGER NOT NULL DEFAULT 0, checkpoint TEXT REFERENCES checkpoints(id)) STRICT");
        this.db.exec("CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, request TEXT NOT NULL REFERENCES requests(id), body TEXT NOT NULL) STRICT");
        if (version !== 2) {
          this.db.exec("ALTER TABLE requests ADD COLUMN committed_candidate TEXT");
          this.db.exec("ALTER TABLE requests ADD COLUMN committed_digest TEXT");
          this.db.exec("PRAGMA user_version=2");
        }
        this.db.exec("CREATE TABLE IF NOT EXISTS fixture_records (area TEXT NOT NULL, key TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(area,key)) STRICT");
        this.db.exec("CREATE TABLE IF NOT EXISTS fixture_drafts (branch TEXT PRIMARY KEY, checkpoint TEXT NOT NULL UNIQUE, digest TEXT NOT NULL, body TEXT NOT NULL) STRICT");
        this.db.prepare("INSERT INTO coordinator VALUES(1,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token").run(this.token);
        this.db.exec("UPDATE requests SET claim=NULL WHERE receipt IS NULL");
        // Keep branch freshness and one-turn tombstones. Restart never resurrects Editor mode or permits.
        this.db.exec("UPDATE authority SET value=json_set(value,'$.mode','PLAY','$.epoch',json_extract(value,'$.epoch')+1) WHERE area='states'");
        this.db.exec("DELETE FROM authority WHERE area IN ('leases','candidates','requestCandidates')");
        this.db.exec("UPDATE requests SET stage=NULL WHERE receipt IS NULL AND json_extract(stage,'$.editor')=1");
      }, true);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void { this.db.close(); }

  transaction<T>(run: () => T): T { return this.atomic(run, false); }

  private atomic<T>(run: () => T, startup: boolean): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!startup && this.db.prepare("SELECT token FROM coordinator WHERE id=1").get()?.token !== this.token) {
        throw new Error("This turn coordinator has been replaced.");
      }
      const result = run();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  readonly authority: AuthorityTables = <K extends keyof AuthorityRecords>(area: K) => {
    const table = {
      has: (key: string) => this.db.prepare("SELECT 1 FROM authority WHERE area=? AND key=?").get(area, key) !== undefined,
      get: (key: string) => {
        const row = this.db.prepare("SELECT value FROM authority WHERE area=? AND key=?").get(area, key);
        return typeof row?.value === "string" ? parseJson(row.value) as AuthorityRecords[K] : undefined;
      },
      set: (key: string, value: AuthorityRecords[K]) => {
        if (!this.db.isTransaction) throw new Error("Authority writes require a transaction.");
        this.db.prepare("INSERT INTO authority VALUES(?,?,?) ON CONFLICT(area,key) DO UPDATE SET value=excluded.value")
          .run(area, key, JSON.stringify(value));

      },
    };
    return table;
  };

  head(scope: Access): TurnImage | undefined {
    const row = this.db.prepare("SELECT c.body,c.digest FROM heads h JOIN checkpoints c ON h.checkpoint=c.id WHERE h.branch=? AND c.published=1")
      .get(branchKey(scope));
    if (!row) return undefined;
    const image = TurnImage.parse(parseJson(z.string().parse(row.body)));
    if (canonicalDigest(image) !== row.digest) throw new Error("Checkpoint digest mismatch.");
    return image;
  }

  draft(scope: Access): TurnImage | undefined {
    const row = this.db.prepare("SELECT body,digest FROM fixture_drafts WHERE branch=?").get(branchKey(scope));
    if (!row) return undefined;
    const image = TurnImage.parse(parseJson(z.string().parse(row.body)));
    if (canonicalDigest(image) !== row.digest) throw new Error("Draft digest mismatch.");
    return image;
  }

  initializeDraft(image: TurnImage): void {
    this.db.prepare("INSERT INTO fixture_drafts VALUES(?,?,?,?)")
      .run(branchKey(image.snapshot.head), image.checkpoint.checkpoint_id, canonicalDigest(image), canonicalJson(image));
  }

  fixtureRecord(area: "launch" | "session" | "source" | "compilation", key: string): unknown {
    const row = this.db.prepare("SELECT body FROM fixture_records WHERE area=? AND key=?").get(area, key);
    return typeof row?.body === "string" ? parseJson(row.body) : undefined;
  }

  saveFixtureRecord(area: "launch" | "session" | "source" | "compilation", key: string, body: CanonicalValue): void {
    this.db.prepare("INSERT INTO fixture_records VALUES(?,?,?) ON CONFLICT(area,key) DO UPDATE SET body=excluded.body")
      .run(area, key, canonicalJson(body));
  }

  fixtureReceipts(scope: Access, limit: number): DurableReceipt[] {
    return this.db.prepare(
      "SELECT receipt FROM requests WHERE receipt IS NOT NULL AND json_extract(id,'$.owner_id')=? " +
      "AND json_extract(id,'$.session_id')=? AND json_extract(id,'$.branch_id')=? " +
      "ORDER BY json_extract(receipt,'$.receipt.revision') DESC LIMIT ?",
    ).all(scope.owner_id, scope.session_id, scope.branch_id, limit)
      .map(({ receipt }) => DurableReceipt.parse(parseJson(z.string().parse(receipt))));
  }

  hasCheckpoint(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM checkpoints WHERE id=? UNION ALL SELECT 1 FROM fixture_drafts WHERE checkpoint=?").get(id, id) !== undefined;
  }

  initialize(image: TurnImage): void {
    this.insertCheckpoint(image, null);
    this.db.prepare("UPDATE checkpoints SET published=1 WHERE id=?").run(image.checkpoint.checkpoint_id);
    this.db.prepare("INSERT INTO heads VALUES(?,?)").run(branchKey(image.snapshot.head), image.checkpoint.checkpoint_id);
  }

  request(id: string) {
    const row = this.db.prepare("SELECT envelope,proposal,stage,claim,receipt,cancelled,committed_candidate,committed_digest FROM requests WHERE id=?").get(id);
    if (!row) return undefined;
    const data = requestRow.parse(row);
    const stage = data.stage === null ? null : Stage.parse(parseJson(data.stage));
    const receipt = data.receipt === null ? null : DurableReceipt.parse(parseJson(data.receipt));
    return { ...data, stage, receipt, disposition: dispositions[data.cancelled] };
  }

  bind(id: string, envelope: string, stage: Stage): void {
    this.db.prepare("INSERT INTO requests(id,envelope,proposal,stage) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET stage=excluded.stage")
      .run(id, envelope, stage.handle.proposal_digest, canonicalJson(stage));
  }

  claim(id: string, claim: string | null): void {
    this.db.prepare("UPDATE requests SET claim=? WHERE id=? AND receipt IS NULL").run(claim, id);
  }

  cancel(id: string, reason: "cancelled" | "expired" = "cancelled"): void {
    this.db.prepare("UPDATE requests SET cancelled=?,stage=NULL,claim=NULL WHERE id=? AND receipt IS NULL")
      .run(dispositions.indexOf(reason), id);
  }

  insertCheckpoint(image: TurnImage, claim: string | null): void {
    this.db.prepare("INSERT INTO checkpoints VALUES(?,?,?,0,?)")
      .run(image.checkpoint.checkpoint_id, canonicalDigest(image), canonicalJson(image), claim);
  }

  publish(id: string, claim: string, old: TurnImage, image: TurnImage, receipt: DurableReceipt,
    events: readonly CanonicalValue[], stage: Stage, draft: boolean): void {
    const value = image.checkpoint.checkpoint_id;
    const checkpoint = this.db.prepare("UPDATE checkpoints SET published=1,claim=NULL WHERE id=? AND claim=? AND published=0 AND digest=?")
      .run(value, claim, canonicalDigest(image));
    if (checkpoint.changes !== 1) throw new Error("Staged checkpoint is missing.");
    const branch = branchKey(old.snapshot.head);
    let head;
    if (draft) {
      const removed = this.db.prepare("DELETE FROM fixture_drafts WHERE branch=? AND checkpoint=?")
        .run(branch, old.checkpoint.checkpoint_id);
      if (removed.changes !== 1) throw new Error("Draft base changed.");
      head = this.db.prepare("INSERT INTO heads VALUES(?,?)").run(branch, value);
    } else {
      head = this.db.prepare("UPDATE heads SET checkpoint=? WHERE branch=? AND checkpoint=?")
        .run(value, branch, old.checkpoint.checkpoint_id);
    }
    if (head.changes !== 1) throw new Error("Committed head changed.");
    for (const [index, event] of events.entries()) {
      const eventId = receipt.receipt.event_ids[index];
      if (!eventId) throw new Error("Missing event ID.");
      this.db.prepare("INSERT INTO events VALUES(?,?,?)").run(eventId, id, canonicalJson(event));
    }
    const saved = this.db.prepare("UPDATE requests SET receipt=?,checkpoint=?,committed_candidate=?,committed_digest=?,claim=NULL,stage=NULL WHERE id=? AND claim=? AND receipt IS NULL")
      .run(canonicalJson(receipt), value, stage.handle.candidate_id, stage.diff_digest, id, claim);
    if (saved.changes !== 1) throw new Error("Request claim changed.");
  }

  collect(now: number): number {
    const discarded = this.db.prepare("DELETE FROM checkpoints WHERE published=0 AND (claim IS NULL OR claim NOT IN (SELECT claim FROM requests WHERE claim IS NOT NULL))")
      .run();
    this.db.prepare("UPDATE requests SET cancelled=CASE WHEN json_extract(stage,'$.editor')=1 THEN 2 ELSE cancelled END, stage=NULL WHERE claim IS NULL AND json_extract(stage,'$.handle.expires_at')<=?")
      .run(new Date(now).toISOString());
    this.db.prepare("DELETE FROM authority WHERE area IN ('leases','candidates') AND json_extract(value,'$.expires')<=?").run(now);
    this.db.exec("DELETE FROM authority WHERE area='requestCandidates' AND NOT EXISTS (SELECT 1 FROM authority AS candidate WHERE candidate.area='candidates' AND candidate.key=json_extract(authority.value,'$'))");
    return Number(discarded.changes);
  }
}

/** Synchronous atomic storage boundary for one active coordinator per database. */
export type TurnStore = Pick<SQLiteTurns, "transaction" | "close" | "authority" | "head" | "initialize" |
  "draft" | "initializeDraft" | "fixtureRecord" | "saveFixtureRecord" | "fixtureReceipts" | "hasCheckpoint" | "request" | "bind" | "claim" | "cancel" | "insertCheckpoint" | "publish" | "collect">;
