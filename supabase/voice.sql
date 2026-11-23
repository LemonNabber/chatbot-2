-- ============================================================
-- VOICE FEATURE
-- Run once in the SQL Editor, after everything that is already set up.
--
-- Each person records "hello" in the browser. The page measures the pitch
-- of the loudest part and saves only that number (in Hz). The recording
-- itself is never uploaded.
-- ============================================================

-- 1. Store each conversation's voice pitch. Seeds stay null (default voice).
alter table conversations
  add column voice_pitch real
  check (voice_pitch is null or voice_pitch between 60 and 600);

-- 2. Return the source's voice pitch with each reply.
--    The return type changes, so the function has to be dropped first.
--    This is the same as the current version (with the bot-said tie-breaker),
--    plus one extra column at the end.
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
  source_voice_pitch real
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
  select m2.id, m2.content, c.is_seed, c.display_name, c.started_at, c.id, c.photo_path, c.voice_pitch
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
