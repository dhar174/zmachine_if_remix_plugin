import { writeSync } from "node:fs";
import { TurnService } from "../src/turn/service.ts";
import { amendment, makeFixture, play, take } from "./turn-fixture.ts";

const [, , db, stop, edit] = process.argv;
if (!db) throw new Error("Missing fixture database.");
const service = new TurnService(db, makeFixture(), () => 1000, (point) => {
  if (point !== stop) return;
  writeSync(1, JSON.stringify({ point }) + "\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
});
const request = edit ? amendment() : { ...play(), context: null };
take(service.initialize(request.state));
if (edit) take(service.browser.control(request.access.owner_id, request.state.snapshot.head, "request:mode", "/edit"));
const preparation = take(service.prepareTurn(request.access, request.envelope, request.proposal, request.context));
if (preparation.kind !== "prepared") throw new Error("Expected a staged candidate.");
const candidate = preparation.handle.candidate_id;
const grant = edit ? take(service.browser.confirm(request.access.owner_id, candidate, preparation.diff_digest)) : undefined;
writeSync(1, JSON.stringify({ candidate }) + "\n");
take(await service.commitTurn(request.access, request.envelope, candidate, grant && {
  candidate_id: candidate, diff_digest: preparation.diff_digest, source: "approval", reference: grant.grant_id,
}));
service.close();
