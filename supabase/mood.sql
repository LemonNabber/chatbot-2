-- ============================================================
-- MOOD (kaomoji) FEATURE
-- Run once in the SQL Editor, after voice.sql.
--
-- Each person picks a kaomoji in setup ("HOW DO YOU FEEL?").
-- It is stored on their conversation and shown in their user card,
-- including when their words are reused in other people's chats.
-- ============================================================

-- 1. Store the chosen kaomoji. Seeds stay null (no mood shown).
--    The length limit keeps out anything that isn't a kaomoji-sized string.
alter table conversations
  add column mood text
  check (mood is null or char_length(mood) between 1 and 40);

-- 2. Return the source's mood with each reply.
--    The return type changes, so the function has to be dropped first.
--    Same as voice.sql's version, plus one extra column at the end.
drop function find_best_response(text, uuid);

create function find_best_response(
  input_text text,
  current_conversation_id uuid
)
returns table(
  response_id bigint,
  response_text text,
  is_seed boolean,
  source_display_name text,
  source_started_at timestamptz,
  source_conversation_id uuid,
  source_photo_path text,
  source_voice_pitch real,
  source_mood text
)
language plpgsql
security definer
as $$
declare
  real_user_msg_count integer;
  prioritize_real boolean;
  recent_response_ids bigint[];
begin
  select count(*) into real_user_msg_count
  from messages m
  join conversations c on c.id = m.conversation_id
  where m.sender = 'user' and c.is_seed = false;

  prioritize_real := real_user_msg_count >= 25;

  select array_agg(source_message_id) into recent_response_ids
  from (
    select source_message_id
    from messages
    where sender = 'bot' and source_message_id is not null
    order by id desc
    limit 3
  ) recent;

  return query
  select m2.id, m2.content, c.is_seed, c.display_name, c.started_at, c.id, c.photo_path, c.voice_pitch, c.mood
  from messages m1
  join messages m2
    on m2.conversation_id = m1.conversation_id
    and m2.sender = 'user'
    and m2.id = (
      select min(id) from messages m3
      where m3.conversation_id = m1.conversation_id
      and m3.id > m1.id
      and m3.sender = 'user'
    )
  join conversations c on c.id = m2.conversation_id
  where m1.conversation_id != current_conversation_id
  order by
    case when prioritize_real then c.is_seed else false end asc,
    case when m2.id = any(recent_response_ids) then 1 else 0 end asc,
    similarity(m1.content, input_text) desc,
    case when m1.sender = 'bot' then 0 else 1 end asc,
    random()
  limit 1;
end;
$$;

grant execute on function public.find_best_response(text, uuid) to anon;

-- 3. Return the source's mood for each bot line in a transcript (the archive view).
--    Same as the current version, plus one extra column at the end.
drop function get_conversation_transcript(uuid);

create function get_conversation_transcript(target_conversation_id uuid)
returns table(
  id bigint,
  sender text,
  content text,
  created_at timestamptz,
  source_message_id bigint,
  source_conversation_id uuid,
  source_display_name text,
  source_is_seed boolean,
  source_started_at timestamptz,
  source_photo_path text,
  source_mood text
)
language sql
security definer
as $$
  select
    m.id,
    m.sender,
    m.content,
    m.created_at,
    m.source_message_id,
    src_c.id,
    src_c.display_name,
    src_c.is_seed,
    src_c.started_at,
    src_c.photo_path,
    src_c.mood
  from messages m
  left join messages src_m on src_m.id = m.source_message_id
  left join conversations src_c on src_c.id = src_m.conversation_id
  where m.conversation_id = target_conversation_id
  order by m.id;
$$;

grant execute on function public.get_conversation_transcript(uuid) to anon;
