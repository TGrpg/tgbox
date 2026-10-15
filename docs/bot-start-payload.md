# Optional bot start payloads

A submitter can opt in by submitting a public bot link such as
`https://t.me/ExampleBot?start=campaign_name`. No payload is added automatically.
The payload can change the bot's initial behavior; reviewers must check the visible
payload in the review queue or notification before approval. A payload does not prove
ownership or safe bot behavior. Existing entries and drafts keep a null payload.

Only one nonempty `start` parameter is accepted, with 1–64 ASCII letters, digits,
underscores or hyphens. Duplicate or malformed values and unexpected URL schemes are
refused. Arbitrary query parameters are never persisted. Channel and group submissions
have no start payload. The username identity parser keeps its existing return type.

Apply migration `0021_bot_start_payload.sql` before deploying Worker code that reads
or writes the new nullable columns. Back up the database first. Run the normal local
migration and test workflow; do not rewrite historical migrations. Rebuild the site
snapshot and Pagefind index after approval. Old snapshot exports remain readable and
receive null payloads; old static builds must be rebuilt to emit tagged links.

`telegramLinks` is the common builder for web and native entry launch links. `/go`
passes only a validated bot payload and uses the same targets for immediate actions,
all three Telegram mirrors, and its delayed redirect. The Mini App browse export and
Pagefind metadata carry the field. Public JSON exports expose the opt-in payload so
external mirrors can preserve it; this change cannot update third-party mirror code.
Entry promotions read the current approved entry before redirecting, adding one D1
read to those redirects. Banner links keep their separately validated target.

A deployment or accepted contribution still does not prove that a visitor pressed
Start or that a bot recorded the source. Verify the deployed producer, each launch
consumer, and the receiving bot separately. This local patch performs no remote
migration, publication, Telegram action, or catalog submission.
