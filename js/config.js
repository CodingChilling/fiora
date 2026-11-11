// Proyecto de Supabase que guarda las cuentas de Fiora.
// Son valores públicos (la clave "anon" / "publishable" está pensada para ir en el navegador;
// los datos se protegen con las políticas RLS de la tabla). Si los dejas vacíos, se pueden
// escribir en Ajustes → Cuenta y se guardan solo en ese dispositivo.
export const SUPABASE_URL = 'https://rabhgmnjvxwlttlviywc.supabase.co';
export const SUPABASE_KEY = 'sb_publishable__rmG-ZJ4PnXhp9la52cJhg_l8A_Stj0';

// Clave gratuita de Jamendo ("client_id", de https://devportal.jamendo.com) para buscar en su catálogo.
// Vacía: se puede escribir en Explorar → Jamendo y se guarda solo en ese dispositivo.
export const JAMENDO_CLIENT_ID = '';
