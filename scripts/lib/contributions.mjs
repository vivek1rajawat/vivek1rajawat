// Fetches a user's public contribution calendar and parses it into a
// 7-row (Sun-Sat) x ~53-column (weeks) grid of { date, level } cells.
// This is the one place that knows about GitHub's calendar HTML shape —
// if GitHub ever changes it, there's exactly one function to fix.

export async function fetchContributionGrid(username) {
  const res = await fetch(`https://github.com/users/${username}/contributions`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; profile-widgets-bot/1.0)',
      Accept: 'text/html',
    },
  });
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
  const html = await res.text();

  const rowBlocks = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const dayRows = rowBlocks.filter((r) => r.includes('ContributionCalendar-day'));

  const grid = dayRows.map((rowHtml) => {
    const cells = [...rowHtml.matchAll(/<td\s+([^>]*class="ContributionCalendar-day"[^>]*)>/g)].map(
      (m) => m[1]
    );
    return cells.map((attrs) => {
      const date = (attrs.match(/data-date="([^"]+)"/) || [])[1];
      const level = parseInt((attrs.match(/data-level="(\d)"/) || [])[1] || '0', 10);
      return { date, level };
    });
  });

  if (grid.length !== 7 || grid.some((r) => r.length === 0)) {
    throw new Error(`Unexpected calendar shape (${grid.length} rows)`);
  }
  return grid;
}
