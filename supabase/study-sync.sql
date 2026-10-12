-- Run once in the Supabase SQL Editor. No service-role key is used by the app.
create table if not exists public.study_libraries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0,
  document jsonb not null default '{"version":1,"cards":[]}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.study_libraries enable row level security;
drop policy if exists "Read own library" on public.study_libraries;
create policy "Read own library" on public.study_libraries
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.study_libraries from public, anon, authenticated;
grant select on public.study_libraries to authenticated;

-- Updates are only allowed through this authenticated, atomic RPC.
create or replace function public.sync_study_library(expected_revision bigint, next_document jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  current_row public.study_libraries%rowtype;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if next_document is null
    or next_document->>'version' is distinct from '1'
    or jsonb_typeof(next_document->'cards') is distinct from 'array'
  then raise exception 'Invalid study document'; end if;
  if jsonb_array_length(next_document->'cards') > 10000
    or octet_length(next_document::text) > 5242880
  then raise exception 'Study document exceeds limit'; end if;
  insert into public.study_libraries(user_id) values(owner_id) on conflict do nothing;
  select * into current_row from public.study_libraries where user_id = owner_id for update;
  if current_row.revision <> expected_revision then
    return jsonb_build_object('applied', false, 'revision', current_row.revision, 'document', current_row.document);
  end if;
  update public.study_libraries
    set revision = revision + 1, document = next_document, updated_at = now()
    where user_id = owner_id returning * into current_row;
  return jsonb_build_object('applied', true, 'revision', current_row.revision, 'document', current_row.document);
end;
$$;
revoke all on function public.sync_study_library(bigint, jsonb) from public, anon;
grant execute on function public.sync_study_library(bigint, jsonb) to authenticated;
