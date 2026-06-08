
-- Scope 'form-media' read access to the uploader's organization.
-- Uploaders write paths as `${organization_id}/${form_id}/${uuid}.${ext}`.
DROP POLICY IF EXISTS "form-media authenticated read" ON storage.objects;

CREATE POLICY "form-media org read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'form-media'
  AND (storage.foldername(name))[1] = public.get_user_organization(auth.uid())::text
);

-- Also scope write policies so users cannot overwrite/delete files of other orgs.
DROP POLICY IF EXISTS "form-media authenticated upload" ON storage.objects;
DROP POLICY IF EXISTS "form-media authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "form-media authenticated delete" ON storage.objects;

CREATE POLICY "form-media org upload"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'form-media'
  AND (storage.foldername(name))[1] = public.get_user_organization(auth.uid())::text
);

CREATE POLICY "form-media org update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'form-media'
  AND (storage.foldername(name))[1] = public.get_user_organization(auth.uid())::text
);

CREATE POLICY "form-media org delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'form-media'
  AND (storage.foldername(name))[1] = public.get_user_organization(auth.uid())::text
);
