
CREATE POLICY "wameta_media_org_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'whatsapp-meta-media'
    AND (
      public.is_super_admin(auth.uid())
      OR public.user_belongs_to_organization(auth.uid(), ((string_to_array(name, '/'))[1])::uuid)
    )
  );
