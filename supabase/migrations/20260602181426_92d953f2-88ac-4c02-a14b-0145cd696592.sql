
CREATE POLICY "form-media public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'form-media');

CREATE POLICY "form-media authenticated upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'form-media');

CREATE POLICY "form-media authenticated update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'form-media');

CREATE POLICY "form-media authenticated delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'form-media');
