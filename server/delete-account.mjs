export const DELETE_CONFIRMATION = 'ELIMINAR MI CUENTA';

export async function deleteFinanceAccount({ userClient, verificationClient, adminClient, token, password, confirmation }) {
  if (confirmation !== DELETE_CONFIRMATION || typeof password !== 'string' || !password || password.length > 1024)
    return { status: 400, message: 'Confirmá la eliminación y escribí tu contraseña.' };

  const identified = await userClient.auth.getUser(token);
  const user = identified.data?.user;
  if (identified.error || !user?.id || !user.email)
    return { status: 401, message: 'Tu sesión ya no es válida. Iniciá sesión nuevamente.' };

  const verified = await verificationClient.auth.signInWithPassword({ email: user.email, password });
  if (verified.error || verified.data?.user?.id !== user.id)
    return { status: 401, message: 'La contraseña no coincide. No se eliminó nada.' };

  const membership = await adminClient.from('finance_space_members')
    .select('space_id,role').eq('user_id', user.id).maybeSingle();
  if (membership.error) throw membership.error;
  if (membership.data?.role === 'owner') {
    const members = await adminClient.from('finance_space_members')
      .select('user_id').eq('space_id', membership.data.space_id);
    if (members.error) throw members.error;
    if ((members.data || []).length > 1)
      return { status: 409, message: 'Transferí la administración a otro integrante antes de eliminar tu cuenta.' };
  }

  // El trigger de auth.users decide el alcance y revierte toda la transacción si falla.
  const deleted = await adminClient.auth.admin.deleteUser(user.id, false);
  if (deleted.error) throw deleted.error;
  return { status: 200, message: 'Tu cuenta fue eliminada.' };
}
