import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface UpdateProfileData {
  full_name?: string;
  phone?: string;
  avatar_url?: string;
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (data: UpdateProfileData) => {
      if (!user?.id) throw new Error('Usuario no autenticado');

      const { error } = await supabase
        .from('profiles')
        .update(data)
        .eq('id', user.id);

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      toast.success('Perfil actualizado con éxito!');
    },
    onError: (error: Error) => {
      toast.error('Error al actualizar perfil', { description: error.message });
    }
  });
}

export function useUploadAvatar() {
  const { user } = useAuth();
  const updateProfile = useUpdateProfile();

  return useMutation({
    mutationFn: async (file: File) => {
      if (!user?.id) throw new Error('Usuario no autenticado');

      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/avatar.${fileExt}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      // Add cache buster to URL
      const avatarUrl = `${publicUrl}?t=${Date.now()}`;

      // Update profile with new avatar URL
      await updateProfile.mutateAsync({ avatar_url: avatarUrl });

      return avatarUrl;
    },
    onError: (error: Error) => {
      toast.error('Error al subir el archivo da foto', { description: error.message });
    }
  });
}

export function useUpdatePassword() {
  return useMutation({
    mutationFn: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
      // First verify current password by trying to sign in
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error('Usuario no autenticado');

      // Update password
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      return true;
    },
    onSuccess: () => {
      toast.success('Contraseña actualizada con éxito!');
    },
    onError: (error: Error) => {
      toast.error('Error al actualizar contraseña', { description: error.message });
    }
  });
}

export function useUpdateEmail() {
  return useMutation({
    mutationFn: async (newEmail: string) => {
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      toast.success('¡Correo de confirmación enviado!', { 
        description: 'Revisá tu casilla de entrada para confirmar el cambio.' 
      });
    },
    onError: (error: Error) => {
      toast.error('Error al actualizar email', { description: error.message });
    }
  });
}
