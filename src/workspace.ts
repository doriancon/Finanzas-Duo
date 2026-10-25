import type { SupabaseClient } from '@supabase/supabase-js';
import { CURRENCIES, type Currency } from './domain.ts';

export type WorkspacePreferences = {
  name: string;
  displayName: string;
  showGiros: boolean;
  showBusiness: boolean;
  enabledCurrencies: Currency[];
};

export const defaultWorkspacePreferences = (): WorkspacePreferences => ({
  name: '', displayName: '', showGiros: true, showBusiness: true,
  enabledCurrencies: [...CURRENCIES],
});

export async function readWorkspacePreferences(client: SupabaseClient, spaceId: string, userId: string): Promise<WorkspacePreferences> {
  const [space, settings, profile] = await Promise.all([
    client.from('finance_spaces').select('name').eq('id', spaceId).single(),
    client.from('finance_space_settings').select('show_giros,show_business,enabled_currencies').eq('space_id', spaceId).maybeSingle(),
    client.from('finance_user_profiles').select('display_name').eq('user_id', userId).maybeSingle(),
  ]);
  if (space.error) throw space.error;
  if (settings.error) throw settings.error;
  if (profile.error) throw profile.error;
  const enabled = settings.data?.enabled_currencies as Currency[] | undefined;
  return {
    name: space.data.name,
    displayName: profile.data?.display_name || '',
    showGiros: settings.data?.show_giros ?? true,
    showBusiness: settings.data?.show_business ?? true,
    enabledCurrencies: enabled?.filter(currency => CURRENCIES.includes(currency)) || [...CURRENCIES],
  };
}

export async function saveWorkspacePreferences(client: SupabaseClient, spaceId: string, userId: string,
  current: WorkspacePreferences, next: WorkspacePreferences, owner: boolean): Promise<void> {
  const displayName = next.displayName.trim();
  if (!displayName || displayName.length > 80) throw new Error('Escribí un nombre de hasta 80 caracteres.');
  if (displayName !== current.displayName) {
    const result = await client.from('finance_user_profiles').upsert(
      { user_id: userId, display_name: displayName }, { onConflict: 'user_id' });
    if (result.error) throw result.error;
  }
  if (!owner) return;
  const name = next.name.trim();
  if (!name || name.length > 80) throw new Error('Escribí un nombre de espacio de hasta 80 caracteres.');
  if (next.enabledCurrencies.length === 0) throw new Error('Elegí al menos una moneda.');
  const result = await client.rpc('configure_finance_space', {
    p_space_id: spaceId, p_name: name,
    p_show_giros: next.showGiros, p_show_business: next.showBusiness,
    p_enabled_currencies: next.enabledCurrencies,
  });
  if (result.error) throw result.error;
}
