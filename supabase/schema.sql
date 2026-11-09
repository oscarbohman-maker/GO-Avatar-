-- Plain Dodge! – konton, level, XP, mynt och skin-shop (Supabase / Postgres).
-- SKAPAD AV tools/gen-sql.mjs – ändra inte för hand. Kör hela filen i Supabase: SQL Editor → New query → Run.
-- Filen går att köra flera gånger; den uppdaterar banor, skins och funktioner utan att radera spelarnas data.
--
-- Säkerhet: spelarna kan bara LÄSA sin egen profil. XP, mynt och köp ändras enbart av funktionerna
-- nedan (security definer), som själva räknar ut belöningen och kontrollerar att värdena är rimliga.

-- ------------------------------------------------------------ tabeller
create table if not exists public.maps (
  id text primary key,
  tier int not null check (tier between 1 and 5),
  stars int not null check (stars >= 0),
  max_score int not null check (max_score > 0)
);

create table if not exists public.skins (
  id text primary key,
  price int not null check (price >= 0),
  min_level int not null check (min_level >= 1)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Pilot' check (char_length(display_name) between 1 and 16),
  xp int not null default 0 check (xp >= 0),
  coins int not null default 0 check (coins >= 0),
  equipped_skin text not null default 'classic',
  owned_skins text[] not null default array['classic'],
  last_award_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.clears (
  user_id uuid not null references public.profiles (id) on delete cascade,
  map_id text not null references public.maps (id) on delete cascade,
  runs int not null default 0,
  best_score int not null default 0,
  best_rank text,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (user_id, map_id)
);

-- ------------------------------------------------------------ data från spelet
insert into public.maps (id, tier, stars, max_score) values
  ('test', 1, 16, 6300),
  ('demo', 1, 20, 10375),
  ('m3', 1, 15, 6350),
  ('m4', 2, 16, 6388),
  ('m5', 2, 16, 7175),
  ('m6', 2, 17, 7213),
  ('m7', 2, 19, 8088),
  ('m8', 3, 18, 8088),
  ('m9', 3, 19, 8888),
  ('m10', 3, 18, 8875),
  ('m11', 3, 20, 9788),
  ('m12', 4, 21, 9813),
  ('m13', 4, 20, 10638),
  ('m14', 4, 20, 10575),
  ('m15', 4, 22, 11475),
  ('m16', 5, 22, 11475),
  ('m17', 5, 22, 12275),
  ('m18', 5, 23, 12313),
  ('m19', 5, 23, 13125),
  ('m20', 5, 23, 13138)
on conflict (id) do update set tier = excluded.tier, stars = excluded.stars, max_score = excluded.max_score;

insert into public.skins (id, price, min_level) values
  ('classic', 0, 1),
  ('klassisk-rod', 60, 1),
  ('himmelsbla', 80, 1),
  ('kamouflage', 100, 2),
  ('rutig-racer', 120, 2),
  ('solnedgang', 140, 3),
  ('polis', 150, 3),
  ('mintglass', 160, 3),
  ('svart-matt', 180, 4),
  ('zebra', 200, 4),
  ('retropost', 220, 4),
  ('neon-natt', 300, 5),
  ('krom', 340, 6),
  ('guldrush', 380, 7),
  ('hajtand', 420, 8),
  ('tiger', 460, 9),
  ('iskristall', 500, 10),
  ('lavasten', 560, 11),
  ('synthwave', 600, 12),
  ('kolfiber', 650, 13),
  ('regnbage', 700, 14),
  ('galax', 700, 15),
  ('drakeld', 780, 16),
  ('fenix', 860, 18),
  ('isdrake', 940, 19),
  ('askstorm', 1020, 21),
  ('nordljus', 1100, 22),
  ('spektral', 1180, 24),
  ('tomrum', 1260, 25),
  ('diamant', 1340, 27),
  ('solflamma', 1400, 28),
  ('stjarnjagare', 1500, 30),
  ('urdrake', 1650, 32),
  ('robotfalk', 1800, 34),
  ('tefat', 1950, 36),
  ('kvantkristall', 2100, 38),
  ('eldfagel', 2300, 40),
  ('stormvakt', 2500, 42),
  ('singularitet', 2700, 44),
  ('gyllene-kolossen', 2850, 46),
  ('leviatan', 3000, 48)
on conflict (id) do update set price = excluded.price, min_level = excluded.min_level;

-- skins som inte längre finns i spelet: köpta exemplar betalas tillbaka (mynt) och tas bort
do $$
declare keep text[] := array['classic', 'klassisk-rod', 'himmelsbla', 'kamouflage', 'rutig-racer', 'solnedgang', 'polis', 'mintglass', 'svart-matt', 'zebra', 'retropost', 'neon-natt', 'krom', 'guldrush', 'hajtand', 'tiger', 'iskristall', 'lavasten', 'synthwave', 'kolfiber', 'regnbage', 'galax', 'drakeld', 'fenix', 'isdrake', 'askstorm', 'nordljus', 'spektral', 'tomrum', 'diamant', 'solflamma', 'stjarnjagare', 'urdrake', 'robotfalk', 'tefat', 'kvantkristall', 'eldfagel', 'stormvakt', 'singularitet', 'gyllene-kolossen', 'leviatan'];
begin
  update public.profiles p set
    coins = p.coins + coalesce((select sum(s.price) from public.skins s where s.id = any (p.owned_skins) and not (s.id = any (keep))), 0),
    owned_skins = array(select x from unnest(p.owned_skins) with ordinality as u(x, i) where x = any (keep) order by i),
    equipped_skin = case when p.equipped_skin = any (keep) then p.equipped_skin else 'classic' end
  where not (p.owned_skins <@ keep) or not (p.equipped_skin = any (keep));
  delete from public.skins where not (id = any (keep));
end $$;

-- ------------------------------------------------------------ åtkomst
alter table public.maps enable row level security;
alter table public.skins enable row level security;
alter table public.profiles enable row level security;
alter table public.clears enable row level security;

drop policy if exists "maps are public" on public.maps;
create policy "maps are public" on public.maps for select using (true);
drop policy if exists "skins are public" on public.skins;
create policy "skins are public" on public.skins for select using (true);
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "read own clears" on public.clears;
create policy "read own clears" on public.clears for select using (auth.uid() = user_id);

-- inga direkta ändringar från appen – bara via funktionerna
revoke all on public.maps, public.skins, public.profiles, public.clears from anon, authenticated;
grant select on public.maps, public.skins to anon, authenticated;
grant select on public.profiles, public.clears to authenticated;

-- ------------------------------------------------------------ regler (samma som js/progress.js)
create or replace function public.pd_xp_for_level(p_level int) returns int
language sql immutable as $$
  select 100 * (greatest(1, least(50, p_level)) - 1)
       + 20 * (greatest(1, least(50, p_level)) - 1) * (greatest(1, least(50, p_level)) - 2);
$$;

create or replace function public.pd_level(p_xp int) returns int
language plpgsql immutable as $$
declare l int := 1;
begin
  while l < 50 and public.pd_xp_for_level(l + 1) <= p_xp loop l := l + 1; end loop;
  return l;
end $$;

create or replace function public.pd_rank(p_score int, p_max int) returns text
language sql immutable as $$
  select case
    when p_score::bigint * 100 >= greatest(p_max, 1)::bigint * 85 then 'S'
    when p_score::bigint * 100 >= greatest(p_max, 1)::bigint * 70 then 'A'
    when p_score::bigint * 100 >= greatest(p_max, 1)::bigint * 55 then 'B'
    when p_score::bigint * 100 >= greatest(p_max, 1)::bigint * 40 then 'C'
    else 'D' end;
$$;

create or replace function public.pd_rank_idx(p_rank text) returns int
language sql immutable as $$ select coalesce(array_position(array['D','C','B','A','S'], p_rank), 1) - 1; $$;

create or replace function public.pd_rank_xp(p_rank text) returns int
language sql immutable as $$
  select case p_rank when 'S' then 100 when 'A' then 50 when 'B' then 20 when 'C' then 0 else 0 end;
$$;

-- avrundning som Math.round för positiva tal: (v·p)/100, halvor uppåt
create or replace function public.pd_pct(p_value int, p_pct int) returns int
language sql immutable as $$ select round((p_value::numeric * p_pct) / 100)::int; $$;

-- ------------------------------------------------------------ profilen (skapas vid första anropet)
create or replace function public.pd_profile_json(p_uid uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', p.id, 'display_name', p.display_name, 'xp', p.xp, 'coins', p.coins, 'level', public.pd_level(p.xp),
    'equipped_skin', p.equipped_skin, 'owned_skins', p.owned_skins,
    'clears', coalesce((select json_agg(json_build_object('map_id', c.map_id, 'runs', c.runs, 'best_score', c.best_score, 'best_rank', c.best_rank))
                        from public.clears c where c.user_id = p.id), '[]'::json))
  from public.profiles p where p.id = p_uid;
$$;

-- gratis skins (pris 0) som man har nått leveln för läggs till automatiskt
create or replace function public.pd_grant_free_skins(p_uid uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare got text[];
begin
  with lvl as (select public.pd_level(xp) as l, owned_skins from public.profiles where id = p_uid),
       fresh as (select s.id from public.skins s, lvl where s.price = 0 and s.min_level <= lvl.l and not (s.id = any (lvl.owned_skins)))
  select coalesce(array_agg(id order by id), '{}') into got from fresh;
  if array_length(got, 1) > 0 then
    update public.profiles set owned_skins = owned_skins || got where id = p_uid;
  end if;
  return got;
end $$;

create or replace function public.get_profile(p_name text default null) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); nm text;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  nm := left(btrim(coalesce(nullif(btrim(p_name), ''), 'Pilot')), 16);
  insert into public.profiles (id, display_name) values (uid, nm) on conflict (id) do nothing;
  perform public.pd_grant_free_skins(uid);
  return public.pd_profile_json(uid);
end $$;

create or replace function public.set_display_name(p_name text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); nm text := left(btrim(coalesce(p_name, '')), 16);
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  if char_length(nm) < 1 then raise exception 'invalid_name'; end if;
  update public.profiles set display_name = nm where id = uid;
  return public.pd_profile_json(uid);
end $$;

-- ------------------------------------------------------------ belöning efter en klarad bana
-- Servern räknar själv ut betyg, XP och mynt. Den avvisar orimliga poäng och för täta anrop.
create or replace function public.award_flight(p_map text, p_score int, p_stars int, p_coop boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  m public.maps;
  p public.profiles;
  c public.clears;
  prev_runs int := 0; prev_best text := null;
  v_rank text; v_base int; v_perf int; v_mult int; v_run int; v_first int := 0; v_rank_xp int := 0; v_sub int; v_coop int := 0;
  v_xp int; v_coins int; lvl_before int; lvl_after int; new_skins text[];
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  select * into m from public.maps where id = p_map;
  if not found then raise exception 'unknown_map'; end if;
  if p_score is null or p_score < 0 or p_score::bigint * 10 > m.max_score::bigint * 13 then raise exception 'invalid_score'; end if;
  if p_stars is null or p_stars < 0 or p_stars > m.stars then raise exception 'invalid_stars'; end if;

  perform public.get_profile(null);
  select * into p from public.profiles where id = uid for update;
  if p.last_award_at is not null and p.last_award_at > now() - interval '20 seconds' then raise exception 'too_soon'; end if;

  select * into c from public.clears where user_id = uid and map_id = p_map;
  if found then prev_runs := c.runs; prev_best := c.best_rank; end if;

  v_rank := public.pd_rank(p_score, m.max_score);
  v_base := case m.tier when 1 then 60 when 2 then 90 when 3 then 130 when 4 then 180 else 250 end;
  v_perf := round(least(p_score, m.max_score)::numeric / 50)::int;
  v_mult := (array[100, 60, 40, 30, 25])[least(prev_runs, 4) + 1];
  v_run := public.pd_pct(v_base + v_perf + p_stars * 5, v_mult);
  if prev_runs = 0 then v_first := public.pd_pct(v_base, 150); end if;
  if public.pd_rank_idx(v_rank) > public.pd_rank_idx(coalesce(prev_best, 'D')) then
    v_rank_xp := public.pd_rank_xp(v_rank) - public.pd_rank_xp(coalesce(prev_best, 'D'));
  end if;
  v_sub := v_run + v_first + v_rank_xp;
  if p_coop then v_coop := public.pd_pct(v_sub, 10); end if;
  v_xp := v_sub + v_coop;
  v_coins := public.pd_pct(v_xp, 50);

  lvl_before := public.pd_level(p.xp);
  update public.profiles set xp = xp + v_xp, coins = coins + v_coins, last_award_at = now() where id = uid;
  insert into public.clears as cl (user_id, map_id, runs, best_score, best_rank)
    values (uid, p_map, 1, p_score, v_rank)
    on conflict (user_id, map_id) do update set
      runs = cl.runs + 1,
      best_score = greatest(cl.best_score, excluded.best_score),
      best_rank = case when public.pd_rank_idx(excluded.best_rank) > public.pd_rank_idx(coalesce(cl.best_rank, 'D')) then excluded.best_rank else cl.best_rank end,
      last_at = now();
  lvl_after := public.pd_level(p.xp + v_xp);
  new_skins := public.pd_grant_free_skins(uid);

  return json_build_object(
    'rank', v_rank, 'xp', v_xp, 'coins', v_coins, 'repeat_pct', v_mult,
    'parts', json_build_object('run', v_run, 'first', v_first, 'rank', v_rank_xp, 'coop', v_coop),
    'level_before', lvl_before, 'level_after', lvl_after, 'new_skins', new_skins,
    'profile', public.pd_profile_json(uid));
end $$;

-- ------------------------------------------------------------ shop
create or replace function public.buy_skin(p_skin text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s public.skins; p public.profiles;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  select * into s from public.skins where id = p_skin;
  if not found then raise exception 'unknown_skin'; end if;
  perform public.get_profile(null);
  select * into p from public.profiles where id = uid for update;
  if p_skin = any (p.owned_skins) then return public.pd_profile_json(uid); end if;
  if public.pd_level(p.xp) < s.min_level then raise exception 'level_too_low'; end if;
  if p.coins < s.price then raise exception 'not_enough_coins'; end if;
  update public.profiles set coins = coins - s.price, owned_skins = array_append(owned_skins, s.id) where id = uid;
  return public.pd_profile_json(uid);
end $$;

create or replace function public.equip_skin(p_skin text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  update public.profiles set equipped_skin = p_skin where id = uid and p_skin = any (owned_skins);
  if not found then raise exception 'not_owned'; end if;
  return public.pd_profile_json(uid);
end $$;

-- bara inloggade får anropa funktionerna
revoke all on function public.get_profile(text), public.set_display_name(text), public.award_flight(text, int, int, boolean),
  public.buy_skin(text), public.equip_skin(text), public.pd_profile_json(uuid), public.pd_grant_free_skins(uuid) from public, anon, authenticated;
grant execute on function public.get_profile(text), public.set_display_name(text), public.award_flight(text, int, int, boolean),
  public.buy_skin(text), public.equip_skin(text) to authenticated;
