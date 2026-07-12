-- Make the job-attachments bucket private
UPDATE storage.buckets SET public = false WHERE id = 'job-attachments';

-- Allow workshop role to access objects in this bucket via the authenticated client.
-- (Server-side admin client bypasses RLS regardless; this is so authenticated
--  workshop users can also read/write directly if needed.)
DROP POLICY IF EXISTS "Workshop reads job attachments" ON storage.objects;
DROP POLICY IF EXISTS "Workshop writes job attachments" ON storage.objects;
DROP POLICY IF EXISTS "Workshop updates job attachments" ON storage.objects;
DROP POLICY IF EXISTS "Workshop deletes job attachments" ON storage.objects;

CREATE POLICY "Workshop reads job attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'job-attachments' AND public.has_role(auth.uid(), 'workshop'));

CREATE POLICY "Workshop writes job attachments"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'job-attachments' AND public.has_role(auth.uid(), 'workshop'));

CREATE POLICY "Workshop updates job attachments"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'job-attachments' AND public.has_role(auth.uid(), 'workshop'));

CREATE POLICY "Workshop deletes job attachments"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'job-attachments' AND public.has_role(auth.uid(), 'workshop'));