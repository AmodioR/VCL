-- VCL 2.1 stabilization
-- Remove the authenticated-only team logo read policy because the broader
-- public read policy already grants the same SELECT access to anon + authenticated.

begin;

drop policy if exists "VCL canonical team logo authenticated read"
on storage.objects;

commit;
