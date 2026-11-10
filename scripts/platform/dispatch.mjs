const token = process.env.PORTAL_DISPATCH_TOKEN;
if (!token) {
  console.log('::warning::PORTAL_DISPATCH_TOKEN is missing; the daily portal refresh will discover the game.');
  process.exit(0);
}
const response = await fetch('https://api.github.com/repos/procrastinate-games/pg-website/dispatches', {
  method: 'POST', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
  body: JSON.stringify({ event_type: 'game-published', client_payload: { repository: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA } }),
});
// Publishing is already complete. An expired token must not mark a good game release as failed.
if (!response.ok) console.log(`::warning::Portal dispatch returned HTTP ${response.status}; the daily refresh remains available.`);
else console.log('Portal refresh requested.');
