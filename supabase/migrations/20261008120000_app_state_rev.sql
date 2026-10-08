-- ============================================================
-- app_state.rev — a save can't overwrite a newer one.
--
-- Every write to the row (whoever makes it, old tabs included) bumps `rev`
-- by one. The app saves through app_state_save(p_rev, p_data), which only
-- writes if the row is still at p_rev — the revision the app's copy is
-- built on. If another device saved first, nothing is written and the
-- function hands back the newer copy; the app puts its own unsaved actions
-- on top of it and saves again (see the sync section of store.jsx).
--
-- Once the new app has saved (its copies carry a "_sync" key), a plain
-- write — a tab still running the old code, which never checks rev — is
-- refused, so it can't overwrite saves it never saw. Reloading the tab
-- gets the new code. (A hand edit in SQL must first run
--   select set_config('focus.app_state_save', 'on', true);
-- in the same transaction.)
--
-- Safe to apply before the new app code ships: until the new app's first
-- save, plain upserts work as today; the trigger just counts them.
-- ============================================================

alter table public.app_state add column if not exists rev bigint not null default 0;

create or replace function public.app_state_bump_rev()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.rev := 1;
  else
    if old.data ? '_sync'
       and coalesce(current_setting('focus.app_state_save', true), '') <> 'on' then
      raise exception 'Focus: this tab runs old code; reload it to save';
    end if;
    new.rev := old.rev + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists app_state_bump_rev on public.app_state;
create trigger app_state_bump_rev
  before insert or update on public.app_state
  for each row execute function public.app_state_bump_rev();

-- Returns { ok: true, rev } when the save landed, or
-- { ok: false, rev, data } with the row as it is now when it did not.
-- Runs as the caller, so the "own row" RLS policy still applies.
create or replace function public.app_state_save(p_rev bigint, p_data jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  me uuid := auth.uid();
  new_rev bigint;
  cur_rev bigint;
  cur_data jsonb;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_data is null then
    raise exception 'no data' using errcode = '22004';
  end if;
  -- lets this transaction's write past app_state_bump_rev's old-code check
  perform set_config('focus.app_state_save', 'on', true);

  -- A save racing this one waits on the row lock, then re-checks rev
  -- against the row it left behind, so only one of two saves at the same
  -- rev can land.
  update app_state set data = p_data
   where user_id = me and rev = p_rev
  returning rev into new_rev;
  if found then
    return jsonb_build_object('ok', true, 'rev', new_rev);
  end if;

  -- First save ever for this user.
  if p_rev = 0 then
    insert into app_state (user_id, data) values (me, p_data)
    on conflict (user_id) do nothing
    returning rev into new_rev;
    if found then
      return jsonb_build_object('ok', true, 'rev', new_rev);
    end if;
  end if;

  select rev, data into cur_rev, cur_data from app_state where user_id = me;
  return jsonb_build_object('ok', false, 'rev', cur_rev, 'data', cur_data);
end;
$$;

revoke execute on function public.app_state_save(bigint, jsonb) from public, anon;
grant execute on function public.app_state_save(bigint, jsonb) to authenticated;
