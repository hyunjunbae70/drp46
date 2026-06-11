alter table public.profiles
  add column if not exists weight_kg numeric(5, 2),
  add column if not exists height_cm numeric(5, 2),
  add column if not exists age integer,
  add column if not exists activity_level text default 'moderate',
  add column if not exists goal text default 'maintenance';

do $$
begin
  alter table public.profiles
    add constraint profiles_goal_check
    check (goal in ('lose_weight', 'gain_muscle', 'maintenance'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.profiles
    add constraint profiles_activity_level_check
    check (activity_level in ('sedentary', 'light', 'moderate', 'active'));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.meal_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  spoonacular_id integer,
  title text not null,
  image_url text,
  source_url text,
  ready_in_minutes integer,
  calories numeric(8, 2) not null default 0,
  protein_g numeric(8, 2) not null default 0,
  carbs_g numeric(8, 2) not null default 0,
  fat_g numeric(8, 2) not null default 0,
  eaten_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.meal_logs enable row level security;

create index if not exists meal_logs_user_eaten_at_idx
  on public.meal_logs (user_id, eaten_at desc);

do $$
begin
  create policy "Users can view own meal logs"
    on public.meal_logs
    for select
    using (auth.uid() = user_id);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create policy "Users can insert own meal logs"
    on public.meal_logs
    for insert
    with check (auth.uid() = user_id);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create policy "Users can delete own meal logs"
    on public.meal_logs
    for delete
    using (auth.uid() = user_id);
exception
  when duplicate_object then null;
end $$;
