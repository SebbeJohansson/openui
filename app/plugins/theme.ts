/**
 * Importing useTheme applies the persisted theme to <html> at module load.
 * Registered as a plugin so the side effect runs before the page mounts.
 */
import '~/composables/useTheme';

export default defineNuxtPlugin(() => {});
