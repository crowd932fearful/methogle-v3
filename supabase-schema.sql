-- METHOGLE V3 DATABASE
-- Run this entire file once in Supabase: SQL Editor -> New query -> Run.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 3 and 20),
  rating integer not null default 1000 check (rating >= 100),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  games integer not null default 0 check (games >= 0),
  xp integer not null default 0 check (xp >= 0),
  level integer not null default 1 check (level >= 1),
  pro boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_unique
on public.profiles (lower(username));

create index if not exists profiles_rating_desc_index
on public.profiles (rating desc);

create table if not exists public.matches (
  id text primary key,
  mode text not null,
  topic text not null default 'mixed',
  player1_id uuid references public.profiles(id) on delete set null,
  player2_id uuid references public.profiles(id) on delete set null,
  winner_id uuid references public.profiles(id) on delete set null,
  player1_name text not null,
  player2_name text,
  player1_score integer not null default 0,
  player2_score integer not null default 0,
  player1_rating_change integer not null default 0,
  player2_rating_change integer not null default 0,
  completed_at timestamptz not null default now()
);

create index if not exists matches_player1_index on public.matches (player1_id, completed_at desc);
create index if not exists matches_player2_index on public.matches (player2_id, completed_at desc);
create index if not exists matches_completed_index on public.matches (completed_at desc);

create table if not exists public.daily_scores (
  user_id uuid not null references public.profiles(id) on delete cascade,
  challenge_date date not null default current_date,
  score integer not null default 0,
  completed_at timestamptz not null default now(),
  primary key (user_id, challenge_date)
);

create or replace function public.make_unique_username(base_username text, user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text;
  candidate text;
  counter integer := 0;
begin
  cleaned := regexp_replace(coalesce(base_username, ''), '[^a-zA-Z0-9_ -]', '', 'g');
  cleaned := trim(regexp_replace(cleaned, '\s+', ' ', 'g'));
  if char_length(cleaned) < 3 then
    cleaned := 'solver_' || substr(user_id::text, 1, 6);
  end if;
  cleaned := left(cleaned, 20);
  candidate := cleaned;
  while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
    counter := counter + 1;
    candidate := left(cleaned, greatest(3, 20 - char_length(counter::text) - 1)) || '_' || counter;
  end loop;
  return candidate;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    public.make_unique_username(new.raw_user_meta_data ->> 'username', new.id)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.daily_scores enable row level security;

drop policy if exists "Public leaderboard profiles" on public.profiles;
create policy "Public leaderboard profiles"
on public.profiles for select
to anon, authenticated
using (true);

drop policy if exists "Users can update own basic profile" on public.profiles;

drop policy if exists "Players can view their matches" on public.matches;
create policy "Players can view their matches"
on public.matches for select
to authenticated
using ((select auth.uid()) = player1_id or (select auth.uid()) = player2_id);

drop policy if exists "Public daily leaderboard" on public.daily_scores;
create policy "Public daily leaderboard"
on public.daily_scores for select
to anon, authenticated
using (true);

-- Service/secret keys used by the Methogle server bypass RLS for trusted writes.
