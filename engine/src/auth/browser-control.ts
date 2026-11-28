import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { HeadExpectation, OwnerId } from "../contracts.ts";
import type { Authority } from "./authority.ts";
import { storyUploadBytes } from "../native/checkpoint.ts";
import { capture, digest, opaque, requestId, sessionRef, subset, target } from "../fixture/session-contracts.ts";
import type { TurnService } from "../turn/service.ts";
import { restoreId, saveId } from "../fixture/recovery-contracts.ts";
import { portableBytes, uploadPurpose } from "../fixture/portable-session.ts";

export interface BrowserSession {
  readonly owner: z.infer<typeof OwnerId>;
  readonly csrf: string;
}

/** This verifier must authenticate a browser session independently of tool credentials. */
export type BrowserVerifier = (request: IncomingMessage) => BrowserSession | undefined;
const candidateId = z.string().regex(/^candidate:[0-9a-f-]{36}$/u);
const approve = z.strictObject({ candidate: candidateId, digest: z.string().regex(/^[a-f0-9]{64}$/u) });
const controls = z.strictObject({ head: HeadExpectation, request_id: z.string().regex(/^request:[A-Za-z0-9._:-]+$/u).max(256),
  command: z.string().max(4096) });
const lease = z.strictObject({ head: HeadExpectation, fields: z.array(z.strictObject({
  entity_id: z.string().max(256), field: z.string().max(256),
})).max(32), duration: z.int(), uses: z.int() });
const escaped = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > 16_384) throw new Error("Control request too large");
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks).toString("utf8");
  if (request.headers["content-type"] === "application/json") return JSON.parse(data) as unknown;
  if (request.headers["content-type"] !== "application/x-www-form-urlencoded") throw new Error("Unsupported content type");
  const values = new URLSearchParams(data);
  if (new Set(values.keys()).size !== [...values.keys()].length) throw new Error("Duplicate form fields");
  return Object.fromEntries(values);
}

/** Framework-neutral local control endpoints. No tool route is mounted here. */
type FixtureControl = Pick<TurnService, "fixtureProfile" | "issueFixtureLaunch" | "readFixture" | "recordFixtureSource" |
  "readFixtureSubset" | "selectFixtureSubset" | "recovery" | "privateStories" | "uploadPrivateStory" | "revokePrivateUpload" |
  "listPrivateSessions" | "managePrivateSession" | "deletePrivateSession" | "authorizePrivateDownload" | "exportPrivateSession" | "importPrivateSession">;
const restoreForm = z.strictObject({ id: restoreId, digest });
const fixtureMode = target.extend({ command: z.enum(["/play", "/edit"]) });
const subsetForm = subset.omit({ clause_ids: true }).extend({ clause_ids: z.string().max(8192) });
const formRevision = (value: unknown) => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;

export function browserControl(authority: Pick<Authority, "display" | "confirm" | "control" | "issueLease" | "revokeCandidate" | "revokeLease">,
  origin: string, verifyBrowser: BrowserVerifier | null, fixture?: FixtureControl) {
  if (new URL(origin).origin !== origin) throw new Error("Use an exact control origin.");
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const reply = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(value));
    };
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-security-policy", "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    try {
      const url = new URL(request.url ?? "/", origin);
      if (request.headers.host !== new URL(origin).host || url.origin !== origin) return reply(403, { error: "CONTROL_ORIGIN" });
      if (!verifyBrowser) return reply(409, { error: "NEEDS_APPROVAL", reason: "Authenticated browser control is unavailable." });
      const session = verifyBrowser(request);
      if (!session) return reply(401, { error: "BROWSER_AUTH_REQUIRED" });
      const result = <T>(value: import("../ports.ts").Result<T>) =>
        reply(value.ok ? 200 : value.error.status === "VALIDATION_FAILED" ? 404 : 409, value);
      const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${escaped(value)}">`;
      const csrfField = hidden("csrf", session.csrf);
      const page = (title: string, content: string) => {
        // Same-origin form submissions need their Origin header for the POST check below.
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "referrer-policy": "same-origin" });
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>${title}</title><h1>${title}</h1>${content}</html>`);
      };
      if (fixture?.privateStories && request.method === "GET" && url.pathname === "/private-sessions") {
        const sessions = fixture.listPrivateSessions(session.owner);
        if (!sessions.ok) return result(sessions);
        const links = sessions.value.map(({ session_id, branch_id }) =>
          `<li><a href="/private-session?session_id=${encodeURIComponent(session_id)}&amp;branch_id=${encodeURIComponent(branch_id)}">${escaped(session_id)}</a></li>`).join("");
        page("Your private adventures", `<ul>${links}</ul><p><a href="/private-story">Import a story</a></p>`);
        return;
      }
      if (fixture?.privateStories && request.method === "GET" && url.pathname === "/private-session") {
        const scope = sessionRef.safeParse({ session_id: url.searchParams.get("session_id"), branch_id: url.searchParams.get("branch_id") });
        if (!scope.success) return reply(404, { error: "UNAVAILABLE" });
        const access = { ...scope.data, owner_id: session.owner };
        const manage = fixture.managePrivateSession(access);
        if (!manage.ok) return result(manage);
        const fields = hidden("session_id", scope.data.session_id) + hidden("branch_id", scope.data.branch_id);
        const forms = manage.value.map((id) => `<li><form method="post" action="/private-export-review">
          ${csrfField}${fields}${hidden("save_id", id)}<button>Review export of ${escaped(id)}</button></form></li>`).join("");
        page("Manage private adventure", `<p>Use these references to reopen this adventure in ChatGPT.</p>
          <dl><dt>Session</dt><dd>${escaped(scope.data.session_id)}</dd><dt>Branch</dt><dd>${escaped(scope.data.branch_id)}</dd></dl><ul>${forms}</ul>
          <p>Deleting this adventure removes its story, session and ${manage.value.length} combined saves from the engine.</p>
          <p>Downloaded copies, backups and ChatGPT conversations have their own retention.</p>
          <form method="post" action="/private-delete">${csrfField}${fields}
          <label><input type="checkbox" name="confirmed" value="yes" required> Delete this adventure and its saves</label>
          <button>Delete private adventure</button></form>`);
        return;
      }
      if (fixture?.privateStories && request.method === "GET" &&
          (url.pathname === "/private-story" || url.pathname === "/private-import")) {
        const importing = url.pathname === "/private-import";
        const nonce = randomBytes(18).toString("base64");
        response.setHeader("content-security-policy", "default-src 'none'; script-src 'nonce-" + nonce +
          "'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
        const path = importing ? "/private-import" : "/private-story";
        const controls = importing
          ? `<label>Unused matching-story handle <input name="story" required></label>${hidden("request", randomUUID())}`
          : `<label>Use this file to <select name="purpose"><option value="open">Start a new adventure</option>
            <option value="combined">Import a combined save</option></select></label>`;
        page(importing ? "Import a private combined save" : "Import a private Z5 story", `<p>${importing
          ? "Upload the matching story first and keep its handle unused. Choose the combined save from your device."
          : "Choose a supported Z5 story from your device."}
          The engine stores the original bytes privately until you delete the adventure.
          Story output and approved directive text can enter your ChatGPT conversation.</p>
          <form id="upload" method="post">${csrfField}${controls}<label>File <input type="file" required></label>
          <label><input type="checkbox" name="consent" required> I consent to sending this file to the private engine.</label>
          <button>Upload and authorize import</button></form><pre role="status"></pre>
          <script nonce="${nonce}">
            const form = document.querySelector('#upload');
            const status = document.querySelector('[role=status]');
            const button = form.querySelector('button');
            form.addEventListener('submit', async (event) => {
              event.preventDefault();
              button.disabled = true;
              status.textContent = 'Uploading…';
              try {
                const extra = ${importing} ? {
                  'X-Story-Handle': form.elements.story.value, 'X-Import-Request': form.elements.request.value,
                } : { 'X-Upload-Purpose': form.elements.purpose.value };
                const response = await fetch('${path}', {
                  method: 'POST',
                  headers: {'Content-Type': 'application/octet-stream', 'X-CSRF-Token': form.elements.csrf.value,
                    'X-Upload-Consent': form.elements.consent.checked ? 'yes' : '', ...extra},
                  body: form.querySelector('input[type=file]').files[0],
                });
                const result = await response.json();
                if (!result.ok) status.textContent = 'Upload rejected.';
                else if (${importing}) {
                  status.textContent = 'Imported into Play. Share these session identifiers with ChatGPT: ' +
                    result.value.head.session_id + ' / ' + result.value.head.branch_id;
                  button.hidden = true;
                } else {
                  const destination = form.elements.purpose.value === 'open' ? 'to ChatGPT' : 'to the combined save page';
                  status.textContent = 'Copy this single-use handle ' + destination + ': ' + result.value;
                  document.querySelector('#revoke input[name=handle]').value = result.value;
                  document.querySelector('#revoke').hidden = false;
                  form.reset();
                }
              } catch { status.textContent = 'Upload did not finish.'; }
              finally { button.disabled = false; }
            });
          </script>${importing ? "" : `<form id="revoke" hidden method="post" action="/private-story-revoke">
          ${csrfField}<input type="hidden" name="handle"><button>Revoke this upload</button></form>
          <p><a href="/private-import">Import a combined save instead</a></p>`}`);
        return;
      }
      if (fixture && request.method === "GET" && url.pathname === "/session") {
        const native = fixture.fixtureProfile === "native-z5";
        const disclosure = native
          ? "The bundled Z5 story runs its opening and the authored SEED 42 command before the recoverable draft. " +
            "Setup advances native time and is included in the opening record. Fixture state and directives are stored locally. " +
            "The MCP client receives authorized fixture output and directive text. Use synthetic text only."
          : "The service stores synthetic fixture state and browser-recorded directives locally. " +
            "Authorized directive text and visible facts are sent to ChatGPT. Use synthetic text only. " +
            "ChatGPT retains chat data according to your account settings. The local trial store is retained for verification until removed.";
        page(native ? "Open the bundled Z5 fixture" : "Open the synthetic fixture", "<p>" + disclosure + "</p>" +
          (fixture.privateStories ? '<p><a href="/private-story">Import a private story</a> · <a href="/private-sessions">Your private adventures</a></p>' : "") +
          `<form method="post" action="/fixture-launch">${csrfField}<button>Consent and create launch handle</button></form>`);
        return;
      }
      if (fixture && request.method === "GET" && url.pathname === "/fixture-control") {
        const scope = sessionRef.safeParse({ session_id: url.searchParams.get("session_id"), branch_id: url.searchParams.get("branch_id") });
        const logical = requestId.safeParse(url.searchParams.get("request_id"));
        if (!scope.success || !logical.success) return reply(404, { error: "UNAVAILABLE" });
        const access = { owner_id: session.owner, ...scope.data };
        const view = fixture.readFixture(access);
        if (!view.ok) return result(view);
        const { head, state } = view.value;
        const fields = Object.entries({ ...head, request_id: logical.data }).map(([key, value]) => hidden(key, String(value))).join("");
        const choices = state === "draft" ? '<option value="initial">Initial directive</option>' :
          '<option value="assignment">One-time assignment</option><option value="amendment">Policy amendment</option>';
        const mode = state === "draft" ? "" : `<form method="post" action="/fixture-mode">${csrfField}${fields}
          <button name="command" value="/play">Use Play mode</button><button name="command" value="/edit">Use Editor mode</button></form>`;
        page("Record a fixture directive", `<form method="post" action="/fixture-source">${csrfField}${fields}
          <label>Purpose <select name="purpose">${choices}</select></label>
          <label>Exact directive <textarea name="text" required maxlength="4096"></textarea></label>
          <button>Record directive</button></form>${mode}` + (fixture.privateStories && fixture.managePrivateSession(access).ok
          ? `<p><a href="/private-session?session_id=${encodeURIComponent(head.session_id)}&amp;branch_id=${encodeURIComponent(head.branch_id)}">Manage private adventure</a></p>`
          : ""));
        return;
      }
      if (fixture && request.method === "GET" && url.pathname === "/fixture-subset") {
        const ref = opaque("source").safeParse(url.searchParams.get("id"));
        if (!ref.success) return reply(404, { error: "UNAVAILABLE" });
        const preview = fixture.readFixtureSubset(session.owner, ref.data);
        if (!preview.ok) return result(preview);
        const clauses = preview.value.clauses.map(({ id, quote, status, requires }) =>
          `<li><code>${escaped(id)}</code> (${escaped(status)}): ${escaped(quote)}${requires.length ? " (requires " +
            escaped(requires.join(", ")) + ")" : ""}</li>`).join("");
        page("Select the supported initial clauses", `<ul>${clauses}</ul><form method="post" action="/fixture-subset">
          ${csrfField}${hidden("source_ref", ref.data)}${hidden("proposal_digest", preview.value.digest)}
          <label>Clause IDs, separated by commas <input name="clause_ids" required maxlength="8192"></label>
          <button>Preview selected changes</button></form>`);
        return;
      }
      if (fixture && request.method === "GET" && url.pathname === "/fixture-restore") {
        const id = restoreId.safeParse(url.searchParams.get("id"));
        if (!id.success) return reply(404, { error: "UNAVAILABLE" });
        const reviewed = fixture.recovery.review(session.owner, id.data);
        if (!reviewed.ok) return result(reviewed);
        const { current, saved, save_id, digest, current_clocks, saved_clocks, pending, scene } = reviewed.value;
        const destination = scene?.owner === "remix" ?
          `opens the extension room ${escaped(scene.room_id)}. Native ${escaped(pending)} input remains paused at the pedestal` :
          `resumes ${escaped(pending)} input`;
        page("Restore saved fixture",
          `<p>Restore ${escaped(save_id)} from world revision ${saved.expected_revision} and policy revision ${saved.expected_policy_revision}.</p>` +
          `<p>Current world revision ${current.expected_revision}, policy revision ${current.expected_policy_revision}.</p>` +
          `<p>Branch ${escaped(current.branch_id)}. Current generation ${escaped(current.generation_id)}. Saved generation ${escaped(saved.generation_id)}.</p>` +
          `<p>Current native and remix clocks are ${current_clocks.native} and ${current_clocks.overlay}. The save restores them to ${saved_clocks.native} and ${saved_clocks.overlay} and ${destination}.</p>` +
          "<p>Restore switches the whole game to a fresh generation in Play. Current Editor authority expires. Prior chat remains visible.</p>" +
          `<form method="post" action="/fixture-restore">${csrfField}${hidden("id", id.data)}${hidden("digest", digest)}<button>Approve this restore</button></form>`);
        return;
      }
      if (request.method === "GET" && url.pathname === "/candidate") {
        const id = candidateId.safeParse(url.searchParams.get("id"));
        if (!id.success) return reply(404, { error: "UNAVAILABLE" });
        const display = authority.display(session.owner, id.data);
        if (!display.ok) return result(display);
        page("Review Editor change", `<pre>${escaped(display.value.diff)}</pre><form method="post" action="/approve">${hidden("candidate", id.data)}${hidden("digest", display.value.digest)}${csrfField}<button>Approve this exact change</button></form>`);
        return;
      }
      if (request.method !== "POST") return reply(404, { error: "UNAVAILABLE" });
      if (request.headers.origin !== origin) return reply(403, { error: "CONTROL_ORIGIN" });
      if (fixture?.privateStories && (url.pathname === "/private-story" || url.pathname === "/private-import")) {
        const importing = url.pathname === "/private-import";
        const limit = importing ? portableBytes : storyUploadBytes;
        const purpose = uploadPurpose.safeParse(request.headers["x-upload-purpose"]);
        const handle = opaque("upload").safeParse(request.headers["x-story-handle"]);
        const logical = z.uuid().safeParse(request.headers["x-import-request"]);
        if (importing ? !handle.success || !logical.success : !purpose.success) return reply(400, { error: "INVALID_CONTROL" });
        if (!session.csrf || request.headers["x-csrf-token"] !== session.csrf) return reply(403, { error: "CONTROL_CSRF" });
        if (request.headers["x-upload-consent"] !== "yes") return reply(400, { error: "CONSENT_REQUIRED" });
        if (url.search || request.headers["content-type"] !== "application/octet-stream") return reply(400, { error: "INVALID_CONTROL" });
        if (Number(request.headers["content-length"]) > limit) return reply(413, { error: "REQUEST_LIMIT" });
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>) {
          size += chunk.length;
          if (size > limit) {
            response.setHeader("connection", "close");
            return reply(413, { error: "REQUEST_LIMIT" });
          }
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        if (!importing && purpose.success) return result(fixture.uploadPrivateStory(session.owner, purpose.data, bytes));
        if (handle.success && logical.success) return result(await fixture.importPrivateSession(session.owner, handle.data, logical.data, bytes));
        return reply(400, { error: "INVALID_CONTROL" });
      }
      const raw = await body(request);
      const input = z.record(z.string(), z.unknown()).safeParse(raw);
      if (!input.success) return reply(400, { error: "INVALID_CONTROL" });
      const { csrf, ...data } = input.data;
      if (!session.csrf || (csrf ?? request.headers["x-csrf-token"]) !== session.csrf) {
        return reply(403, { error: "CONTROL_CSRF" });
      }
      if (fixture?.privateStories && url.pathname === "/private-delete") {
        const parsed = sessionRef.extend({ confirmed: z.literal("yes") }).safeParse(data);
        if (!parsed.success) return reply(400, { error: "INVALID_CONTROL" });
        return result(fixture.deletePrivateSession({ ...parsed.data, owner_id: session.owner }));
      }
      if (fixture?.privateStories && url.pathname === "/private-export-review") {
        const parsed = sessionRef.extend({ save_id: saveId }).safeParse(data);
        if (!parsed.success) return reply(400, { error: "INVALID_CONTROL" });
        const authorization = fixture.authorizePrivateDownload({ ...parsed.data, owner_id: session.owner }, parsed.data.save_id);
        if (!authorization.ok) return result(authorization);
        const fields = Object.entries(parsed.data).map(([name, value]) => hidden(name, value)).join("");
        page("Download combined save", `<p>This combined package includes saved story text and user content.
          Keep it private. Recovery requires a compatible engine and the matching story. Native-only saves cannot recover this session.</p>
          <form method="post" action="/private-export">${csrfField}${fields}
          ${hidden("download", authorization.value)}<button>Download private combined save</button></form>`);
        return;
      }
      if (fixture?.privateStories && url.pathname === "/private-export") {
        const parsed = sessionRef.extend({ save_id: saveId, download: opaque("download") }).safeParse(data);
        if (!parsed.success) return reply(400, { error: "INVALID_CONTROL" });
        const file = fixture.exportPrivateSession({ ...parsed.data, owner_id: session.owner }, parsed.data.save_id, parsed.data.download);
        if (!file.ok) return result(file);
        response.writeHead(200, { "content-type": "application/octet-stream", "content-length": file.value.length,
          "content-disposition": 'attachment; filename="zmachine-combined.json"' });
        response.end(file.value);
        return;
      }
      if (fixture?.privateStories && url.pathname === "/private-story-revoke") {
        const parsed = z.strictObject({ handle: z.union([opaque("launch"), opaque("upload")]) }).safeParse(data);
        return parsed.success ? result(fixture.revokePrivateUpload(session.owner, parsed.data.handle))
          : reply(400, { error: "INVALID_CONTROL" });
      }
      if (fixture && url.pathname === "/fixture-launch") {
        if (!z.strictObject({}).safeParse(data).success) return reply(400, { error: "INVALID_CONTROL" });
        const launch = fixture.issueFixtureLaunch(session.owner);
        if (!launch.ok) return result(launch);
        const client = fixture.fixtureProfile === "native-z5" && !fixture.privateStories ? "your local MCP client" : "ChatGPT";
        page("Fixture launch authorized", `<p>Copy this launch handle into ${client}.</p><pre>${escaped(launch.value)}</pre>`);
        return;
      }
      if (fixture && (url.pathname === "/fixture-source" || url.pathname === "/fixture-mode")) {
        const values = { ...data, expected_revision: formRevision(data.expected_revision),
          expected_policy_revision: formRevision(data.expected_policy_revision) };
        if (url.pathname === "/fixture-source") {
          const parsed = capture.safeParse(values);
          if (!parsed.success) return reply(400, { error: "INVALID_CONTROL" });
          const record = fixture.recordFixtureSource(session.owner, parsed.data);
          if (!record.ok) return result(record);
          const client = fixture.fixtureProfile === "native-z5" && !fixture.privateStories ? "your local MCP client" : "ChatGPT";
          page("Directive recorded", `<p>Copy this source reference into ${client}.</p><pre>${escaped(record.value)}</pre>`);
          return;
        }
        const parsed = fixtureMode.safeParse(values);
        if (!parsed.success) return reply(400, { error: "INVALID_CONTROL" });
        const { command, request_id, ...head } = parsed.data;
        const view = fixture.readFixture({ owner_id: session.owner, session_id: head.session_id, branch_id: head.branch_id });
        if (!view.ok) return result(view);
        if (view.value.state === "draft") return reply(409, { error: "NEEDS_APPROVAL" });
        return result(authority.control(session.owner, { ...head, owner_id: session.owner }, request_id, command));
      }
      if (fixture && url.pathname === "/fixture-subset") {
        const form = subsetForm.safeParse(data);
        const parsed = subset.safeParse(form.success ? {
          ...form.data, clause_ids: form.data.clause_ids.split(",").map((id) => id.trim()),
        } : data);
        if (!parsed.success) return reply(400, { error: "INVALID_CONTROL" });
        const prepared = fixture.selectFixtureSubset(session.owner, parsed.data);
        if (!prepared.ok) return result(prepared);
        if (prepared.value.kind !== "prepared") return reply(409, { error: "INVALID_CONTROL" });
        response.writeHead(303, { location: "/candidate?id=" + encodeURIComponent(prepared.value.handle.candidate_id) });
        response.end();
        return;
      }
      if (fixture && url.pathname === "/fixture-restore") {
        const parsed = restoreForm.safeParse(data);
        if (!parsed.success) return reply(400, { error: "INVALID_CONTROL" });
        const reviewed = fixture.recovery.review(session.owner, parsed.data.id, parsed.data.digest);
        return reviewed.ok ? reply(200, { approved: true }) : result(reviewed);
      }
      if (url.pathname === "/approve") {
        const parsed = approve.safeParse(data);
        if (!parsed.success) return reply(400, { error: "INVALID_CONTROL" });
        const confirmed = authority.confirm(session.owner, parsed.data.candidate, parsed.data.digest);
        return confirmed.ok ? reply(200, { approved: true }) : result(confirmed);
      }
      if (url.pathname === "/mode") {
        const parsed = controls.safeParse(data);
        return parsed.success ? result(authority.control(session.owner, parsed.data.head, parsed.data.request_id, parsed.data.command))
          : reply(400, { error: "INVALID_CONTROL" });
      }
      if (url.pathname === "/lease") {
        const parsed = lease.safeParse(data);
        return parsed.success ? result(authority.issueLease(session.owner, parsed.data.head, parsed.data.fields,
          parsed.data.duration, parsed.data.uses)) : reply(400, { error: "INVALID_CONTROL" });
      }
      if (url.pathname === "/revoke") {
        const parsed = z.strictObject({ candidate: candidateId }).safeParse(data);
        return parsed.success ? result(authority.revokeCandidate(session.owner, parsed.data.candidate))
          : reply(400, { error: "INVALID_CONTROL" });
      }
      if (url.pathname === "/revoke-lease") {
        const parsed = z.strictObject({ lease: z.string().regex(/^lease:[0-9a-f-]{36}$/u) }).safeParse(data);
        return parsed.success ? result(authority.revokeLease(session.owner, parsed.data.lease))
          : reply(400, { error: "INVALID_CONTROL" });
      }
      return reply(404, { error: "UNAVAILABLE" });
    } catch {
      if (!response.headersSent) reply(400, { error: "INVALID_CONTROL" });
    }
  };
}
