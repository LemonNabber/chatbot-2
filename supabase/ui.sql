-- ============================================================
-- NEW UI: user cards and source blocks
-- Run once in the SQL Editor, after voice.sql and mood.sql.
-- ============================================================

-- 1. A short public number for each conversation, shown on user cards (#1000, #1001, ...).
--    Existing conversations (including the seeds) are numbered automatically.
--    "if not exists" makes this file safe to run again.
alter table conversations
  add column if not exists number bigint generated always as identity (start with 1000);

-- 2. Everything a user card shows, for one conversation.
--    Message count = messages on both sides. Duration = started_at to the last message.
create or replace function get_conversation_card(target_conversation_id uuid)
returns table(
  number bigint,
  display_name text,
  mood text,
  is_seed boolean,
  started_at timestamptz,
  last_message_at timestamptz,
  message_count integer,
  photo_path text,
  voice_pitch real
)
language sql
security definer
as $$
  select
    c.number,
    c.display_name,
    c.mood,
    c.is_seed,
    c.started_at,
    (select max(m.created_at) from messages m where m.conversation_id = c.id),
    (select count(*)::integer from messages m where m.conversation_id = c.id),
    c.photo_path,
    c.voice_pitch
  from conversations c
  where c.id = target_conversation_id;
$$;

grant execute on function public.get_conversation_card(uuid) to anon;

-- 3. The line just before a message in its own conversation: what that person was
--    replying to. Shown (muted) above a reused reply in the visible view.
create or replace function get_message_context(target_message_id bigint)
returns table(sender text, content text)
language sql
security definer
as $$
  select p.sender, p.content
  from messages t
  join messages p on p.conversation_id = t.conversation_id and p.id < t.id
  where t.id = target_message_id
  order by p.id desc
  limit 1;
$$;

grant execute on function public.get_message_context(bigint) to anon;
