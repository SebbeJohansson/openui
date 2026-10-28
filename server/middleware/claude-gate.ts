/** Hide the Claude routes entirely unless the experimental flag is on. */
export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/claude')) return;
  if (!useRuntimeConfig(event).claudeEnabled) {
    throw createError({ statusCode: 404, statusMessage: 'Claude support is disabled' });
  }
});
