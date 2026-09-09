-- Explicit long-history restore/read may exceed Supabase's default authenticated 8 s.
-- Limit the exception to these RPCs; other roles/queries retain their existing bounds.
begin;
alter function public.commit_owner_save(uuid,uuid,bigint,jsonb,jsonb,boolean) set statement_timeout = '30s';
alter function public.load_owner_save() set statement_timeout = '30s';
notify pgrst, 'reload schema';
commit;
