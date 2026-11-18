// Proyecto de Supabase que guarda las cuentas de Fiora.
// Son valores públicos (la clave "anon" / "publishable" está pensada para ir en el navegador;
// los datos se protegen con las políticas RLS de la tabla). Si los dejas vacíos, se pueden
// escribir en Ajustes → Cuenta y se guardan solo en ese dispositivo.
export const SUPABASE_URL = 'https://rabhgmnjvxwlttlviywc.supabase.co';
export const SUPABASE_KEY = 'sb_publishable__rmG-ZJ4PnXhp9la52cJhg_l8A_Stj0';

// Clave gratuita de Jamendo ("client_id", de https://devportal.jamendo.com) para buscar en su catálogo.
// Vacía: se puede escribir en Explorar → Jamendo y se guarda solo en ese dispositivo.
export const JAMENDO_CLIENT_ID = '';

// --- Playlists en Supabase -------------------------------------------------------
// Límite por imagen (portadas y fotos del carrusel): el mismo que tiene el bucket en Supabase
// Storage (`file_size_limit` en supabase/migrations/…_playlists.sql). 16 MB = 16 × 1024 × 1024.
export const IMAGE_MAX_BYTES = 16 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
export const PLAYLIST_BUCKET = 'fiora-playlists';
export const MAX_PHOTOS = 15;     // fotos por carrusel (cuentan también las que solo están en el dispositivo)
export const MAX_FEATURED = 3;    // canciones destacadas por playlist
