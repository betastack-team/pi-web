# OWC fork notes

This fork of pi-web serves the OWC harness in `../pi-owc`. Upstream pi-web
renders session messages verbatim. OWC sessions hold tokens such as
`⟦SSN:7K3M9Q2A⟧` in place of real values, so the browser needs a display
copy with the real values restored. The tokenized form stays authoritative
everywhere else.

## What the fork changes

- `lib/owc-display.ts` is the only module that talks to pi-owc. It loads
  `lib/detokenizer.js`, `lib/vault.js`, and `lib/project.js` from pi-owc at
  runtime by file URL. It never imports them statically, so the client
  bundle and the Next build graph never see the vault.
- History exits present a copy. `GET /api/sessions/[id]` and
  `GET /api/sessions/[id]/context` pass the built context through the
  display for the session cwd. The expanded-thinking route does the same
  for one thinking body.
- The live exit presents a copy. The events route builds one display
  transformer per SSE connection and `lib/agent-event-stream.ts` applies
  it after `toClientAgentEvent`. Text and thinking deltas pass through a
  per-block buffer that holds a trailing partial token (at most 16 code
  units) until it closes. Tool-call JSON is never transformed while it
  streams. It is presented whole at `message_end`.
- Presented fields come in pairs. `text`, `thinking`, and tool `input`
  carry the values for the reader. `rawText`, `rawThinking`, `rawContent`,
  and `modelInput` carry the tokenized original, only when the two differ.
- `components/MessageView.tsx` renders one collapsed disclosure per
  message, "Model view — exactly as sent (tokenized)", fed by
  `lib/owc-model-view.ts`. The Model view toggle in the chat header opens
  all of them. The tokenized system prompt, including the `owc_project`
  section, stays visible in the existing System panel.
- Paste uploads images into the session working directory. Other files
  get there through the attach button or a drop. `splitDroppedItems`
  sends every dropped file, images included, to that upload. Nothing
  attaches an image inline to the prompt. The model reaches an uploaded
  file only through a file tool. In the OWC harness that means
  `owc_read`, which tokenizes.
- `owc_write_doc` counts as a file-writing tool for the written-files
  chips under a reply (`lib/tool-names.ts`, `lib/turn-written-files.ts`).
  It is deliberately not a `write` tool. The chip path comes from
  `input.path`, and `detokenizeInput` never rewrites path keys, so the
  path the chip opens is the one the tool actually wrote to.

## Invariants

- The session JSONL is never rewritten by the display layer. Presentation
  copies objects before changing any string, and returns the original
  reference when nothing changed.
- The model context is untouched. pi builds it from the session file and
  from SDK objects in memory. The fork transforms only values on their
  way to `JSON.stringify` for the browser.
- `/export` is untouched and stays tokenized. So do session search
  snippets and the session list preview, which read the JSONL directly.
  Those two surfaces can still show tokens. That is a known gap, not a
  leak of real values.
- Notifications are untouched. Web push and browser notifications carry
  a fixed "Task finished." body and the session name, never message text.
  Existing tests in `lib/web-push.test.mjs` and
  `lib/browser-notifications.test.mjs` pin that payload.

### Known limitations

pi stores a user-run `!` bash command verbatim and runs that text. pi
stores a session name set with `/name` the same way. Neither goes
through the extension input transform. That bypass is upstream pi
behavior for any typed text. Do not put real values in a `!` command
or a `/name` name.

A message copied after detokenizing is safe to resend as a normal
prompt. The input hook tokenizes it again. Do not resend that copy as
a `!` command.

## Vault safety

`openVault` in pi-owc creates `.owc/vault-id`, the vault key, and the
journal when they are missing. A web server must not do that for a folder
it merely browses. `displayForCwd` therefore resolves a display only when
all of these already exist:

- `.owc/knowledge.json` above the session cwd (found by pi-owc
  `findRoot`),
- `.owc/vault-id` with a 32 hex character id,
- `key` and `entries.jsonl` inside `~/.owc-vault/<id>` (or
  `$OWC_VAULT_HOME/<id>`).

Any miss, a loose file mode, or an import failure yields the identity
display and one warning per root. The browser then shows tokens, and
nothing is created on disk. The display type exposes `resolve` only.
Nothing in this fork can mint a token.

## Configuration

- `OWC_PI_OWC_DIR` points at the pi-owc checkout when it is neither
  `pi-web/pi-owc` nor a sibling `../pi-owc` of the pi-web directory.
- `OWC_VAULT_HOME` overrides the vault home, as in pi-owc.

## Trust boundary

Detokenized text now reaches the browser. That is safe only under the
deployment pi-web already defaults to. Keep the loopback bind. For any
non-loopback use, set `PI_WEB_PASSWORD` and put the server behind HTTPS
or a VPN before opening an OWC session. The detokenized page in a browser
holds the same real values as a document the harness generated on disk.
Treat screenshots and browser profiles accordingly.

## Specimen check

Before trusting a build, confirm each line with specimen values only:

1. A session whose assistant text holds specimen tokens shows the real
   specimen values in the browser. The Model view disclosure and the
   session file on disk show only tokens.
2. An uploaded PDF is read through `owc_read`. Its values reach the model
   tokenized.
3. A pasted image uploads into the working directory and comes back as
   an `@` mention. A file you attach or drop does the same. No image
   content goes to the model.
4. A generated document gets a written-file chip, and the downloaded file
   holds real specimen values while `check-pii.js` still passes in
   pi-owc.

## Rebase guidance

The fork surface is `lib/owc-display.ts`, `lib/owc-model-view.ts`, two
field additions in `lib/types.ts` and `lib/normalize.ts`, the
`owc_write_doc` predicate, the upload split, the paste route, the
MessageView disclosure, the chat toggle, and one call in each of the
three session routes, the events route, and `lib/agent-event-stream.ts`.
Keep new OWC behavior inside the two `owc-*` modules. A conflict in a
call-site file should resolve to upstream code plus the one display call.
