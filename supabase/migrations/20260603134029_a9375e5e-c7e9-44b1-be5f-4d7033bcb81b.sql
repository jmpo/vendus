-- 1) Tasks: scope admin/manager access to same organization
DROP POLICY IF EXISTS "Admins and managers can manage all tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can view their own tasks" ON public.tasks;

CREATE POLICY "Admins and managers manage tasks in their org"
ON public.tasks
FOR ALL
TO authenticated
USING (
  is_super_admin(auth.uid())
  OR (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
    AND EXISTS (
      SELECT 1 FROM public.profiles p_owner
      JOIN public.profiles p_self ON p_self.id = auth.uid()
      WHERE p_owner.id = tasks.user_id
        AND p_owner.organization_id = p_self.organization_id
        AND p_owner.organization_id IS NOT NULL
    )
  )
)
WITH CHECK (
  is_super_admin(auth.uid())
  OR (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
    AND EXISTS (
      SELECT 1 FROM public.profiles p_owner
      JOIN public.profiles p_self ON p_self.id = auth.uid()
      WHERE p_owner.id = tasks.user_id
        AND p_owner.organization_id = p_self.organization_id
        AND p_owner.organization_id IS NOT NULL
    )
  )
);

CREATE POLICY "Users can view their own tasks"
ON public.tasks
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- 2) user_roles: remove legacy admin policies that allow cross-org role grants/deletes.
-- Super admin policies remain. Admins should not grant roles cross-org; if needed later we can scope by org.
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;

CREATE POLICY "Admins manage roles within their org"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.profiles p_target
    JOIN public.profiles p_self ON p_self.id = auth.uid()
    WHERE p_target.id = user_roles.user_id
      AND p_target.organization_id = p_self.organization_id
      AND p_target.organization_id IS NOT NULL
  )
  AND role <> 'super_admin'::app_role
);

CREATE POLICY "Admins delete roles within their org"
ON public.user_roles
FOR DELETE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.profiles p_target
    JOIN public.profiles p_self ON p_self.id = auth.uid()
    WHERE p_target.id = user_roles.user_id
      AND p_target.organization_id = p_self.organization_id
      AND p_target.organization_id IS NOT NULL
  )
  AND role <> 'super_admin'::app_role
);

-- 3) form-media: restrict reads to authenticated users only (remove public anon read).
-- Form theming images are now accessed by authenticated admin users in the editor;
-- public form rendering uses public asset URLs from the design panel for logos that
-- are intentionally signed/served separately. If a public form requires the asset,
-- we'll serve a signed URL via edge function.
DROP POLICY IF EXISTS "form-media public read" ON storage.objects;

CREATE POLICY "form-media authenticated read"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'form-media');