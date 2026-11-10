export function validateManifest(game, expectedSlug) {
  if (!game || typeof game !== 'object' || Array.isArray(game)) throw new Error('game.json must be an object');
  if (game.schemaVersion !== 1) throw new Error('Unsupported schemaVersion');
  if (!['draft', 'published', 'hidden'].includes(game.status)) throw new Error('Invalid status');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(game.slug ?? '') || game.slug.length > 60) throw new Error('Invalid slug (maximum 60 characters)');
  // A template-derived repository starts with the template placeholder and is never deployed.
  if (expectedSlug && game.status !== 'draft' && game.slug !== expectedSlug) throw new Error('slug must equal the repository name');
  for (const key of ['title', 'shortDescription', 'description', 'primaryCategory', 'languages', 'saveNote', 'coverAlt']) {
    if (typeof game[key] !== 'string' || !game[key].trim() || game[key].length > 10000) throw new Error(`Invalid ${key}`);
  }
  for (const key of ['categories', 'controls']) {
    if (!Array.isArray(game[key]) || !game[key].length || game[key].some(s => typeof s !== 'string' || !s.trim())) throw new Error(`Invalid ${key}`);
  }
  if (!game.categories.includes(game.primaryCategory)) throw new Error('primaryCategory must be in categories');
  if (!['2D', '3D'].includes(game.dimension)) throw new Error('Invalid dimension');
  if (!['lime', 'coral', 'purple'].includes(game.accent)) throw new Error('Invalid accent');
  for (const key of ['featured', 'showSource']) {
    if (game[key] !== undefined && typeof game[key] !== 'boolean') throw new Error(`Invalid ${key}`);
  }
  if (game.startQuery !== undefined && (typeof game.startQuery !== 'string' || (game.startQuery !== '' && !/^\?[^#\s]*$/.test(game.startQuery)))) throw new Error('startQuery must be empty or a query beginning with ?');
  return game;
}
