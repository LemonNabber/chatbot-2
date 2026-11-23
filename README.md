# Chatbot (working title)

A chatbot modeled on Cleverbot, built to critique how we relate to modern AI chatbots.

**Nothing the bot says is generated.** Every reply is a message a real person typed in an earlier conversation, reused word for word. Your messages become replies in other people's conversations in the same way, and this keeps going: the data is built out of the data.

---

## Why

Modern LLM chatbots present themselves as a single intelligent individual. That framing:

- feeds the **ELIZA effect**, where people credit a program with feelings, understanding and intelligence;
- puts users at risk of unhealthy attachment, "AI psychosis" and other personal harm;
- hides the people and data the model came from, so its biases and social problems look like the neutral judgment of one smart entity rather than something inherited from humans;
- is profitable, and simple interfaces that hide how the system works make all of this worse;
- turns users into training data (through "which response do you prefer?" reinforcement learning, the same process behind sycophancy) without making that visible.

This project works the other way. It shows the data behind every reply and puts names and faces on it, so the "individual" comes apart into the many people it was made from. Because the bot only replays real messages, it reflects its data more directly than an LLM does. That is a real difference from modern systems, and it is also what makes the parallel clear: **a chatbot is not an individual, it is a reflection of its data.**

## Two modes

| | Simple mode | Transparent mode ("Show sources") |
|---|---|---|
| Purpose | Immersion: it feels like talking to one being | Everything on the table |
| Bot identity | One name, one face | The face breaks apart into the contributors behind the current conversation |
| Each reply | Just the text | A "receipt": who wrote it, when, and their photo |
| Clicking a reply | Nothing happens | Opens the original conversation that line came from, with the line highlighted |
| Digging deeper | — | Any bot line inside that archive can be opened as well, as far back as you want to go (Back button to retrace) |
| Graph | — | A node graph of the conversations you've opened and the ones they branch from *(planned)* |

## How a reply is chosen

Cleverbot-style matching, done entirely in Postgres by `find_best_response`:

1. Look at every message **in other conversations** (`m1`), whether a person or the bot said it.
2. For each one, find the next **user** message in that conversation (`m2`), i.e. what a real person said in response to `m1`.
3. Rank by:
   1. real data before seed data, once there are 25 or more real user messages;
   2. avoiding the 3 most recently used replies (across all conversations);
   3. trigram text similarity between `m1` and what you just typed (`pg_trgm`);
   4. on a tie, preferring an `m1` the bot said, because a person was answering the bot, just as you are;
   5. random.
4. Return `m2` as the reply. The bot's line is saved with `source_message_id` pointing at the original, which is what makes the receipts and the archive work.

## Avatars

Each person takes a photo with their webcam before chatting, and a photo is required to continue. Photos are stored in a **private** bucket. A photo can be read only once the bot has used that person's words. The page downloads it once and keeps it in memory for that tab (a `blob:` URL), so it lasts for the whole conversation and disappears when the tab is closed or reloaded. No shareable link is ever created. It then appears next to the reply and at the top of that person's conversation in the archive. Photos of people whose words were never used stay hidden. The project owner can see all of them in the Supabase dashboard. The consent screen says this plainly.

## Voices

After the photo, each person records themselves saying "hello" (required). The browser finds the loudest part of the recording, measures its pitch, and throws the recording away. **Only the pitch (a number in Hz) is saved**, in `conversations.voice_pitch`.

Messages type out one letter at a time with an Animal Crossing–style babble. Each letter is a tiny synthesized syllable at the speaker's pitch, with its own vowel color (based on how the letter's name sounds), onset (pop, hiss, hum) and pitch step. Punctuation pauses, and questions rise at the end.

| Who's talking | Voice |
|---|---|
| You, in your own conversation | Your pitch |
| The bot, simple mode | One default voice (`DEFAULT_VOICE_PITCH`) |
| The bot, transparent mode | The pitch of the person whose words are being reused (seed users get the default) |

You can tune the sound with the constants at the top of the script: `DEFAULT_VOICE_PITCH`, `VOICE_PITCH_MULTIPLIER` (raise it for a squeakier voice) and `RECORD_SECONDS`.

## Pixel look

[pixel-filter.js](pixel-filter.js) gives the whole page a pixel-art look using SVG filters. No assets are redrawn. Each element marked `.px` (interface) or `.px-img` (photos, video) is filtered on its own:

- **Pixel grid:** each block takes one colour, with no blur.
- **Interface pieces:** every colour snaps to colours that element actually uses, so designed colours stay exact, nested boxes never merge, and outlines are pure black. Each run of text is its own layer, so its edges snap to the text colour.
- **Photos:** solid colour bands, with a dithered strip where one band meets the next.

Settings are at the top of `pixel-filter.js`: `block` (1px), `levels` (8 bands), `width` (25% dithered strip) and `ink` (40% text weight). [pixel-test.html](pixel-test.html) has sliders for trying settings out.

**Not used in Safari or WebKit** (every iPhone browser uses WebKit). Safari draws these filters wrongly: blank or striped boxes, and sometimes a blank page. Safari visitors get the normal page, and the "Pixel" checkbox is hidden for them. Add `?force-pixel` to the URL to try it in Safari anyway.

Notes for editing the page:
- A colour shown only on hover goes in `data-px-extra="#ddd"`, or it snaps to the nearest colour the element already uses.
- The filter clips anything drawn outside an element, so use borders instead of outlines or shadows.

---

## Stack

- **Frontend:** a static HTML page plus `pixel-filter.js` (vanilla JS, no build step), with `supabase-js` loaded from a CDN
- **Backend:** Supabase (Postgres, plus Storage for the photos)

## Setup

### 1. Supabase project

In a new Supabase project's **SQL Editor**, run the following in this order:

1. **Base schema** (v1): enables `pg_trgm`, creates the `conversations` and `messages` tables, the RLS insert policies, the grants for `anon`, `find_best_response`, `get_conversation_transcript`, and the 20 seed conversations.
2. **Photo column:** `alter table conversations add column photo_path text;`
3. **Updated functions:** drop and recreate `find_best_response` and `get_conversation_transcript` so they return `source_photo_path`.
4. **Latest `find_best_response`:** the version with the bot-said tie-breaker.
5. **Voice:** [supabase/voice.sql](supabase/voice.sql) adds `voice_pitch` and makes `find_best_response` return `source_voice_pitch`.
6. **Mood:** [supabase/mood.sql](supabase/mood.sql) adds `mood` (the kaomoji picked in setup) and makes `find_best_response` and `get_conversation_transcript` return `source_mood`. Run it after `voice.sql`.
7. **UI:** [supabase/ui.sql](supabase/ui.sql) adds the conversation `number` shown on user cards, plus `get_conversation_card` (name, mood, duration, message count) and `get_message_context` (the line before a reused reply). Run it after `mood.sql`.

The interface follows the requirements doc (fonts, sizes, modes, user card). OT Bulb Monoline is not free: put its file at `fonts/OTBulbMonoline-Regular.woff2`. Until then, the page falls back to a system monospace font.

### 2. Storage

1. Create a bucket named **`conversation-photos`** and leave **Public** turned **off**.
2. Add the upload policy:
   ```sql
   create policy "Anyone can upload conversation photos"
   on storage.objects for insert
   to anon
   with check (bucket_id = 'conversation-photos');
   ```
3. Add the read policy, which allows a photo only after its words have been used:
   ```sql
   create or replace function public.photo_is_used(p_path text)
   returns boolean language sql security definer set search_path = public as $$
     select exists (
       select 1 from conversations c
       join messages src on src.conversation_id = c.id
       join messages b   on b.source_message_id = src.id
       where c.photo_path = p_path
     );
   $$;
   grant execute on function public.photo_is_used(text) to anon;

   create policy "Read photos of contributors whose words were used"
   on storage.objects for select to anon
   using (bucket_id = 'conversation-photos' and public.photo_is_used(name));
   ```
   No other read policy should exist. Check with:
   ```sql
   select policyname, cmd, roles from pg_policies
   where schemaname = 'storage' and tablename = 'objects';
   ```
   The page saves each bot line *before* showing it, so that a first-time contributor's photo passes this check.

### 3. Frontend

1. In the HTML file, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` from **Project Settings → API**. The anon key is meant to be public; the security comes from RLS.
2. Serve the file over **HTTPS or `localhost`**. Browsers block webcam access on plain `http://` and `file://`. For local testing:
   ```sh
   python3 -m http.server 8000
   # then open http://localhost:8000
   ```

## Data model

**`conversations`**: one row per chat session
- `id` (uuid), `display_name`, `photo_path` (file in the `conversation-photos` bucket), `voice_pitch` (Hz, 60–600, null for seeds), `mood` (kaomoji, up to 40 characters, null for seeds), `started_at`, `last_active_at`, `extra_info` (jsonb, unused), `is_seed`

**`messages`**: every line, from either side
- `conversation_id`, `sender` (`'user'` or `'bot'`), `content`, `created_at`
- `source_message_id`: for bot lines, the original user message being replayed

**Functions** (both `security definer`, callable by `anon`)
- `find_best_response(input_text, current_conversation_id)`: picks the reply, with source info
- `get_conversation_transcript(target_conversation_id)`: a full conversation, where each bot line carries its own source info so the archive can keep drilling down

## Access and privacy

- `anon` can only **insert** into the tables. There are no `select` policies, so all reads go through the two functions above.
- Anyone with a conversation's id can read its transcript. Ids are only exposed through source links, but every conversation that has been used as a source can be reached that way.
- The photo bucket is private. A photo becomes readable only after its owner's words have been used as a bot reply. The page holds it in memory only until the tab closes. There are no accounts, so this can't be limited to particular viewers. Anyone using the site can see used photos (via the archive, or by listing the bucket through the API), and nothing stops screenshots.
- **Known gap:** `anon` can insert any message, including a fake bot line. Through the API, someone could insert a bot message pointing at any message id (ids are sequential) and unlock that person's photo. Fix: allow `anon` to insert only `sender = 'user'` rows, and save bot lines inside `find_best_response` (which is `security definer`).
- Conversations are anonymous and can't be resumed. There are no accounts.

### Resetting real data

```sql
delete from conversations where is_seed = false;  -- messages cascade
```

This does **not** delete the photos. Empty the `conversation-photos` bucket separately in the Storage dashboard.

## Status

**Built**
- Name, then photo, then chat flow
- Reply matching with seed phase-out and repeat avoidance
- Simple and transparent toggle
- Source receipts with avatar thumbnails
- Clickable archive with recursive drill-down and Back
- Private photo storage, revealed only once the person's words are used
- Voice step and Animal Crossing–style letter sounds (default voice in simple mode, contributor voices in transparent mode)

**Planned**
- Bot face in simple mode, splitting into contributor photos in transparent mode
- Conversation graph view
- Viewing your own conversation's info and receipts the same way you see other people's
