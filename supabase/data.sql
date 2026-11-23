-- ============================================================
-- DATA WINDOW: snapshots of reused lines
-- Run once in the SQL Editor, after ui.sql. Safe to run again.
--
-- For a reused line (the "predicted response"), returns it plus the line just before
-- it in its own conversation (what that person was answering), each with its id and
-- its position in that conversation ([1], [2], ...). Oldest first.
-- ============================================================

create or replace function get_message_snapshot(target_message_id bigint)
returns table(id bigint, sender text, content text, "position" bigint)
language sql
security definer
as $$
  with t as (
    select conversation_id, id from messages where id = target_message_id
  ),
  numbered as (
    select m.id, m.sender, m.content, row_number() over (order by m.id) as pos
    from messages m
    join t on m.conversation_id = t.conversation_id
  )
  select n.id, n.sender, n.content, n.pos
  from numbered n, t
  where n.id <= t.id
  order by n.id desc
  limit 2;
$$;

grant execute on function public.get_message_snapshot(bigint) to anon;

-- How many conversations started between two moments (both ends excluded).
-- The DATA window shows it between two conversations: "[ ... 12 CONVERSATIONS ... ]".
create or replace function count_conversations_between(a timestamptz, b timestamptz)
returns integer
language sql
security definer
as $$
  select count(*)::integer
  from conversations
  where started_at > least(a, b) and started_at < greatest(a, b);
$$;

grant execute on function public.count_conversations_between(timestamptz, timestamptz) to anon;
