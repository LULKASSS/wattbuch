-- Neue Tabelle für Strecken und die Saison des Neubaus (Sammlung, id, Daten).
-- Noch NICHT ausgeführt: erst nach Lukas' Go. Ändert keine bestehende Tabelle und löscht nichts.
-- Aufbau wie wattbuch_fahrten: jede Zeile gehört einem Nutzer, Zeilenschutz, „entfernt“ ist nur eine Markierung.
create table public.wattbuch_dokumente (
  user_id   uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  sammlung  text        not null,                 -- 'strecken' oder 'saison'
  id        text        not null,
  data      jsonb,
  geloescht boolean     not null default false,
  geaendert timestamptz not null default now(),
  primary key (user_id, sammlung, id)
);
create index wattbuch_dokumente_geaendert on public.wattbuch_dokumente (user_id, geaendert);

alter table public.wattbuch_dokumente enable row level security;
create policy "eigene Dokumente" on public.wattbuch_dokumente
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Zugriff nur angemeldet, kein Löschen von Zeilen
revoke all on public.wattbuch_dokumente from anon, authenticated;
grant select, insert, update on public.wattbuch_dokumente to authenticated;

-- Änderungszeit setzt die Datenbank (dieselbe Funktion wie bei wattbuch_fahrten, sie wird nicht verändert)
create trigger wattbuch_dokumente_geaendert
  before insert or update on public.wattbuch_dokumente
  for each row execute function public.wattbuch_geaendert();
